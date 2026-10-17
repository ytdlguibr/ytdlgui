# macOS Standalone Distribution

This document covers only the macOS standalone bundle for YTDL Studio. Do not use this checklist to justify UI, download, cookies, preset, subtitle, or command-builder changes.

## Goal

The only acceptable proof for the M1 issue is the installed app on the affected MacBook M1:

- `/Applications/YTDL Studio.app` opens from Finder.
- `open "/Applications/YTDL Studio.app"` opens the app.
- `"/Applications/YTDL Studio.app/Contents/MacOS/ytdl-studio"` does not fail before the UI loads.
- Embedded `yt-dlp`, `ffmpeg`, and `deno` execute on the M1.
- The app reports all three dependencies as embedded.
- YouTube EJS smoke test lists real video/audio formats and does not fall back to image-only formats.
- Analyze and a short real download work on the M1.
- `ffprobe` validates the downloaded file.

Successful build output on another Mac is not proof.

## Build

From the project root:

```sh
MACOSX_DEPLOYMENT_TARGET=11.0 npm run build:standalone
```

To force architecture-specific builds:

```sh
npm run build:standalone:arm64
npm run build:standalone:intel
```

Outputs:

- arm64 host/default: `src-tauri/target/release/bundle/dmg/YTDL Studio_0.1.1_aarch64.dmg`
- forced arm64: `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/YTDL Studio_0.1.1_aarch64.dmg`
- Intel/Rosetta: `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/YTDL Studio_0.1.1_x86_64.dmg`

The build script:

1. Builds the Tauri `.app`.
2. Clears extended attributes on the staging app before signing.
3. Ensures executable bits for `Contents/MacOS/*`.
4. Signs sidecars first: `deno`, then `yt-dlp`, then `ffmpeg`.
5. Signs the main executable.
6. Signs the `.app` bundle last.
7. Verifies the signed staging app.
8. Copies the signed app to DMG staging with `ditto`.
9. Generates the DMG.
10. Mounts the final DMG and verifies the app inside the mounted image.

`spctl` is printed as a diagnostic. With ad-hoc signing, it can still reject on machines with normal Gatekeeper policy, especially if the DMG or app is quarantined.

The complete standalone experience requires macOS 12 or later: the bundled `ffmpeg` and Deno runtime both declare macOS 12 as their minimum deployment target.

## Intel Build On Apple Silicon

The Intel build is useful as a diagnostic fallback on Apple Silicon machines with Rosetta installed. It does not replace fixing the arm64 bundle; it helps separate an arm64-specific binary issue from Gatekeeper/quarantine/bundle problems.

Required sidecars:

- `src-tauri/binaries/yt-dlp-x86_64-apple-darwin`
- `src-tauri/binaries/ffmpeg-x86_64-apple-darwin`
- `src-tauri/binaries/deno-x86_64-apple-darwin`

Build it with:

```sh
npm run build:standalone:intel
```

Install this DMG on the affected M1 and run the same installed-app diagnostic:

```sh
./scripts/diagnose_macos_bundle.sh "/Applications/YTDL Studio.app"
```

If the Intel build opens on the M1 through Rosetta while the arm64 build does not, compare the two diagnostic outputs, especially `file`, `codesign`, `spctl`, `xattr`, and direct execution of the main binary.

## Diagnose An Installed App

On the affected M1, install the new DMG into `/Applications`, then run:

```sh
cd "/Users/capitolio/.gemini/antigravity/scratch/ytdl-studio"
./scripts/diagnose_macos_bundle.sh "/Applications/YTDL Studio.app"
```

Paste the full output into the report. Do not summarize it, and do not omit stderr.

For non-interactive staging checks where launching the UI would block the script:

```sh
./scripts/diagnose_macos_bundle.sh "src-tauri/target/release/bundle/macos/YTDL Studio.app" --skip-main-run
```

## Runtime Dependency Checks

The app must render the main UI before running heavyweight diagnostics.

Boot sequence:

1. Render UI immediately.
2. Read `~/Library/Application Support/YTDL Studio/dependencies-cache.json` if it exists.
3. Run `check_dependencies_light` in the background.
4. Run `debug_dependencies` only if the light check fails or the user requests the full diagnostic.

`check_dependencies_light` validates path resolution, file existence, file type, and executable permissions for `yt-dlp`, `ffmpeg`, and `deno`. It does not run `ffmpeg -version` on the happy path.

`debug_dependencies` runs the embedded binaries with a timeout and writes:

```sh
~/Library/Logs/YTDL Studio/dependencies-debug.json
```

External command timeout policy:

- light boot check: metadata-only
- full dependency diagnostic: 5 seconds per sidecar
- URL scan: 30 seconds
- real downloads: streamed process with progress, no total duration timeout

## YouTube EJS Runtime

The standalone app embeds Deno because current YouTube extraction can require a JavaScript runtime and EJS challenge solver. All backend `yt-dlp` calls add:

```sh
--js-runtimes "deno:/absolute/path/to/deno"
```

The backend also uses writable caches outside the read-only/translocated app bundle:

