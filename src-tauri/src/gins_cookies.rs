use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use rusqlite::{Connection, OpenFlags};

/// Chave mestra AES-256-GCM do motor GinsBrowser / DICloak
pub const GINS_AES_KEY: &[u8; 32] = b"PRCeHu99%!f#zU&j9xx5cQsF2y^9#6J$";

/// Localiza todos os bancos de dados de Cookies do GinsBrowser disponíveis no sistema.
/// Prioriza ambientes ativos listados em `running-envs.json`, seguidos pelos mais recentemente
/// modificados em `.DICloakCache` e outros diretórios conhecidos.
pub fn find_gins_cookie_databases() -> Vec<PathBuf> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };

    let app_support = home.join("Library/Application Support");
    let mut found = Vec::new();
    let mut seen = HashSet::new();

    // 1. Ambientes ativos em running-envs.json
    let running_envs_file = app_support.join("DICloak/runtime/running-envs.json");
    if running_envs_file.exists() {
        if let Ok(content) = fs::read_to_string(&running_envs_file) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(arr) = json.as_array() {
                    for item in arr {
                        if let Some(env_id) = item.get("envId").and_then(|v| v.as_str()) {
                            let candidate = app_support
                                .join(".DICloakCache")
                                .join(env_id)
                                .join(format!("ud_{}", env_id))
                                .join("Default/Network/Cookies");
                            if candidate.exists() && seen.insert(candidate.clone()) {
                                found.push(candidate);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Busca recursiva em .DICloakCache
    let dicloak_cache = app_support.join(".DICloakCache");
    if dicloak_cache.exists() {
        let mut candidates = Vec::new();
        find_cookies_recursive(&dicloak_cache, 4, &mut candidates);
        // Ordena por data de modificação (mais recente primeiro)
        candidates.sort_by(|a, b| {
            let m_a = a.metadata().and_then(|m| m.modified()).ok();
            let m_b = b.metadata().and_then(|m| m.modified()).ok();
            m_b.cmp(&m_a)
        });
        for c in candidates {
            if seen.insert(c.clone()) {
                found.push(c);
            }
        }
    }

    // 3. Fallbacks adicionais
    let extra_candidates = [
        app_support.join("GinsBrowser/Default/Network/Cookies"),
        app_support.join("DICloak/Cookies"),
    ];
    for extra in extra_candidates {
        if extra.exists() && seen.insert(extra.clone()) {
            found.push(extra);
        }
    }

    found
}

fn find_cookies_recursive(dir: &Path, depth: usize, results: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(name) = path.file_name() {
                    if name == "Cookies" {
                        results.push(path);
                    }
                }
            } else if path.is_dir() {
                find_cookies_recursive(&path, depth - 1, results);
            }
        }
    }
}

/// Decripta o valor de um cookie do GinsBrowser criptografado com AES-256-GCM (v10).
pub fn decrypt_gins_cookie(encrypted: &[u8]) -> Option<String> {
    if !encrypted.starts_with(b"v10") || encrypted.len() < 31 {
        return None;
    }

    let nonce_bytes = &encrypted[3..15];
    let ciphertext = &encrypted[15..];

    let cipher = Aes256Gcm::new_from_slice(GINS_AES_KEY).ok()?;
    let nonce = Nonce::try_from(nonce_bytes).ok()?;

    let decrypted = cipher.decrypt(&nonce, ciphertext).ok()?;
    Some(String::from_utf8_lossy(&decrypted).into_owned())
}

#[derive(Debug, Clone)]
pub struct DecryptedCookie {
    pub host_key: String,
    pub path: String,
    pub is_secure: bool,
    pub is_httponly: bool,
    pub expires_utc: i64,
    pub name: String,
    pub value: String,
}

/// Lê cookies de um arquivo SQLite de Cookies do GinsBrowser (copiando temporariamente para evitar locks).
pub fn read_cookies_from_sqlite(db_path: &Path) -> Result<Vec<DecryptedCookie>, String> {
    if !db_path.exists() {
        return Err(format!("Arquivo não encontrado: {}", db_path.to_string_lossy()));
    }

    // Cria cópia temporária do arquivo SQLite e arquivos WAL/SHM associados
    let temp_dir = std::env::temp_dir().join(format!("ytdl_gins_{}", std::process::id()));
    let _ = fs::create_dir_all(&temp_dir);
    let temp_db = temp_dir.join("Cookies");

    if let Err(e) = fs::copy(db_path, &temp_db) {
        return Err(format!("Falha ao copiar banco de cookies: {}", e));
    }

    let wal = db_path.with_file_name("Cookies-wal");
    if wal.exists() {
        let _ = fs::copy(&wal, temp_dir.join("Cookies-wal"));
    }
    let shm = db_path.with_file_name("Cookies-shm");
    if shm.exists() {
        let _ = fs::copy(&shm, temp_dir.join("Cookies-shm"));
    }

    let result = (|| {
        let conn = Connection::open_with_flags(&temp_db, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| format!("Erro ao abrir SQLite: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT host_key, path, is_secure, is_httponly, expires_utc, name, value, encrypted_value \
                 FROM cookies",
            )
            .map_err(|e| format!("Erro no prepare SQLite: {}", e))?;

        let mut rows = stmt
            .query([])
            .map_err(|e| format!("Erro na query de cookies: {}", e))?;

        let mut cookies = Vec::new();

        while let Some(row) = rows.next().map_err(|e| format!("Erro no cursor: {}", e))? {
            let host_key: String = row.get(0).unwrap_or_default();
            let path: String = row.get(1).unwrap_or_else(|_| "/".to_string());
            let is_secure: i64 = row.get(2).unwrap_or(0);
            let is_httponly: i64 = row.get(3).unwrap_or(0);
            let expires_utc: i64 = row.get(4).unwrap_or(0);
            let name: String = row.get(5).unwrap_or_default();
            let plain_value: String = row.get(6).unwrap_or_default();
            let encrypted_value: Vec<u8> = row.get(7).unwrap_or_default();

            let final_val = if !plain_value.is_empty() {
                plain_value
            } else if !encrypted_value.is_empty() {
                decrypt_gins_cookie(&encrypted_value).unwrap_or_default()
            } else {
                String::new()
            };

            if !name.is_empty() && !final_val.is_empty() {
                cookies.push(DecryptedCookie {
                    host_key,
                    path,
                    is_secure: is_secure != 0,
                    is_httponly: is_httponly != 0,
                    expires_utc,
                    name,
                    value: final_val,
                });
            }
        }

        Ok(cookies)
    })();

    // Limpa pasta temporária
    let _ = fs::remove_dir_all(&temp_dir);

    result
}

/// Exporta os cookies do GinsBrowser para o formato Netscape HTTP Cookie File e salva em disco.
/// Retorna o PathBuf do arquivo gerado para uso no argumento `--cookies` do yt-dlp.
pub fn export_gins_cookies_to_netscape(target_file: &Path) -> Result<(PathBuf, usize), String> {
    let db_paths = find_gins_cookie_databases();
    if db_paths.is_empty() {
        return Err(
            "Nenhum perfil ou banco de dados de cookies do GinsBrowser foi encontrado no computador.\n\
             Certifique-se de que o GinsBrowser / DICloak está instalado e possui ambientes abertos ou com cookies salvos."
                .to_string(),
        );
    }

    let mut all_cookies: Vec<DecryptedCookie> = Vec::new();
    let mut seen_keys = HashSet::new();

    for db_path in db_paths {
        if let Ok(cookies) = read_cookies_from_sqlite(&db_path) {
            for c in cookies {
                // Deduplica por (host, path, name)
                let key = format!("{}|{}|{}", c.host_key, c.path, c.name);
                if seen_keys.insert(key) {
                    all_cookies.push(c);
                }
            }
        }
    }

    if all_cookies.is_empty() {
        return Err(
            "Nenhum cookie pôde ser extraído dos bancos de dados do GinsBrowser.\n\
             Abra o GinsBrowser e faça login no serviço desejado antes de analisar ou baixar."
                .to_string(),
        );
    }

    let mut lines = Vec::new();
    lines.push("# Netscape HTTP Cookie File".to_string());
    lines.push("# Exported automatically by YTDL Studio from GinsBrowser".to_string());
    lines.push(format!("# Generated at unix timestamp: {}", std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)));
    lines.push("".to_string());

    let count = all_cookies.len();

    for c in all_cookies {
        // Formato Netscape: domain \t include_subdomains \t path \t secure \t expiry \t name \t value
        let domain = if c.is_httponly {
            format!("#HttpOnly_{}", c.host_key)
        } else {
            c.host_key.clone()
        };

        let include_sub = if c.host_key.starts_with('.') {
            "TRUE"
        } else {
            "FALSE"
        };

        let secure = if c.is_secure { "TRUE" } else { "FALSE" };

        // Chromium expires_utc: microsegundos desde 1601-01-01
        // Unix timestamp: segundos desde 1970-01-01 (diferença de 11.644.473.600 segundos)
        let expiry = if c.expires_utc > 0 {
            (c.expires_utc / 1_000_000).saturating_sub(11_644_473_600)
        } else {
            0
        };

        lines.push(format!(
            "{}\t{}\t{}\t{}\t{}\t{}\t{}",
            domain, include_sub, c.path, secure, expiry, c.name, c.value
        ));
    }

    if let Some(parent) = target_file.parent() {
        let _ = fs::create_dir_all(parent);
    }

    fs::write(target_file, lines.join("\n") + "\n")
        .map_err(|e| format!("Falha ao salvar arquivo de cookies Netscape: {}", e))?;

    Ok((target_file.to_path_buf(), count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decrypt_dummy_cookie() {
        let key = GINS_AES_KEY;
        let cipher = Aes256Gcm::new_from_slice(key).unwrap();
        let nonce_bytes = [1u8; 12];
        let nonce = Nonce::try_from(&nonce_bytes[..]).unwrap();
        let plaintext = b"session_token_12345";
        let ciphertext = cipher.encrypt(&nonce, plaintext.as_ref()).unwrap();

        let mut encrypted = Vec::new();
        encrypted.extend_from_slice(b"v10");
        encrypted.extend_from_slice(&nonce_bytes);
        encrypted.extend_from_slice(&ciphertext);

        let decrypted = decrypt_gins_cookie(&encrypted);
        assert_eq!(decrypted, Some("session_token_12345".to_string()));
    }

    #[test]
    fn test_find_databases() {
        let dbs = find_gins_cookie_databases();
        println!("Found databases: {:?}", dbs);
        // Em uma máquina com GinsBrowser, deve encontrar pelo menos 1
        assert!(!dbs.is_empty());
    }

    #[test]
    fn test_read_real_cookies() {
        let dbs = find_gins_cookie_databases();
        if let Some(first) = dbs.first() {
            let cookies = read_cookies_from_sqlite(first).unwrap();
            assert!(!cookies.is_empty());
            println!("Read {} cookies from {:?}", cookies.len(), first);
        }
    }

    #[test]
    fn test_export_real_cookies() {
        let temp_out = std::env::temp_dir().join("test_gins_export.txt");
        let (path, count) = export_gins_cookies_to_netscape(&temp_out).unwrap();
        assert!(count > 0);
        assert!(path.exists());
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# Netscape HTTP Cookie File"));
        println!("Exported {} cookies successfully to {:?}", count, path);
    }
}
