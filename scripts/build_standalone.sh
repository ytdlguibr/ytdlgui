#!/usr/bin/env bash
# Build standalone macOS package for YTDL Studio.
# This script intentionally handles only macOS bundle hygiene: xattrs,
# executable bits, ad-hoc signing order, DMG staging, and verification.
#
# Optional target selection:
#   YTDL_STUDIO_BUILD_TARGET=x86_64-apple-darwin ./scripts/build_standalone.sh
#   YTDL_STUDIO_BUILD_TARGET=aarch64-apple-darwin ./scripts/build_standalone.sh

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$PROJECT_ROOT"
source "$PROJECT_ROOT/scripts/load_tauri_signing_key.sh"

TARGET_TRIPLE="${YTDL_STUDIO_BUILD_TARGET:-}"
case "$TARGET_TRIPLE" in
  ""|aarch64-apple-darwin|x86_64-apple-darwin) ;;
  arm64) TARGET_TRIPLE="aarch64-apple-darwin" ;;
  intel|x64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
  *)
    echo "ERRO: target macOS nao suportado: $TARGET_TRIPLE"
    echo "Use aarch64-apple-darwin ou x86_64-apple-darwin."
    exit 64
    ;;
esac

APP_NAME="YTDL Studio.app"
if [[ -n "$TARGET_TRIPLE" ]]; then
  BUNDLE_ROOT="src-tauri/target/$TARGET_TRIPLE/release/bundle"
else
  BUNDLE_ROOT="src-tauri/target/release/bundle"
fi
MACOS_DIR="$BUNDLE_ROOT/macos"
APP_PATH="$MACOS_DIR/$APP_NAME"
DMG_DIR="$BUNDLE_ROOT/dmg"
DMG_SCRIPT="$DMG_DIR/bundle_dmg.sh"
DMG_ICON="$DMG_DIR/icon.icns"
DMG_SUPPORT="$BUNDLE_ROOT/share/create-dmg/support"
FALLBACK_DMG_DIR="src-tauri/target/release/bundle/dmg"
FALLBACK_DMG_SCRIPT="$FALLBACK_DMG_DIR/bundle_dmg.sh"
FALLBACK_DMG_ICON="$FALLBACK_DMG_DIR/icon.icns"
FALLBACK_DMG_SHARE="src-tauri/target/release/bundle/share"
TEMP_DIR="$BUNDLE_ROOT/dmg_temp"
TEMP_APP_PATH="$TEMP_DIR/$APP_NAME"
DIAG_SCRIPT="$PROJECT_ROOT/scripts/diagnose_macos_bundle.sh"

MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-11.0}"
export MACOSX_DEPLOYMENT_TARGET

APP_VERSION="$(node -p "require('./package.json').version")"
if [[ "$TARGET_TRIPLE" == "aarch64-apple-darwin" ]]; then
  BUNDLE_ARCH="aarch64"
elif [[ "$TARGET_TRIPLE" == "x86_64-apple-darwin" ]]; then
  BUNDLE_ARCH="x86_64"
else
  case "$(uname -m)" in
    arm64) BUNDLE_ARCH="aarch64" ;;
    x86_64) BUNDLE_ARCH="x86_64" ;;
    *) BUNDLE_ARCH="$(uname -m)" ;;
  esac
fi

DMG_NAME="YTDL Studio_${APP_VERSION}_${BUNDLE_ARCH}.dmg"
DMG_PATH="$DMG_DIR/$DMG_NAME"
MOUNT_POINT=""
DMG_MOUNTED=0

cleanup() {
  if [[ "$DMG_MOUNTED" == "1" && -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$MOUNT_POINT" ]]; then
    rm -rf "$MOUNT_POINT"
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

section() {
  printf '\n=== %s ===\n' "$1"
}

run_required() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
}

run_optional() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
  local status=$?
  if [[ "$status" -eq 0 ]]; then
    return 0
  fi

  echo "AVISO: comando retornou $status; mantendo como diagnostico nao bloqueante."
  return 0
}

plist_value() {
  /usr/libexec/PlistBuddy -c "Print :$1" "$APP_PATH/Contents/Info.plist"
}

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "ERRO: arquivo obrigatorio ausente: $1"
    exit 1
  fi
}

