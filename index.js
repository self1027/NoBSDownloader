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

//CARREGAMENTO DE CONFIGURAÇÕES
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

let activeDownloads = 0;

if (!fs.existsSync(TEMP_ROOT)) {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "./public")));

const removeJobFolder = (folderPath) => {
    if (fs.existsSync(folderPath)) {
        setTimeout(() => {
            try {
                fs.rmSync(folderPath, { recursive: true, force: true });
            } catch (e) {
                // Silencioso
            }
        }, 1000);
    }
};

const getFriendlyErrorMessage = (stderr) => {
    if (stderr.includes("File is larger than max-filesize")) return `O arquivo excede o limite de ${MAX_FILE_SIZE}.`;
    if (stderr.includes("Private video")) return "Este vídeo é privado.";
    if (stderr.includes("Video unavailable")) return "Vídeo indisponível.";
    return "Erro no processamento (URL inválida ou vídeo protegido).";
};

app.get("/info", (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send("URL ausente");
    
    const yt = spawn(YTDLP_PATH, ["-j", "--no-playlist", url]);
    let data = "";
    let errorOutput = "";

    yt.stdout.on("data", chunk => { data += chunk });
    yt.stderr.on("data", chunk => { errorOutput += chunk });

    yt.on("close", (code) => {
        if (code !== 0) return res.status(400).send(getFriendlyErrorMessage(errorOutput));
        try {
            const json = JSON.parse(data);
            
            const videoMap = new Map();
            json.formats.filter(f => f.ext === "mp4" && f.vcodec !== "none").forEach(f => {
                if (f.height && !videoMap.has(f.height)) {
                    videoMap.set(f.height, { 
                        format_id: f.format_id, 
                        resolution: `${f.height}p`, 
                        height: f.height, 
                        hasAudio: f.acodec !== "none" 
                    });
                }
            });
            const video = [...videoMap.values()].sort((a, b) => a.height - b.height);

            const audioMap = new Map();
            json.formats.filter(f => f.vcodec === "none" && f.acodec !== "none").forEach(f => {
                if (f.abr) {
                    const key = Math.round(f.abr);
                    if (!audioMap.has(key)) {
                        audioMap.set(key, { format_id: f.format_id, abr: key, ext: f.ext });
                    }
                }
            });

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
            res.status(500).send("Erro nos metadados."); 
        }
    });
});

app.get("/download", async (req, res) => {
    if (activeDownloads >= MAX_CONCURRENT) {
        return res.status(429).send("Servidor ocupado.");
    }

    const { url, format, type, bitrate } = req.query;
    activeDownloads++;
    
    const jobId = `job_${Date.now()}`;
    const jobFolder = path.join(TEMP_ROOT, jobId);
    fs.mkdirSync(jobFolder);

    const ext = type === "mp3" ? "mp3" : "mp4";
    const tempFile = path.join(jobFolder, `file.${ext}`);
    let exitReason = "UNKNOWN"; 
    let stderrData = "";

    const releaseServer = () => {
        activeDownloads = Math.max(0, activeDownloads - 1);
    };

    const baseArgs = [
        "--no-playlist", "--max-filesize", MAX_FILE_SIZE,
        "--ffmpeg-location", FFMPEG_PATH, "-o", tempFile, url
    ];

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
            res.download(tempFile, `download.${ext}`, () => {
                removeJobFolder(jobFolder);
                releaseServer();
            });
        } else {
            if (!res.headersSent) {
                res.status(exitReason === "LIMIT_EXCEEDED" ? 413 : 500).send(getFriendlyErrorMessage(stderrData));
            }
            removeJobFolder(jobFolder);
            releaseServer();
        }
    });
});

app.listen(config.server.port, () => {
    console.log(`SERVER ON: http://localhost:${config.server.port}`);
});