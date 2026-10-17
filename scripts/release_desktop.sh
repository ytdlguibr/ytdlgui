#!/usr/bin/env bash
# Builds, signs and publishes desktop installers plus Tauri updater artifacts.

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_ROOT"
source "$PROJECT_ROOT/scripts/load_tauri_signing_key.sh"

REPOSITORY="ytdlguibr/ytdlgui"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"
RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ytdl-studio-release.XXXXXX")"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERRO: arquivo esperado nao encontrado: $1"
    exit 1
  fi
}

copy_asset() {
  local source="$1"
  local name="$2"
  require_file "$source"
  cp "$source" "$RELEASE_DIR/$name"
}

ACTIVE_ACCOUNT="$(gh api user --jq .login)"
if [[ "$ACTIVE_ACCOUNT" != "ytdlguibr" ]]; then
  echo "ERRO: a conta GitHub ativa e $ACTIVE_ACCOUNT; use somente ytdlguibr para publicar o YTDL Studio."
  exit 1
fi

if gh release view "$TAG" --repo "$REPOSITORY" >/dev/null 2>&1; then
  echo "ERRO: a release $TAG ja existe. Aumente a versao antes de publicar."
  exit 1
fi

if [[ "${YTDL_STUDIO_SKIP_BUILD:-0}" != "1" ]]; then
  "$PROJECT_ROOT/scripts/build_standalone.sh"
  YTDL_STUDIO_BUILD_TARGET=x86_64-apple-darwin "$PROJECT_ROOT/scripts/build_standalone.sh"
  PATH="$HOME/.cargo/bin:$PATH" "$PROJECT_ROOT/scripts/build_windows.sh"
else
  echo "Reutilizando artefatos ja compilados porque YTDL_STUDIO_SKIP_BUILD=1."
fi

ARM_ROOT="src-tauri/target/aarch64-apple-darwin/release/bundle"
INTEL_ROOT="src-tauri/target/x86_64-apple-darwin/release/bundle"
WINDOWS_ROOT="src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"

copy_asset "$ARM_ROOT/dmg/YTDL Studio_${VERSION}_aarch64.dmg" "YTDL.Studio_${VERSION}_macOS-Apple-Silicon.dmg"
copy_asset "$INTEL_ROOT/dmg/YTDL Studio_${VERSION}_x86_64.dmg" "YTDL.Studio_${VERSION}_macOS-Intel.dmg"
copy_asset "$WINDOWS_ROOT/YTDL Studio_${VERSION}_x64-setup.exe" "YTDL.Studio_${VERSION}_Windows-x64-Setup.exe"
copy_asset "$WINDOWS_ROOT/YTDL Studio_${VERSION}_x64-setup.exe.sig" "YTDL.Studio_${VERSION}_Windows-x64-Setup.exe.sig"

copy_asset "$ARM_ROOT/macos/YTDL Studio.app.tar.gz" "YTDL.Studio_${VERSION}_darwin-aarch64.tar.gz"
copy_asset "$ARM_ROOT/macos/YTDL Studio.app.tar.gz.sig" "YTDL.Studio_${VERSION}_darwin-aarch64.tar.gz.sig"
copy_asset "$INTEL_ROOT/macos/YTDL Studio.app.tar.gz" "YTDL.Studio_${VERSION}_darwin-x86_64.tar.gz"
copy_asset "$INTEL_ROOT/macos/YTDL Studio.app.tar.gz.sig" "YTDL.Studio_${VERSION}_darwin-x86_64.tar.gz.sig"

node - "$RELEASE_DIR" "$VERSION" <<'NODE'
const fs = require('fs');
const path = require('path');
const [releaseDir, version] = process.argv.slice(2);
const baseUrl = `https://github.com/ytdlguibr/ytdlgui/releases/download/v${version}`;

function platform(asset) {
  const signature = fs.readFileSync(path.join(releaseDir, `${asset}.sig`), 'utf8').trim();
  if (!signature) throw new Error(`assinatura vazia para ${asset}`);
  return { url: `${baseUrl}/${encodeURIComponent(asset)}`, signature };
}

const manifest = {
  version,
  notes: `YTDL Studio ${version}. Consulte a pagina da release para as novidades.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'darwin-aarch64': platform(`YTDL.Studio_${version}_darwin-aarch64.tar.gz`),
    'darwin-x86_64': platform(`YTDL.Studio_${version}_darwin-x86_64.tar.gz`),
    'windows-x86_64': platform(`YTDL.Studio_${version}_Windows-x64-Setup.exe`),
  },
};

fs.writeFileSync(path.join(releaseDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
NODE

(cd "$RELEASE_DIR" && shasum -a 256 ./* > SHA256SUMS.txt)

gh release create "$TAG" \
  --repo "$REPOSITORY" \
  --title "YTDL Studio v$VERSION" \
  --notes "Atualizacao publicada pelo fluxo assinado do YTDL Studio. O aplicativo detecta esta release automaticamente." \
  "$RELEASE_DIR"/*

echo "Release publicada: https://github.com/$REPOSITORY/releases/tag/$TAG"
echo "Manifesto do atualizador: https://github.com/$REPOSITORY/releases/latest/download/latest.json"