ensure_cross_target_toolchain() {
  if [[ -z "$TARGET_TRIPLE" ]]; then
    return
  fi

  local sysroot
  sysroot="$(rustc --print sysroot)"
  if [[ -d "$sysroot/lib/rustlib/$TARGET_TRIPLE" ]]; then
    return
  fi

  if ! command -v rustup >/dev/null 2>&1; then
    echo "ERRO: o target Rust $TARGET_TRIPLE não está instalado no toolchain ativo."
    echo "Instale Rustup e execute: rustup target add $TARGET_TRIPLE"
    exit 1
  fi

  echo "Toolchain ativo não possui $TARGET_TRIPLE; usando o toolchain Rustup."
  run_required rustup target add "$TARGET_TRIPLE"
  export PATH="$(dirname "$(rustup which cargo)"):$PATH"

  sysroot="$(rustc --print sysroot)"
  if [[ ! -d "$sysroot/lib/rustlib/$TARGET_TRIPLE" ]]; then
    echo "ERRO: o target Rust $TARGET_TRIPLE continua indisponível em $sysroot."
    exit 1
  fi
}

section "0. Build standalone macOS"
echo "Project: $PROJECT_ROOT"
echo "MACOSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET"
echo "YTDL_STUDIO_BUILD_TARGET=${TARGET_TRIPLE:-host}"
echo "BUNDLE_ROOT=$BUNDLE_ROOT"

section "1. Clean previous staging and generated DMG"
run_required rm -rf "$TEMP_DIR"
run_required mkdir -p "$DMG_DIR"
run_required rm -f "$DMG_PATH"

section "2. Build Tauri .app"
ensure_cross_target_toolchain
BUILD_ARGS=(build --bundles app)
if [[ -n "$TARGET_TRIPLE" ]]; then
  BUILD_ARGS=(build --target "$TARGET_TRIPLE" --bundles app)
fi
run_required npm run tauri -- "${BUILD_ARGS[@]}"

if [[ ! -x "$DMG_SCRIPT" || ! -f "$DMG_ICON" || ! -d "$DMG_SUPPORT" ]]; then
  if [[ -x "$FALLBACK_DMG_SCRIPT" && -f "$FALLBACK_DMG_ICON" ]]; then
    section "2b. Reuse host Tauri DMG helper files"
    run_required mkdir -p "$DMG_DIR"
    run_required mkdir -p "$BUNDLE_ROOT/share"
    run_required cp "$FALLBACK_DMG_SCRIPT" "$DMG_SCRIPT"
    run_required cp "$FALLBACK_DMG_ICON" "$DMG_ICON"
    run_required ditto "$FALLBACK_DMG_SHARE" "$BUNDLE_ROOT/share"
  else
    section "2b. Generate Tauri DMG helper files"
    DMG_HELPER_ARGS=(build --bundles dmg)
    if [[ -n "$TARGET_TRIPLE" ]]; then
      DMG_HELPER_ARGS=(build --target "$TARGET_TRIPLE" --bundles dmg)
    fi
    run_required npm run tauri -- "${DMG_HELPER_ARGS[@]}"
    run_required rm -f "$DMG_PATH"
  fi
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "ERRO: o bundle .app nao foi encontrado em $APP_PATH"
  exit 1
fi
require_file "$DMG_SCRIPT"
require_file "$DMG_ICON"
run_required chmod +x "$DMG_SCRIPT"

MAIN="$(plist_value CFBundleExecutable)"
MAIN_BIN="$APP_PATH/Contents/MacOS/$MAIN"
YTDLP_BIN="$APP_PATH/Contents/MacOS/yt-dlp"
FFMPEG_BIN="$APP_PATH/Contents/MacOS/ffmpeg"
DENO_BIN="$APP_PATH/Contents/MacOS/deno"

require_file "$MAIN_BIN"
require_file "$YTDLP_BIN"
require_file "$FFMPEG_BIN"
require_file "$DENO_BIN"

section "3. Clear xattrs and fix executable permissions before signing"
run_required xattr -cr "$APP_PATH"
run_required chmod +x "$APP_PATH/Contents/MacOS/"*

section "4. Inspect architecture and deployment target"
run_required file "$MAIN_BIN"
run_required file "$YTDLP_BIN"
run_required file "$FFMPEG_BIN"
run_required file "$DENO_BIN"
run_optional lipo -info "$MAIN_BIN"
run_optional lipo -info "$YTDLP_BIN"
run_optional lipo -info "$FFMPEG_BIN"
run_optional lipo -info "$DENO_BIN"
run_optional bash -c "otool -l \"\$1\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" _ "$MAIN_BIN"
run_optional bash -c "otool -l \"\$1\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" _ "$FFMPEG_BIN"
run_optional bash -c "otool -l \"\$1\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" _ "$DENO_BIN"

section "5. Ad-hoc sign sidecars, main binary, then bundle"
run_required codesign --force --sign - "$DENO_BIN"
run_required codesign --force --sign - "$YTDLP_BIN"
run_required codesign --force --sign - "$FFMPEG_BIN"
run_required codesign --force --sign - "$MAIN_BIN"
run_required codesign --force --deep --sign - "$APP_PATH"

