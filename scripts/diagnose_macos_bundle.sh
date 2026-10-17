#!/usr/bin/env bash
# Diagnose an installed or staged macOS .app bundle without hiding stderr.
# Usage:
#   ./scripts/diagnose_macos_bundle.sh "/Applications/YTDL Studio.app"
#   ./scripts/diagnose_macos_bundle.sh "src-tauri/.../YTDL Studio.app" --skip-main-run

set -uo pipefail

APP="${1:-}"
SKIP_MAIN_RUN=0

if [[ -z "$APP" || "$APP" == "-h" || "$APP" == "--help" ]]; then
  echo "Usage: $0 \"/path/to/YTDL Studio.app\" [--skip-main-run]"
  exit 64
fi

shift || true
for arg in "$@"; do
  case "$arg" in
    --skip-main-run) SKIP_MAIN_RUN=1 ;;
    *)
      echo "Unknown argument: $arg"
      exit 64
      ;;
  esac
done

if [[ "$APP" != /* ]]; then
  APP="$(cd "$(dirname "$APP")" 2>/dev/null && pwd -P)/$(basename "$APP")"
fi

section() {
  printf '\n=== %s ===\n' "$1"
}

run() {
  printf '+'
  printf ' %q' "$@"
  printf '\n'
  "$@"
  local status=$?
  echo "[exit $status]"
  return 0
}

run_pipe() {
  local label="$1"
  shift
  printf '+ %s\n' "$label"
  "$@"
  local status=$?
  echo "[exit $status]"
  return 0
}

plist_value() {
  local key="$1"
  /usr/libexec/PlistBuddy -c "Print :$key" "$APP/Contents/Info.plist" 2>/dev/null ||
    defaults read "$APP/Contents/Info" "$key" 2>/dev/null ||
    true
}

MAIN="$(plist_value CFBundleExecutable)"

section "SYSTEM"
run sw_vers
run uname -m

section "APP EXISTS"
run ls -lah "$(dirname "$APP")"
run ls -lah "$APP"
run_pipe "find \"$APP\" -maxdepth 4 -type f | sed 's#^#FILE: #'" bash -c 'find "$1" -maxdepth 4 -type f | sed "s#^#FILE: #"' _ "$APP"

section "INFO.PLIST"
run defaults read "$APP/Contents/Info" CFBundleExecutable
run defaults read "$APP/Contents/Info" CFBundleIdentifier
run defaults read "$APP/Contents/Info" CFBundleShortVersionString
echo "MAIN=$MAIN"

section "ARCHITECTURE"
run file "$APP/Contents/MacOS/$MAIN"
run file "$APP/Contents/MacOS/yt-dlp"
run file "$APP/Contents/MacOS/ffmpeg"
run file "$APP/Contents/MacOS/deno"
run lipo -info "$APP/Contents/MacOS/$MAIN"
run lipo -info "$APP/Contents/MacOS/yt-dlp"
run lipo -info "$APP/Contents/MacOS/ffmpeg"
run lipo -info "$APP/Contents/MacOS/deno"

section "PERMISSIONS"
run ls -lah "$APP/Contents/MacOS"

section "SIGNATURE"
run codesign --verify --deep --strict --verbose=4 "$APP"
run codesign --verify --verbose=4 "$APP/Contents/MacOS/$MAIN"
run codesign --verify --verbose=4 "$APP/Contents/MacOS/yt-dlp"
run codesign --verify --verbose=4 "$APP/Contents/MacOS/ffmpeg"
run codesign --verify --verbose=4 "$APP/Contents/MacOS/deno"

section "SPCTL"
run spctl --assess --type execute --verbose=4 "$APP"

section "XATTR"
run xattr -lr "$APP"
run_pipe "xattr -lr \"$APP\" | grep -i quarantine" bash -c 'xattr -lr "$1" | grep -i quarantine' _ "$APP"

section "MIN MACOS TARGET"
run_pipe "otool -l \"$APP/Contents/MacOS/$MAIN\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" bash -c 'otool -l "$1/Contents/MacOS/$2" | grep -A5 -E "LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX"' _ "$APP" "$MAIN"
run_pipe "otool -l \"$APP/Contents/MacOS/yt-dlp\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" bash -c 'otool -l "$1/Contents/MacOS/yt-dlp" | grep -A5 -E "LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX"' _ "$APP"
run_pipe "otool -l \"$APP/Contents/MacOS/ffmpeg\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" bash -c 'otool -l "$1/Contents/MacOS/ffmpeg" | grep -A5 -E "LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX"' _ "$APP"
run_pipe "otool -l \"$APP/Contents/MacOS/deno\" | grep -A5 -E 'LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX'" bash -c 'otool -l "$1/Contents/MacOS/deno" | grep -A5 -E "LC_BUILD_VERSION|LC_VERSION_MIN_MACOSX"' _ "$APP"

section "DIRECT EXECUTION MAIN"
if [[ "$SKIP_MAIN_RUN" == "1" ]]; then
  echo "SKIPPED: --skip-main-run was provided."
else
  run "$APP/Contents/MacOS/$MAIN"
fi

section "DIRECT EXECUTION SIDECARS"
run "$APP/Contents/MacOS/deno" --version
run "$APP/Contents/MacOS/yt-dlp" --version
run "$APP/Contents/MacOS/ffmpeg" -version

section "EJS SMOKE TEST"
run "$APP/Contents/MacOS/yt-dlp" --js-runtimes "deno:$APP/Contents/MacOS/deno" --remote-components ejs:github -F "https://www.youtube.com/watch?v=ub0W7-rSkyg"
