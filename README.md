# YTDL Studio

Repositório oficial do **YTDL Studio** — aplicativo desktop multiplataforma moderno, API backend containerizada e extensão de navegador para download e processamento de mídias de alta fidelidade com `yt-dlp` e `ffmpeg`.

---

## 📦 Downloads Oficiais (Desktop)

Baixe sempre os instaladores prontos pelos links permanentes abaixo. Eles apontam
automaticamente para a release mais recente:

- [macOS Apple Silicon (.dmg)](https://github.com/ytdlguibr/ytdlgui/releases/latest/download/YTDL.Studio_macOS-Apple-Silicon.dmg)
- [macOS Intel (.dmg)](https://github.com/ytdlguibr/ytdlgui/releases/latest/download/YTDL.Studio_macOS-Intel.dmg)
- [Windows x64 (.exe)](https://github.com/ytdlguibr/ytdlgui/releases/latest/download/YTDL.Studio_Windows-x64-Setup.exe)

A [página de releases](https://github.com/ytdlguibr/ytdlgui/releases/latest) também
reúne o histórico, checksums e notas de atualização.

### Versões Disponíveis:
- **macOS Apple Silicon (.dmg)**: Otimizado para Macs com Apple Silicon (M1, M2, M3, M4 ou superiores).
- **macOS Intel (.dmg)**: Compatível com Macs baseados em processadores Intel.
- **Windows x64 (.exe / setup)**: Instalador executável para Windows 64-bit.

> **Observações sobre os instaladores:**
> - Os builds de macOS são assinados ad-hoc para distribuição direta.
> - O instalador do Windows possui geração automatizada pelo bundle do Tauri v2.
> - Os arquivos zip/tar.gz de *Source code* gerados automaticamente pelo GitHub contêm apenas o código-fonte. Utilize os executáveis e `.dmg` anexados em cada release.

---

## 🐳 Ambiente Docker (API Backend)

O repositório inclui ambiente Docker pronto para rodar o backend online (`apps/api`) de forma desacoplada com suporte completo ao `yt-dlp` atualizado e `ffmpeg`.

### 1. Configurar variáveis de ambiente

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Edite o arquivo `.env` para ajustar portas, URLs e tokens de segurança:

```env
PORT=8787
YTDL_STUDIO_API_TOKEN=seu_token_secreto_aqui
YTDL_STUDIO_DEV_AUTH=1
YTDL_STUDIO_PUBLIC_BASE_URL=http://localhost:8787
YTDL_STUDIO_OUTPUT_DIR=/downloads
```

### 2. Subir o container com Docker Compose

```bash
docker compose up -d --build
```

### 3. Verificar o status da API

```bash
curl http://localhost:8787/health
```

Resposta esperada:
```json
{"status":"ok","service":"ytdl-studio-api","version":"0.1.3"}
```

Para ver os logs em tempo real:
```bash
docker compose logs -f ytdl-api
```

Para desligar o container:
```bash
docker compose down
```

---

## 💻 Desenvolvimento e Compilação Desktop

O projeto utiliza **Tauri v2**, **React 19**, **TypeScript** e **Vite**, com sidecars versionados do `yt-dlp` e motor de extração de cookies multi-browser (incluindo GinsBrowser com descriptografia nativa AES-256-GCM).

### Pré-requisitos
- [Node.js](https://nodejs.org/) v20+ e `npm`
- [Rust](https://rustup.rs/) (para compilação do desktop app)
- `ffmpeg` e `yt-dlp` instalados no sistema

### Passos para rodar localmente

1. **Instalar dependências:**
   ```bash
   npm install
   ```

2. **Baixar os binários sidecar (yt-dlp / deno):**
   ```bash
   npm run update:sidecars
   ```

3. **Iniciar a aplicação em modo de desenvolvimento:**
   ```bash
   npm run tauri dev
   ```

4. **Gerar instaladores de produção (macOS / Windows):**
   ```bash
   # Compilar para a arquitetura nativa da máquina atual
   npm run build:standalone

   # Ou especificar arquitetura:
   npm run build:standalone:arm64
   npm run build:standalone:intel
   ```

---

## 🧩 Extensão de Navegador (`apps/extension`)

A extensão para navegadores Chromium permite capturar links diretamente da barra de ferramentas ou menu de contexto e enviá-los para o YTDL Studio.

Para compilar a extensão:
```bash
npm run build:extension
```
O pacote descompactado estará pronto na pasta `apps/extension/dist`.

---

## 📁 Estrutura do Repositório

```
.
├── apps/
│   ├── api/            # API backend Node.js (usada no Docker)
│   └── extension/      # Extensão Manifest V3 para navegadores Chromium
├── packages/
│   └── core/           # Módulos compartilhados e analisadores de formato
├── public/             # Assets estáticos
├── scripts/            # Scripts de build, empacotamento e sidecars
├── src/                # Frontend React 19 + Tailwind
├── src-tauri/          # Código Rust nativo do Tauri v2 (comandos, cookies, runtime)
├── Dockerfile          # Imagem de produção da API com yt-dlp + ffmpeg
├── docker-compose.yml  # Orquestração do serviço da API e volumes
└── .env.example        # Modelo de variáveis de ambiente
```

---

## 🛡️ Licença

Distribuído para uso pessoal e testes internos. Consulte as diretrizes locais para maiores informações.
