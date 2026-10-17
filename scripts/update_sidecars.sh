#!/usr/bin/env bash
# Update the downloadable runtime sidecars as one verified, versioned set.

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
BINARIES_DIR="$PROJECT_ROOT/src-tauri/binaries"
MODE="all"

if [[ "${1:-}" == "--macos" || "${1:-}" == "--windows" ]]; then
  MODE="${1#--}"
elif [[ -n "${1:-}" ]]; then
  echo "Uso: $0 [--macos|--windows]"
  exit 64
fi

# Pinned to assets verified from the official release metadata on 2026-09-07.
YTDLP_VERSION="2026.08.19"
DENO_VERSION="v2.9.6"
YTDLP_MACOS_SHA256="0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202"
YTDLP_WINDOWS_SHA256="66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a"
DENO_ARM64_SHA256="213a2f304f04d3c9cb5220669afad138f60a5aab1fe80962abdeb8f35807a472"
DENO_X64_MACOS_SHA256="7d4524b82bcc557fe020a1a5b56956ed42b992ae5b28026e8ad5d17329533f5f"
DENO_X64_WINDOWS_SHA256="15e5300b0ba3c3695a7621d90160a746ec9e710228cee639afa9d580f6e3cd11"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ytdl-studio-sidecars.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

download() {
  local destination="$1"
  local url="$2"
  curl --fail --location --retry 3 --connect-timeout 15 --max-time 180 --output "$destination" "$url"
}

verify() {
  local digest="$1"
  local path="$2"
  printf '%s  %s\n' "$digest" "$path" | shasum -a 256 -c -
}

mkdir -p "$BINARIES_DIR"

if [[ "$MODE" == "all" || "$MODE" == "macos" ]]; then
  download "$TEMP_DIR/yt-dlp_macos" "https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION/yt-dlp_macos"
  download "$TEMP_DIR/deno-aarch64.zip" "https://github.com/denoland/deno/releases/download/$DENO_VERSION/deno-aarch64-apple-darwin.zip"
  download "$TEMP_DIR/deno-x86_64.zip" "https://github.com/denoland/deno/releases/download/$DENO_VERSION/deno-x86_64-apple-darwin.zip"

  verify "$YTDLP_MACOS_SHA256" "$TEMP_DIR/yt-dlp_macos"
  verify "$DENO_ARM64_SHA256" "$TEMP_DIR/deno-aarch64.zip"
  verify "$DENO_X64_MACOS_SHA256" "$TEMP_DIR/deno-x86_64.zip"

  unzip -q "$TEMP_DIR/deno-aarch64.zip" -d "$TEMP_DIR/deno-aarch64"
  unzip -q "$TEMP_DIR/deno-x86_64.zip" -d "$TEMP_DIR/deno-x86_64"

  install -m 755 "$TEMP_DIR/yt-dlp_macos" "$BINARIES_DIR/yt-dlp-aarch64-apple-darwin"
  install -m 755 "$TEMP_DIR/yt-dlp_macos" "$BINARIES_DIR/yt-dlp-x86_64-apple-darwin"
  install -m 755 "$TEMP_DIR/deno-aarch64/deno" "$BINARIES_DIR/deno-aarch64-apple-darwin"
  install -m 755 "$TEMP_DIR/deno-x86_64/deno" "$BINARIES_DIR/deno-x86_64-apple-darwin"

  # Preserve the upstream Mach-O signature here. The standalone build script
  # clears attributes and signs the copies inside the final .app bundle.
fi

if [[ "$MODE" == "all" || "$MODE" == "windows" ]]; then
  download "$TEMP_DIR/yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/download/$YTDLP_VERSION/yt-dlp.exe"
  download "$TEMP_DIR/deno-windows.zip" "https://github.com/denoland/deno/releases/download/$DENO_VERSION/deno-x86_64-pc-windows-msvc.zip"

  verify "$YTDLP_WINDOWS_SHA256" "$TEMP_DIR/yt-dlp.exe"
  verify "$DENO_X64_WINDOWS_SHA256" "$TEMP_DIR/deno-windows.zip"

  unzip -q "$TEMP_DIR/deno-windows.zip" -d "$TEMP_DIR/deno-windows"
  install -m 644 "$TEMP_DIR/yt-dlp.exe" "$BINARIES_DIR/yt-dlp-x86_64-pc-windows-msvc.exe"
  install -m 644 "$TEMP_DIR/deno-windows/deno.exe" "$BINARIES_DIR/deno-x86_64-pc-windows-msvc.exe"
fi

echo "Sidecars atualizados: yt-dlp $YTDLP_VERSION; Deno $DENO_VERSION."