section "5b. Rebuild and sign the updater archive from the finalized app"
UPDATE_ARCHIVE="$MACOS_DIR/$APP_NAME.tar.gz"
run_required rm -f "$UPDATE_ARCHIVE" "$UPDATE_ARCHIVE.sig"
run_required tar -czf "$UPDATE_ARCHIVE" -C "$MACOS_DIR" "$APP_NAME"
run_required env -u TAURI_SIGNING_PRIVATE_KEY npm run tauri -- signer sign "$UPDATE_ARCHIVE"
require_file "$UPDATE_ARCHIVE.sig"

section "6. Verify signed staging .app"
run_required codesign --verify --deep --strict --verbose=4 "$APP_PATH"
run_required codesign --verify --verbose=4 "$MAIN_BIN"
run_required codesign --verify --verbose=4 "$DENO_BIN"
run_required codesign --verify --verbose=4 "$YTDLP_BIN"
run_required codesign --verify --verbose=4 "$FFMPEG_BIN"
run_optional spctl --assess --type execute --verbose=4 "$APP_PATH"

if [[ -x "$DIAG_SCRIPT" ]]; then
  section "7. Diagnose signed staging .app without launching UI"
  run_required "$DIAG_SCRIPT" "$APP_PATH" --skip-main-run
fi

section "8. Stage signed .app for DMG with ditto"
run_required rm -rf "$TEMP_DIR"
run_required mkdir -p "$TEMP_DIR"
run_required ditto "$APP_PATH" "$TEMP_APP_PATH"
run_required codesign --verify --deep --strict --verbose=4 "$TEMP_APP_PATH"

section "9. Create final DMG from signed staging copy"
run_required "$DMG_SCRIPT" \
  --volname "YTDL Studio" \
  --volicon "$DMG_ICON" \
  --icon "$APP_NAME" 100 120 \
  --app-drop-link 300 120 \
  --window-size 400 300 \
  "$DMG_PATH" \
  "$TEMP_DIR"

section "10. Mount final DMG and verify contained .app"
MOUNT_POINT="$(mktemp -d "${TMPDIR:-/tmp}/ytdl-studio-dmg.XXXXXX")"
run_required hdiutil attach "$DMG_PATH" -nobrowse -readonly -mountpoint "$MOUNT_POINT"
DMG_MOUNTED=1

MOUNTED_APP_PATH="$MOUNT_POINT/$APP_NAME"
if [[ ! -d "$MOUNTED_APP_PATH" ]]; then
  echo "ERRO: app nao encontrado dentro do DMG montado: $MOUNTED_APP_PATH"
  exit 1
fi

run_required codesign --verify --deep --strict --verbose=4 "$MOUNTED_APP_PATH"
run_optional spctl --assess --type execute --verbose=4 "$MOUNTED_APP_PATH"

section "11. Execute mounted DMG sidecars directly"
run_required "$MOUNTED_APP_PATH/Contents/MacOS/deno" --version
run_required "$MOUNTED_APP_PATH/Contents/MacOS/yt-dlp" --version
run_required "$MOUNTED_APP_PATH/Contents/MacOS/ffmpeg" -version

section "11b. Smoke test YouTube EJS resolver from mounted DMG"
EJS_SMOKE_LOG="$TEMP_DIR/ejs-smoke.log"
run_required bash -c '
  set -o pipefail
  yt="$1"
  deno="$2"
  log="$3"
  url="https://www.youtube.com/watch?v=ub0W7-rSkyg"
  "$yt" --js-runtimes "deno:$deno" --remote-components ejs:github -F "$url" 2>&1 | tee "$log"
  if grep -qi "Only images are available" "$log"; then
    echo "ERRO: yt-dlp retornou apenas imagens; EJS nao resolveu formatos reais."
    exit 70
  fi
  if grep -qi "n challenge solving failed\\|Signature solving failed\\|supported JavaScript runtime" "$log"; then
    echo "ERRO: falha de resolvedor JavaScript/EJS detectada."
    exit 71
  fi
  if ! grep -Eqi "video only|audio only" "$log"; then
    echo "ERRO: smoke EJS nao encontrou formatos de video/audio reais."
    exit 72
  fi
' _ "$MOUNTED_APP_PATH/Contents/MacOS/yt-dlp" "$MOUNTED_APP_PATH/Contents/MacOS/deno" "$EJS_SMOKE_LOG"

if [[ -x "$DIAG_SCRIPT" ]]; then
  section "12. Diagnose mounted DMG .app without launching UI"
  run_required "$DIAG_SCRIPT" "$MOUNTED_APP_PATH" --skip-main-run
fi

run_required hdiutil detach "$MOUNT_POINT"
DMG_MOUNTED=0

section "SUCCESS"
echo "Generated DMG: $DMG_PATH"
echo "Install on the M1, then run:"
echo "./scripts/diagnose_macos_bundle.sh \"/Applications/YTDL Studio.app\""
