# YTDL Studio Extension + Online Backend

## MVP scope

The browser extension only works with public YouTube `/watch` pages. It does not request cookie, webRequest, declarativeNetRequest, or all_urls permissions, and it does not read or send an authenticated user session.

Unsupported content must be handled by the desktop app:

- private videos;
- members-only videos;
- videos that require login;
- any workflow that depends on browser cookies or Google session state.

## Build

```bash
npm run build:extension
npm run build:api
```

Outputs:

- `apps/extension/dist`
- `apps/api/dist/server.mjs`

## Extension

Load `apps/extension/dist` as an unpacked extension in Chrome/Chromium.

Manifest V3 permissions:

- `activeTab`
- `storage`
- `scripting`

Host permissions:

- `https://www.youtube.com/*`
- `https://youtube.com/*`

The content script detects SPA route changes, extracts `videoId`, canonical URL, title, and thumbnail, then injects the "Baixar no YTDL Studio" button near the YouTube video actions.

## API

Run locally for development:

```bash
YTDL_STUDIO_DEV_AUTH=1 PORT=8787 node apps/api/dist/server.mjs
```

Production-like mode requires:

```bash
YTDL_STUDIO_API_TOKEN="replace-me" \
YTDL_STUDIO_PUBLIC_BASE_URL="https://api.example.com" \
node apps/api/dist/server.mjs
```

If the server runs through `launchctl`, Docker, systemd, or another minimal environment, set explicit binary paths or install the tools in a standard Homebrew location:

```bash
YTDL_STUDIO_YTDLP_PATH="/opt/homebrew/bin/yt-dlp"
YTDL_STUDIO_FFMPEG_PATH="/opt/homebrew/bin/ffmpeg"
```

Endpoints:

- `POST /scan`
- `POST /jobs`
- `GET /jobs/:id`
- `GET /jobs/:id/events`
- `GET /jobs/:id/download?token=...`
- `POST /jobs/:id/cancel`

## Security baseline

The API currently includes:

- Bearer token authentication;
- per-token/IP in-memory rate limit;
- YouTube-only URL validation;
- no arbitrary yt-dlp flags from clients;
- scan/download timeouts where applicable;
- signed download URLs with 24-hour expiry;
- explicit `AUTH_REQUIRED_UNSUPPORTED` errors for login/private/member content.

Before public SaaS release, replace local temp-file storage with R2/S3, add persistent users/quotas, make rate limits distributed, restrict CORS to the extension origin, and add production observability/cleanup.
