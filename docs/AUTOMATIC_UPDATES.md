# Atualizacoes automaticas

O YTDL Studio usa o plugin oficial de atualizacao do Tauri e consulta somente:

`https://github.com/ytdlguibr/ytdlgui/releases/latest/download/latest.json`

O manifesto aponta para um pacote especifico por plataforma: macOS Apple Silicon,
macOS Intel e Windows x64. Antes de instalar, o aplicativo valida a assinatura
Minisign embutida no binario. Um asset ou manifesto alterado no GitHub sem a chave
privada e rejeitado.

## Comportamento no aplicativo

- A checagem acontece em segundo plano apos a primeira renderizacao.
- Nenhum pacote e baixado quando ja esta atualizado.
- Quando uma versao existe, a pessoa escolhe `Baixar e instalar`.
- No macOS, o aplicativo reinicia ao concluir. No Windows, o instalador NSIS assume
  o processo e reinicia o aplicativo.

O primeiro release que inclui este recurso deve ser instalado manualmente. Depois
dele, os releases posteriores aparecem no proprio YTDL Studio.

## Chave de assinatura

A chave privada nao pertence ao repositorio e nunca deve ser enviada ao GitHub.
Neste Mac ela fica em `~/.tauri/ytdl-studio-updater.key`, com permissao `600`; a
senha fica no Keychain com o servico `YTDL Studio Tauri updater signing key`.

Em outra maquina de release, defina antes do build:

```bash
export TAURI_SIGNING_PRIVATE_KEY="/caminho/seguro/ytdl-studio-updater.key"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="senha-da-chave"
```

Perder essa chave impede atualizar quem ja instalou o aplicativo. Guarde uma copia
offline segura antes de mover o fluxo de release para outra maquina ou CI.

## Publicar uma versao

1. Atualize a versao em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Garanta que a conta ativa do GitHub seja `ytdlguibr`.
3. Execute `npm run release:desktop`.

O script compila os tres instaladores, cria os pacotes de atualizacao assinados,
gera `latest.json`, calcula `SHA256SUMS.txt` e publica tudo em
`ytdlguibr/ytdlgui`. Ele recusa publicar com outra conta ou sobrescrever uma tag.
