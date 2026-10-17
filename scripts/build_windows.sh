#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
source "$(pwd -P)/scripts/load_tauri_signing_key.sh"

echo "=== YTDL Studio Windows Cross-Compilation ==="

# Ensure sidecars
echo "=== Verifying Windows Sidecars ==="
if [[ ! -f "src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe" ]]; then
    echo "Windows sidecars missing. Running download script..."
    ./scripts/download_windows_sidecars.sh
fi

echo "=== Building Tauri App for Windows ==="
# Using cargo-xwin as runner.
# We also set PATH to include brew's LLVM so xwin can use llvm-rc for resource compilation
export PATH="/opt/homebrew/opt/llvm/bin:$PATH"

npm run tauri build -- -r cargo-xwin -t x86_64-pc-windows-msvc -b nsis

echo "=== Done ==="
