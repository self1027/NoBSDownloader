async function buscar() {
    const urlInput = document.getElementById("url");
    const url = urlInput.value;
    const mainContent = document.getElementById("main-content");
    const loading = document.getElementById("loading");
    const videoPreview = document.getElementById("video-preview");

    if (!url) {
        alert("Por favor, cole uma URL válida.");
        return;
    }

    loading.style.display = "block";
    mainContent.style.display = "none";

    try {
        const res = await fetch(`/info?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error("Erro na resposta do servidor");
        
        const data = await res.json();

        //Lógica de Thumbnail (Tratamento para restrições de Meta/Facebook)
        const isFromMeta = data.thumbnail && data.thumbnail.includes("fbcdn.net");
        const thumbnailHTML = isFromMeta 
            ? `<div style="text-align:center">
                <img src="img/Sad-Face.svg" class="thumb-img" style="width:80px; border:none;">
                <p style="color: #666; font-size: 12px; margin-top: 10px;">Prévia indisponível (Restrição de Privacidade)</p>
               </div>`
            : `<img src="${data.thumbnail}" class="thumb-img" referrerpolicy="no-referrer" onerror="this.src='img/Sad-Face.svg';">`;

        //Renderiza o Card de Preview
        videoPreview.innerHTML = `
            ${thumbnailHTML}
            <div>
                <h3>${data.title}</h3>
                <p style="font-size: 0.85rem; color: #555; margin-bottom: 5px;">Mídia processada com sucesso.</p>
                <p style="font-size: 0.8rem; color: #888;">
                    Limite de download: <strong style="color: #222;">${data.maxFileSize}</strong>
                </p>
            </div>
        `;

        const realizarDownload = async (btn, downloadUrl, fileName) => {
            const originalText = btn.innerText;
            
            btn.classList.add("loading-btn");
            btn.innerText = "Preparando...";
            btn.style.pointerEvents = "none"; 

            try {
                const response = await fetch(downloadUrl);
                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText || "Erro no servidor");
                }

                const blob = await response.blob();
                const urlBlob = window.URL.createObjectURL(blob);
                
                const a = document.createElement("a");
                a.href = urlBlob;
                a.download = fileName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(urlBlob);

            } catch (err) {
                console.error(err);
                alert(`Erro: ${err.message}`);
            } finally {
                btn.classList.remove("loading-btn");
                btn.innerText = originalText;
                btn.style.pointerEvents = "auto";
            }
        };

        //Renderiza Vídeos (MP4)
        const videoList = document.getElementById("video-list");
        videoList.innerHTML = ""; 
        data.video.forEach(f => {
            const btn = document.createElement("a");
            btn.className = "btn-dl";
            btn.href = "#";
            btn.innerText = `MP4 ${f.resolution}`;
            btn.onclick = (e) => {
                e.preventDefault();
                const dlUrl = `/download?url=${encodeURIComponent(url)}&format=${f.format_id}`;
                realizarDownload(btn, dlUrl, `${data.title}_${f.resolution}.mp4`);
            };
            videoList.appendChild(btn);
        });

        //Renderiza MP3 (Com Filtro de Bitrate)
        const audioList = document.getElementById("audio-list");
        audioList.innerHTML = ""; 
        
        let ratesParaExibir = data.mp3Rates.filter(rate => rate >= 60);
        if (ratesParaExibir.length === 0) ratesParaExibir = data.mp3Rates;

        ratesParaExibir.forEach(rate => {
            const btn = document.createElement("a");
            btn.className = "btn-dl";
            btn.href = "#";
            btn.innerText = `MP3 ${rate}kbps`;
            btn.onclick = (e) => {
                e.preventDefault();
                const dlUrl = `/download?url=${encodeURIComponent(url)}&type=mp3&bitrate=${rate}`;
                realizarDownload(btn, dlUrl, `${data.title}.mp3`);
            };
            audioList.appendChild(btn);
        });

        //Adiciona Áudio Original (M4A/WebM)
        data.audio.forEach(f => {
            const bitrateText = f.abr ? `${Math.round(f.abr)}kbps` : "Original";
            const btn = document.createElement("a");
            btn.className = "btn-dl";
            btn.style.borderStyle = "dashed"; 
            btn.href = "#";
            btn.innerText = `${f.ext.toUpperCase()} ${bitrateText}`;
            btn.onclick = (e) => {
                e.preventDefault();
                const dlUrl = `/download?url=${encodeURIComponent(url)}&format=${f.format_id}`;
                realizarDownload(btn, dlUrl, `${data.title}.${f.ext}`);
            };
            audioList.appendChild(btn);
        });

        loading.style.display = "none";
        mainContent.style.display = "block";

    } catch (e) {
        console.error(e);
        alert("Não foi possível obter informações do vídeo. Verifique a URL ou os cookies do servidor.");
        loading.style.display = "none";
    }
}

async function colarDoClipboard() {
    const urlInput = document.getElementById("url");
    const btnColar = document.getElementById("btn-colar");

    try {
        const texto = await navigator.clipboard.readText();
        
        if (texto) {
            urlInput.value = texto;
            
            const originalEmoji = btnColar.innerText;
            btnColar.innerText = "✅";
            setTimeout(() => btnColar.innerText = originalEmoji, 1000);
        }
    } catch (err) {
        console.error("Erro ao acessar clipboard:", err);
        alert("Erro: Permita o acesso à área de transferência no seu navegador.");
    }
}