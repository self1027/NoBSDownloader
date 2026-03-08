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

    // Feedback visual de carregamento
    loading.style.display = "block";
    mainContent.style.display = "none";

    try {
        const res = await fetch(`/info?url=${encodeURIComponent(url)}`);
        if (!res.ok) throw new Error("Erro na resposta do servidor");
        
        const data = await res.json();

        // 1. Lógica de Thumbnail (Privacidade Meta/Facebook)
        const isFromMeta = data.thumbnail && data.thumbnail.includes("fbcdn.net");
        const thumbnailHTML = isFromMeta 
            ? `<div style="text-align:center">
                <img src="img/Sad-Face.svg" class="thumb-img" style="width:80px; border:none;">
                <p style="color: #666; font-size: 12px; margin-top: 10px;">Prévia indisponível (Restrição de Privacidade)</p>
               </div>`
            : `<img src="${data.thumbnail}" class="thumb-img" referrerpolicy="no-referrer" onerror="this.src='img/Sad-Face.svg';">`;

        // 2. Renderiza o Card de Preview com Limite de Download dinâmico
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

        // 3. Renderiza Vídeos (MP4)
        const videoList = document.getElementById("video-list");
        videoList.innerHTML = ""; 
        data.video.forEach(f => {
            const btn = document.createElement("a");
            btn.className = "btn-dl";
            btn.href = "#";
            btn.innerText = `MP4 ${f.resolution}`;
            btn.onclick = (e) => {
                e.preventDefault();
                window.open(`/download?url=${encodeURIComponent(url)}&format=${f.format_id}`);
            };
            videoList.appendChild(btn);
        });

        // 4. Renderiza MP3 (Com Filtro de Bitrate)
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
                window.open(`/download?url=${encodeURIComponent(url)}&type=mp3&bitrate=${rate}`);
            };
            audioList.appendChild(btn);
        });

        // 5. Adiciona Áudio Original
        data.audio.forEach(f => {
            const bitrateText = f.abr ? `${Math.round(f.abr)}kbps` : "Original";
            const btn = document.createElement("a");
            btn.className = "btn-dl";
            btn.style.borderStyle = "dashed"; 
            btn.href = "#";
            btn.innerText = `${f.ext.toUpperCase()} ${bitrateText}`;
            btn.onclick = (e) => {
                e.preventDefault();
                window.open(`/download?url=${encodeURIComponent(url)}&format=${f.format_id}`);
            };
            audioList.appendChild(btn);
        });

        // Exibe o conteúdo e esconde o loading
        loading.style.display = "none";
        mainContent.style.display = "block";

    } catch (e) {
        console.error(e);
        alert("Não foi possível obter informações do vídeo. Verifique a URL.");
        loading.style.display = "none";
    }
}