import express from "express";
import cors from "cors";
import { spawn, exec } from "child_process";
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

let config = {};
try {
    const fileContents = fs.readFileSync(path.join(__dirname, './config.yml'), 'utf8');
    config = yaml.load(fileContents);
} catch (e) {
    process.exit(1);
}

const FFMPEG_PATH = path.resolve(config.binaries.ffmpeg_path);
const YTDLP_PATH = path.resolve(config.binaries.ytdlp_path);
const TEMP_ROOT = path.resolve(config.storage.temp_folder);
const MAX_FILE_SIZE = config.security.max_file_size;
const MAX_CONCURRENT = config.server.max_concurrent_downloads;
const PORT = config.server.port;
const COOKIES_PATH = path.join(__dirname, "cookies.txt");
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

let activeDownloads = 0;

if (!fs.existsSync(TEMP_ROOT)) fs.mkdirSync(TEMP_ROOT, { recursive: true });

app.use(cors({
    origin: ['https://nobsd.murilod.dev', 'http://localhost:3000'],
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, "./public")));

const removeJobFolder = (folderPath) => {
    if (fs.existsSync(folderPath)) {
        setTimeout(() => {
            try { fs.rmSync(folderPath, { recursive: true, force: true }); } catch (e) {}
        }, 2000);
    }
};

const getFriendlyErrorMessage = (stderr) => {
    if (stderr.includes("File is larger than max-filesize")) return `O arquivo excede o limite de ${MAX_FILE_SIZE}.`;
    if (stderr.includes("Private video")) return "Este vídeo é privado.";
    if (stderr.includes("Video unavailable")) return "Vídeo indisponível.";
    if (stderr.includes("confirm you’re not a bot")) return "YouTube bloqueou a requisição (Bot). Atualize os cookies.";
    return "Erro no processamento da URL.";
};

app.get("/info", (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("URL ausente");
    
    const yt = spawn(YTDLP_PATH, ["-j", "--no-playlist", "--ignore-errors", url]);
    let data = "";
    let errorOutput = "";

    yt.stdout.on("data", chunk => { data += chunk });
    yt.stderr.on("data", chunk => { errorOutput += chunk });

    yt.on("close", (code) => {
        if (!data && code !== 0) return res.status(400).send(getFriendlyErrorMessage(errorOutput));
        
        try {
            const json = JSON.parse(data);

            const videoMap = new Map();
            if (json.formats) {
                json.formats.forEach(f => {
                    const isVideo = f.vcodec !== "none" || f.video_ext !== "none";
                    const height = f.height || parseInt(f.quality) || 0;

                    if (isVideo && height > 0 && !videoMap.has(height)) {
                        videoMap.set(height, { 
                            format_id: f.format_id, 
                            resolution: `${height}p`, 
                            height: height, 
                            hasAudio: f.acodec !== "none" && f.audio_ext !== "none" 
                        });
                    }
                });
            }
            const video = [...videoMap.values()].sort((a, b) => b.height - a.height);

            const audioMap = new Map();
            if (json.formats) {
                json.formats.filter(f => f.acodec !== "none" && (f.vcodec === "none" || !f.vcodec)).forEach(f => {
                    const abr = f.abr || f.tbr || 128;
                    const key = Math.round(abr);
                    if (!audioMap.has(key)) {
                        audioMap.set(key, { format_id: f.format_id, abr: key, ext: f.ext || "m4a" });
                    }
                });
            }

            let audio = [...audioMap.values()].sort((a, b) => a.abr - b.abr);
            let mp3Rates = audio.length > 0 ? [...audioMap.keys()].sort((a, b) => a - b) : [128, 192, 256, 320];
            
            if (audio.length === 0) {
                audio = [{ format_id: "bestaudio/best", abr: 128, ext: "mp3" }];
            }

            res.json({ 
                title: json.title, 
                thumbnail: json.thumbnail, 
                video, 
                audio, 
                mp3Rates,
                maxFileSize: MAX_FILE_SIZE
            });
        } catch (e) { 
            console.error(e);
            res.status(500).send("Erro nos metadados."); 
        }
    });
});

app.get("/download", async (req, res) => {
    if (activeDownloads >= MAX_CONCURRENT) return res.status(429).send("Servidor ocupado.");

    const { url, format, type, bitrate } = req.query;
    activeDownloads++;
    
    const jobId = `job_${Date.now()}`;
    const jobFolder = path.join(TEMP_ROOT, jobId);
    fs.mkdirSync(jobFolder);

    const ext = type === "mp3" ? "mp3" : "mp4";
    const tempFile = path.join(jobFolder, `file.${ext}`);
    let exitReason = "UNKNOWN"; 
    let stderrData = "";

    const releaseServer = () => { activeDownloads = Math.max(0, activeDownloads - 1); };

    const baseArgs = [
        "--no-playlist", "--max-filesize", MAX_FILE_SIZE,
        "--user-agent", USER_AGENT,
        "--js-runtimes", "node",
        "--ffmpeg-location", FFMPEG_PATH, "-o", tempFile, url
    ];
    
    if (fs.existsSync(COOKIES_PATH)) baseArgs.push("--cookies", COOKIES_PATH);

    let ytArgs = (type === "mp3") 
        ? ["-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", bitrate || "192", ...baseArgs]
        : ["-f", format ? `${format}+bestaudio[ext=m4a]/best` : "best", "--merge-output-format", "mp4", ...baseArgs];

    const yt = spawn(YTDLP_PATH, ytArgs);

    yt.stderr.on("data", (data) => { stderrData += data.toString(); });
    yt.stdout.on("data", (data) => {
        const output = data.toString();
        if (output.includes("GiB")) {
            const sizeMatch = output.match(/(\d+\.\d+)GiB/);
            if (sizeMatch && parseFloat(sizeMatch[1]) >= 1.0) {
                exitReason = "LIMIT_EXCEEDED";
                process.platform === "win32" ? exec(`taskkill /pid ${yt.pid} /f /t`) : yt.kill("SIGKILL");
            }
        }
    });

    res.on("close", () => {
        if (!res.writableEnded) {
            exitReason = "USER_ABORTED";
            process.platform === "win32" ? exec(`taskkill /pid ${yt.pid} /f /t`) : yt.kill("SIGKILL");
            setTimeout(() => { removeJobFolder(jobFolder); releaseServer(); }, 500);
        }
    });

    yt.on("close", (code) => {
        if (code === 0) {
            res.download(tempFile, `download.${ext}`, (err) => {
                removeJobFolder(jobFolder);
                releaseServer();
            });
        } else {
            if (!res.headersSent) res.status(exitReason === "LIMIT_EXCEEDED" ? 413 : 500).send(getFriendlyErrorMessage(stderrData));
            removeJobFolder(jobFolder);
            releaseServer();
        }
    });
});

app.get("/health", (req, res) => {
    res.json({ status: "ok", activeDownloads, uptime: process.uptime() });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`sever on ${PORT}`);
});