# No BS Downloader

**Media Extraction Engine** focado em automação de rotinas e otimização de fluxos de trabalho. O projeto elimina camadas de anúncios e rastreamento, entregando uma interface funcional baseada em metadados puros e processamento direto no servidor.

## Especificações Técnicas

* **Core:** Node.js com gerenciamento assíncrono de processos filhos (`child_process`).
* **Engine:** Integração com `yt-dlp` para análise de streams e `ffmpeg` para transcodificação de áudio.
* **Frontend:** Arquitetura minimalista utilizando CSS Grid e Vanilla JS.
* **Data Flow:** Extração de metadados via JSON com filtragem seletiva de bitrates e resoluções.

## Pré-requisitos de Sistema

Para garantir a conformidade com boas práticas de versionamento e portabilidade entre ambientes (Windows/Linux), os binários de terceiros não são inclusos no repositório. O sistema utiliza a **resolução nativa do PATH**, o que permite que o backend invoque as ferramentas sem caminhos "hardcoded".

1. **yt-dlp**: Deve estar acessível globalmente via CLI.
2. **FFmpeg**: Necessário para multiplexação e conversão de streams.



## Configuração e Setup

O comportamento do sistema é regido por um arquivo `config.yml`, que centraliza limites operacionais. Isso garante a integridade do backend sob carga e isola a configuração da lógica de negócio.

```bash
# 1. Instalação das dependências de runtime (Node.js)
npm install

# 2. Provisionamento do ambiente (Exemplo Linux/Debian)
# Ao instalar via gerenciador de pacotes, os binários são registrados no PATH automaticamente.
sudo apt update && sudo apt install ffmpeg yt-dlp

# 3. Inicialização do serviço
node index.js

```

## Governança de Dados

* **Abstração de Binários:** O código invoca os comandos `ffmpeg` e `yt-dlp` diretamente do sistema, permitindo que o deploy ocorra em qualquer SO que possua as ferramentas no PATH, sem alteração de código.
* **Privacidade:** Tratamento de thumbnails restritas através de lógica de detecção de CDNs externas (como `fbcdn.net`).
* **Eficiência:** Algoritmo de filtragem seletiva de bitrates, priorizando a entrega de áudios acima de 60kbps para manter a fidelidade sonora.
* **Transparência:** O limite de download definido no `config.yml` é injetado dinamicamente no frontend via rota `/info`.

---

**Desenvolvido por Murilo D.** *Software Developer | Backend Systems & Automation*.