```sh
~/Library/Caches/YTDL Studio/deno
~/Library/Caches/YTDL Studio/yt-dlp
~/Library/Application Support/YTDL Studio
```

If the first YouTube scan/download fails with a JavaScript challenge error, the backend retries once with:

```sh
--remote-components ejs:github
```

There is no infinite retry. If both attempts fail, the error is classified as a YouTube JavaScript resolver/EJS failure rather than a generic format-selection error.

Manual EJS diagnostic:

```sh
APP="/Applications/YTDL Studio.app"
"$APP/Contents/MacOS/deno" --version
"$APP/Contents/MacOS/yt-dlp" \
  --js-runtimes "deno:$APP/Contents/MacOS/deno" \
  --remote-components ejs:github \
  -F "https://www.youtube.com/watch?v=ub0W7-rSkyg"
```

Expected:

- `deno --version` prints a version.
- `yt-dlp -F` lists real `video only` and `audio only` formats.
- The output does not contain `Only images are available`, `n challenge solving failed`, or `Signature solving failed`.

## Local M1 Repair Test

If Finder shows "O aplicativo nao pode ser aberto", run this on the M1:

```sh
APP="/Applications/YTDL Studio.app"

xattr -dr com.apple.quarantine "$APP" || true
chmod +x "$APP/Contents/MacOS/"* || true
codesign --force --sign - "$APP/Contents/MacOS/deno" || true
codesign --force --sign - "$APP/Contents/MacOS/yt-dlp" || true
codesign --force --sign - "$APP/Contents/MacOS/ffmpeg" || true
MAIN=$(defaults read "$APP/Contents/Info" CFBundleExecutable)
codesign --force --sign - "$APP/Contents/MacOS/$MAIN" || true
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=4 "$APP"
spctl --assess --type execute --verbose=4 "$APP"
open "$APP"
```

Interpretation:

- If it opens after this, the failure is quarantine, signature, or permissions.
- If it still does not open, check architecture, deployment target, bundle metadata, or a broken main binary.

## Deployment Target

Check the affected M1:

```sh
sw_vers
APP="/Applications/YTDL Studio.app"
MAIN=$(defaults read "$APP/Contents/Info" CFBundleExecutable)
otool -l "$APP/Contents/MacOS/$MAIN" | grep -A5 LC_BUILD_VERSION
otool -l "$APP/Contents/MacOS/ffmpeg" | grep -A5 LC_BUILD_VERSION
otool -l "$APP/Contents/MacOS/deno" | grep -A5 LC_BUILD_VERSION
```

If any `minos` value is greater than the M1 macOS version, that binary will not run there. Rebuild with:

```sh
MACOSX_DEPLOYMENT_TARGET=12.0 npm run build:standalone
```

If the M1 is on macOS 11 and the main app is still compatible, `ffmpeg` can remain a separate blocker if its embedded binary was built with `minos 12.0`. In that case, replace it with an arm64 or universal ffmpeg built for macOS 11, then rebuild.

## Hypotheses

### H1: Quarantine or Gatekeeper

Signals:

- `xattr` shows `com.apple.quarantine`.
- `spctl` rejects.
- Finder says the app cannot be opened before UI load.

Internal repair:

```sh
xattr -dr com.apple.quarantine "/Applications/YTDL Studio.app"
codesign --force --deep --sign - "/Applications/YTDL Studio.app"
```

Public distribution repair:

- Sign with `Developer ID Application`.
- Notarize with Apple.
- Staple the notarization ticket to the app or DMG.

### H2: Invalid Signature

Signals:

- `codesign --verify` fails.
- Resource envelope or invalid signature errors appear.

Repair:

- Clear xattrs before signing.
- Sign sidecars first.
- Sign the main executable.
- Sign the bundle last.
- Verify the app inside the mounted final DMG.

### H3: Broken Permissions

Signals:

- `ls -lah Contents/MacOS` lacks executable bits.
- Direct execution returns `Permission denied`.

Repair:

```sh
chmod +x "/Applications/YTDL Studio.app/Contents/MacOS/"*
```

### H4: Wrong Architecture

Signals:

- `file` does not show `arm64`.
- Direct execution returns `Bad CPU type in executable`.

Repair:

- Build the main app for arm64.
- Embed arm64 or universal sidecars.

### H5: Minimum macOS Too High

Signals:

- `otool` reports `minos` higher than `sw_vers` on the M1.

Repair:

- Rebuild the app with a lower `MACOSX_DEPLOYMENT_TARGET`.
- Replace any sidecar whose own `minos` is too high.

### H6: Wrong Bundle Copied To DMG

Signals:

- Staging app verifies, but the app installed from the DMG fails.
- `/Applications` contains an older bundle.

Repair:

- Delete `dmg_temp`.
- Delete old DMGs.
- Copy the signed app into staging with `ditto`.
- Mount and verify the final DMG before distributing it.

## Distribution Reality

Ad-hoc signing can be acceptable for controlled/internal distribution if users remove quarantine or use the appropriate Gatekeeper override flow.

For public distribution without friction, ad-hoc signing is not enough. The correct path is Apple `Developer ID Application` signing plus notarization.
