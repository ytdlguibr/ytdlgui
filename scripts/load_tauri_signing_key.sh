#!/usr/bin/env bash
# Loaded by release builders. The private key stays outside the project.

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" && -f "${TAURI_SIGNING_PRIVATE_KEY}" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY_PATH="$TAURI_SIGNING_PRIVATE_KEY"
  fi
  if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    echo "ERRO: TAURI_SIGNING_PRIVATE_KEY_PASSWORD nao foi definido."
    return 1
  fi
  return 0
fi

KEY_PATH="${YTDL_STUDIO_UPDATER_KEY_PATH:-$HOME/.tauri/ytdl-studio-updater.key}"
if [[ ! -f "$KEY_PATH" ]]; then
  echo "ERRO: chave privada do atualizador nao encontrada em $KEY_PATH"
  echo "Defina TAURI_SIGNING_PRIVATE_KEY e TAURI_SIGNING_PRIVATE_KEY_PASSWORD para assinar o release."
  return 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$KEY_PATH"
export TAURI_SIGNING_PRIVATE_KEY_PATH="$KEY_PATH"

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
  if ! command -v security >/dev/null 2>&1; then
    echo "ERRO: defina TAURI_SIGNING_PRIVATE_KEY_PASSWORD fora do macOS."
    return 1
  fi

  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password \
    -a "$USER" \
    -s 'YTDL Studio Tauri updater signing key' \
    -w 2>/dev/null)" || {
      echo "ERRO: senha da chave do atualizador nao encontrada no Keychain."
      return 1
    }
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
fi
