# Registro de Binários Embutidos (Bundled Binaries)

Este documento registra a origem, licença, versão e arquitetura de todos os binários externos embutidos e distribuídos como sidecars com o aplicativo **YTDL Studio**.

---

## 1. yt-dlp

*   **Nome do Binário**: `yt-dlp`
*   **Versão**: `2026.08.19`
*   **Origem / URL de Download**: [GitHub Releases - yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp/releases)
    *   *URL Direta*: `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos`
*   **Arquiteturas Suportadas**: Universal (fatias nativas para `arm64` e `x86_64`)
*   **Licença**: [The Unlicense (Domínio Público / Sem restrições)](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE)
*   **SHA-256 macOS universal**: `0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202`
*   **SHA-256 Windows x64**: `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`
*   **Data de Obtenção**: 7 de Setembro de 2026
*   **Observação de Redistribuição**: O `yt-dlp` é licenciado sob a Unlicense, permitindo cópia, modificação, publicação, sublicenciamento e redistribuição irrestrita do binário sem atribuição obrigatória.

---

## 2. FFmpeg (Apple Silicon)

*   **Nome do Binário**: `ffmpeg` (para Apple Silicon/arm64)
*   **Versão**: `8.1.1`
*   **Origem / URL de Download**: [Martin Riedl's FFmpeg Build Server](https://ffmpeg.martin-riedl.de)
    *   *URL Direta*: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip`
*   **Arquiteturas Suportadas**: `arm64` (`aarch64-apple-darwin`)
*   **Licença**: GPL v3.0 (compilado estaticamente com `x264`, `x265`, etc. habilitados)
*   **Data de Obtenção**: 20 de Maio de 2026
*   **Observação de Redistribuição**: Martin Riedl fornece compilações oficiais e assinadas/notarizadas do FFmpeg para macOS em conformidade com as diretrizes do projeto FFmpeg e sob a licença GPL v3.

---

## 3. FFmpeg (Intel)

*   **Nome do Binário**: `ffmpeg` (para Intel/x86_64)
*   **Versão**: `8.1.1`
*   **Origem / URL de Download**: [Martin Riedl's FFmpeg Build Server](https://ffmpeg.martin-riedl.de)
    *   *URL Direta*: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/amd64/release/ffmpeg.zip`
*   **Arquiteturas Suportadas**: `x86_64` (`x86_64-apple-darwin`)
*   **Licença**: GPL v3.0 (compilado estaticamente com `x264`, `x265`, etc. habilitados)
*   **Data de Obtenção**: 20 de Maio de 2026
*   **Observação de Redistribuição**: Martin Riedl fornece compilações oficiais e assinadas/notarizadas do FFmpeg para macOS em conformidade com as diretrizes do projeto FFmpeg e sob a licença GPL v3.

---

## 4. Deno (Apple Silicon)

*   **Nome do Binário**: `deno` (para Apple Silicon/arm64)
*   **Versão**: `2.9.6`
*   **Origem / URL de Download**: [GitHub Releases - denoland/deno](https://github.com/denoland/deno/releases/tag/v2.9.6)
    *   *URL Direta*: `https://github.com/denoland/deno/releases/download/v2.9.6/deno-aarch64-apple-darwin.zip`
*   **Arquiteturas Suportadas**: `arm64` (`aarch64-apple-darwin`)
*   **Licença**: MIT
*   **SHA-256**: `213a2f304f04d3c9cb5220669afad138f60a5aab1fe80962abdeb8f35807a472`
*   **Data de Obtenção**: 7 de Setembro de 2026
*   **Observação de Redistribuição**: Embutido para fornecer runtime JavaScript ao `yt-dlp` em resolvedores EJS do YouTube.

---

## 5. Deno (Intel)

*   **Nome do Binário**: `deno` (para Intel/x86_64)
*   **Versão**: `2.9.6`
*   **Origem / URL de Download**: [GitHub Releases - denoland/deno](https://github.com/denoland/deno/releases/tag/v2.9.6)
    *   *URL Direta*: `https://github.com/denoland/deno/releases/download/v2.9.6/deno-x86_64-apple-darwin.zip`
*   **Arquiteturas Suportadas**: `x86_64` (`x86_64-apple-darwin`)
*   **Licença**: MIT
*   **SHA-256**: `7d4524b82bcc557fe020a1a5b56956ed42b992ae5b28026e8ad5d17329533f5f`
*   **Data de Obtenção**: 7 de Setembro de 2026
*   **Observação de Redistribuição**: Embutido para fornecer runtime JavaScript ao `yt-dlp` em resolvedores EJS do YouTube.

---

## 6. Deno (Windows x64)

*   **Nome do Binário**: `deno.exe`
*   **Versão**: `2.9.6`
*   **Origem / URL de Download**: [GitHub Releases - denoland/deno](https://github.com/denoland/deno/releases/tag/v2.9.6)
    *   *URL Direta*: `https://github.com/denoland/deno/releases/download/v2.9.6/deno-x86_64-pc-windows-msvc.zip`
*   **Arquiteturas Suportadas**: `x86_64` (`x86_64-pc-windows-msvc`)
*   **Licença**: MIT
*   **SHA-256 do arquivo ZIP**: `15e5300b0ba3c3695a7621d90160a746ec9e710228cee639afa9d580f6e3cd11`
*   **Data de Obtenção**: 7 de Setembro de 2026
*   **Observação de Redistribuição**: Embutido para fornecer runtime JavaScript ao `yt-dlp` em resolvedores EJS do YouTube.
