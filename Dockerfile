# Multi-stage build for YTDL Studio Online API
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json ./

# Install build dependencies
RUN npm ci

# Copy full source needed for bundling the API
COPY . .

# Build the standalone API bundle
RUN npm run build:api

# Runtime image
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install system dependencies: ffmpeg, python3, ca-certificates, curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

# Install official latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && yt-dlp --version

# Create output and cache directories
RUN mkdir -p /downloads /app && chmod 777 /downloads

# Copy compiled standalone server bundle from builder
COPY --from=builder /app/apps/api/dist/server.mjs /app/server.mjs

ENV NODE_ENV=production \
    PORT=8787 \
    YTDL_STUDIO_OUTPUT_DIR=/downloads \
    YTDL_STUDIO_YTDLP_PATH=/usr/local/bin/yt-dlp \
    YTDL_STUDIO_FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 8787

VOLUME ["/downloads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8787/health || exit 1

CMD ["node", "server.mjs"]
