use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::{env, fs};

use tauri::Emitter;
use tauri::Manager;

const ENV_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
/// Número máximo de dias antes de considerar o yt-dlp desatualizado
const YTDLP_OUTDATED_DAYS: i64 = 30;
/// Primeira execução de binários empacotados pode acionar verificações do macOS.
const SIDECAR_VERSION_TIMEOUT_MS: u64 = 20_000;

#[derive(serde::Serialize)]
pub struct DependenciesStatus {
    pub yt_dlp_path: String,
    pub ffmpeg_path: String,
    pub deno_path: String,
    pub yt_dlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub deno_version: Option<String>,
    pub checked_at: Option<String>,
    pub provisional: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct DependenciesCache {
    pub yt_dlp_path: String,
    pub ffmpeg_path: String,
    pub deno_path: String,
    pub yt_dlp_version: String,
    pub ffmpeg_version: String,
    pub deno_version: String,
    pub checked_at: String,
    pub app_version: String,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct LightDependencyInfo {
    pub source: String,
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub executable: bool,
    pub metadata_mode: String,
    pub resolve_error: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct LightDependenciesResult {
    pub current_exe: String,
    pub current_exe_parent: String,
    pub cwd: String,
    pub sidecar_dir: String,
    pub bundle_sidecar_candidates: Vec<String>,
    pub injected_path: String,
    pub cache_file_path: String,
    pub cache_write_error: Option<String>,
    pub yt_dlp: LightDependencyInfo,
    pub ffmpeg: LightDependencyInfo,
    pub deno: LightDependencyInfo,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct DependencyInfo {
    pub source: String,
    pub path: String,
    pub exists: bool,
    pub is_file: bool,
    pub executable: bool,
    pub metadata_mode: String,
    pub spawn_ok: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub spawn_error: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct DebugDependenciesResult {
    pub current_exe: String,
    pub current_exe_parent: String,
    pub cwd: String,
    pub sidecar_dir: String,
    pub bundle_sidecar_candidates: Vec<String>,
    pub injected_path: String,
    pub log_file_path: String,
    pub log_write_error: Option<String>,
    pub yt_dlp: DependencyInfo,
    pub ffmpeg: DependencyInfo,
    pub deno: DependencyInfo,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct EjsTestResult {
    pub url: String,
    pub args: Vec<String>,
    pub exit_code: Option<i32>,
    pub stdout_contains_video_formats: bool,
    pub stdout_excerpt: String,
    pub stderr: String,
    pub spawn_error: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct DebugEjsResult {
    pub yt_dlp_path: String,
    pub deno_path: String,
    pub deno_exists: bool,
    pub deno_version: String,
    pub deno_spawn_ok: bool,
    pub deno_dir: String,
    pub yt_dlp_cache_dir: String,
    pub injected_path: String,
    pub yt_dlp_ejs_test: EjsTestResult,
}

#[derive(Debug)]
struct TimedCommandOutput {
    status_code: Option<i32>,
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    spawn_error: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct YtdlpUpdateStatus {
    pub installed_version: Option<String>,
    pub channel: String,
    pub update_available: bool,
    pub latest_version: Option<String>,
    pub runtime_path: String,
    pub is_bundled: bool,
    pub is_outdated: bool,
    pub days_since_release: Option<i64>,
    pub impersonate_available: bool,
    pub impersonate_targets: Vec<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct ImpersonateInfo {
    pub available: bool,
    pub targets: Vec<String>,
    pub error: Option<String>,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct FacebookDiagnostic {
    pub url: String,
    pub yt_dlp_version: Option<String>,
    pub attempt1_success: bool,
    pub attempt1_stderr_sanitized: String,
    pub attempt2_impersonate: bool,
    pub attempt2_success: bool,
    pub attempt2_stderr_sanitized: String,
    pub impersonate_targets: Vec<String>,
    pub error_classification: String,
}

#[derive(Debug, Clone)]
struct ProcessEnvironment {
    path: String,
    deno_dir: PathBuf,
    xdg_cache_home: PathBuf,
    ytdlp_cache_dir: PathBuf,
}

impl ProcessEnvironment {
    fn apply(&self, command: &mut Command) {
        command
            .env("PATH", &self.path)
            .env("DENO_DIR", &self.deno_dir)
            .env("XDG_CACHE_HOME", &self.xdg_cache_home)
            .env("DENO_NO_UPDATE_CHECK", "1");
    }
}

#[derive(Debug, Clone)]
enum BinaryResolution {
    Bundled(PathBuf),
    EnvOverride(PathBuf),
    Homebrew(PathBuf),
    UsrLocal(PathBuf),
}

impl BinaryResolution {
    fn path(&self) -> &Path {
        match self {
            BinaryResolution::Bundled(path)
            | BinaryResolution::EnvOverride(path)
            | BinaryResolution::Homebrew(path)
            | BinaryResolution::UsrLocal(path) => path,
        }
    }

    fn source(&self) -> &'static str {
        match self {
            BinaryResolution::Bundled(_) => "bundled",
            BinaryResolution::EnvOverride(_) => "env",
            BinaryResolution::Homebrew(_) => "homebrew",
            BinaryResolution::UsrLocal(_) => "homebrew",
        }
    }
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.metadata()
        .map(|metadata| metadata.is_file() && (metadata.permissions().mode() & 0o111) != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(unix)]
fn executable_mode(path: &Path) -> String {
    use std::os::unix::fs::PermissionsExt;

    match path.metadata() {
        Ok(metadata) => format!("0o{:o}", metadata.permissions().mode() & 0o7777),
        Err(err) => format!("metadata_error: {:#?}", err),
    }
}

#[cfg(not(unix))]
fn executable_mode(path: &Path) -> String {
    if path.exists() {
        "n/a".to_string()
    } else {
        "metadata_error: not found".to_string()
    }
}

fn current_exe_path() -> Option<PathBuf> {
    std::env::current_exe().ok()
}

fn current_exe_parent() -> Option<PathBuf> {
    current_exe_path().and_then(|path| path.parent().map(Path::to_path_buf))
}

fn arch_suffix() -> &'static str {
    if cfg!(target_os = "windows") {
        if cfg!(target_arch = "x86_64") {
            "x86_64-pc-windows-msvc"
        } else {
            "unknown-pc-windows-msvc"
        }
    } else if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "aarch64-apple-darwin"
        } else if cfg!(target_arch = "x86_64") {
            "x86_64-apple-darwin"
        } else {
            "unknown-apple-darwin"
        }
    } else {
        "unknown-unknown-unknown"
    }
}

fn arch_sidecar_name(name: &str) -> String {
    let mut s = format!("{}-{}", name, arch_suffix());
    if cfg!(target_os = "windows") {
        s.push_str(".exe");
    }
    s
}

fn windows_base_name(name: &str) -> String {
    if cfg!(target_os = "windows") && !name.ends_with(".exe") {
        format!("{}.exe", name)
    } else {
        name.to_string()
    }
}

fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

fn bundled_binary_candidates<R: tauri::Runtime>(
    name: &str,
    app: &tauri::AppHandle<R>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let arch_name = arch_sidecar_name(name);
    let base_name = windows_base_name(name);

    if let Some(exe_dir) = current_exe_parent() {
        push_unique(&mut candidates, exe_dir.join(&base_name));
        push_unique(&mut candidates, exe_dir.join(&arch_name));

        let mut current = exe_dir;
        for _ in 0..10 {
            push_unique(&mut candidates, current.join("binaries").join(&arch_name));
            push_unique(&mut candidates, current.join("binaries").join(&base_name));
            push_unique(
                &mut candidates,
                current.join("src-tauri").join("binaries").join(&arch_name),
            );
            push_unique(
                &mut candidates,
                current.join("src-tauri").join("binaries").join(&base_name),
            );

            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
            } else {
                break;
            }
        }
    }

    if let Ok(res_dir) = app.path().resource_dir() {
        push_unique(&mut candidates, res_dir.join(&base_name));
        push_unique(&mut candidates, res_dir.join(&arch_name));
        push_unique(&mut candidates, res_dir.join("binaries").join(&arch_name));
        push_unique(&mut candidates, res_dir.join("binaries").join(&base_name));
    }

    candidates
}

fn all_bundle_sidecar_candidates<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<String> {
    let mut candidates = Vec::new();
    for name in ["yt-dlp", "ffmpeg", "deno"] {
        for path in bundled_binary_candidates(name, app) {
            let value = path.to_string_lossy().to_string();
            if !candidates.iter().any(|existing| existing == &value) {
                candidates.push(value);
            }
        }
    }
    candidates
}

fn get_sidecars_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    for name in ["yt-dlp", "ffmpeg", "deno"] {
        for candidate in bundled_binary_candidates(name, app) {
            if candidate.exists() {
                return candidate.parent().map(Path::to_path_buf);
            }
        }
    }

    None
}

fn ensure_ffmpeg_symlink(sidecars_dir: &Path) -> Result<(), std::io::Error> {
    let target_ffmpeg = sidecars_dir.join(windows_base_name("ffmpeg"));
    if target_ffmpeg.exists() {
        return Ok(());
    }

    let source_ffmpeg = sidecars_dir.join(arch_sidecar_name("ffmpeg"));
    if source_ffmpeg.exists() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            if symlink(&source_ffmpeg, &target_ffmpeg).is_err() {
                let _ = std::fs::copy(&source_ffmpeg, &target_ffmpeg);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = std::fs::copy(&source_ffmpeg, &target_ffmpeg);
        }
    }

    Ok(())
}

fn env_var_for(name: &str) -> &'static str {
    match name {
        "yt-dlp" => "YTDL_STUDIO_YTDLP_PATH",
        "ffmpeg" => "YTDL_STUDIO_FFMPEG_PATH",
        "deno" => "YTDL_STUDIO_DENO_PATH",
        _ => "YTDL_STUDIO_BINARY_PATH",
    }
}

fn resolve_binary_path<R: tauri::Runtime>(
    name: &str,
    app: &tauri::AppHandle<R>,
) -> Result<BinaryResolution, String> {
    // Prioridade 1: runtime atualizável em Application Support/bin (apenas yt-dlp)
    if name == "yt-dlp" {
        let runtime = runtime_ytdlp_path();
        if runtime.exists() && is_executable(&runtime) {
            return Ok(BinaryResolution::Bundled(runtime));
        }
    }

    for candidate in bundled_binary_candidates(name, app) {
        if candidate.exists() {
            return Ok(BinaryResolution::Bundled(candidate));
        }
    }

    if let Ok(env_path) = env::var(env_var_for(name)) {
        let path = PathBuf::from(env_path);
        if path.exists() {
            return Ok(BinaryResolution::EnvOverride(path));
        }
    }

    let disable_fallback = env::var("YTDL_STUDIO_DISABLE_FALLBACK").is_ok();
    if !disable_fallback {
        let brew_path = PathBuf::from(format!("/opt/homebrew/bin/{}", name));
        if brew_path.exists() {
            return Ok(BinaryResolution::Homebrew(brew_path));
        }

        let local_path = PathBuf::from(format!("/usr/local/bin/{}", name));
        if local_path.exists() {
            return Ok(BinaryResolution::UsrLocal(local_path));
        }
    }

    let candidates = bundled_binary_candidates(name, app)
        .into_iter()
        .map(|path| format!("  - {}", path.to_string_lossy()))
        .collect::<Vec<_>>()
        .join("\n");

    if disable_fallback {
        Err(format!(
            "Não foi possível encontrar '{}' embutido no app. YTDL_STUDIO_DISABLE_FALLBACK está ativa.\nCandidatos testados:\n{}",
            name, candidates
        ))
    } else {
        Err(format!(
            "Não encontrei '{}'. Tentei sidecars embutidos, {}, /opt/homebrew/bin e /usr/local/bin.\nCandidatos embutidos testados:\n{}",
            name,
            env_var_for(name),
            candidates
        ))
    }
}

fn injected_path(sidecar_dir: Option<&Path>) -> String {
    match sidecar_dir {
        Some(dir) => format!("{}:{}", dir.to_string_lossy(), ENV_PATH),
        None => ENV_PATH.to_string(),
    }
}

fn home_library_path(parts: &[&str]) -> PathBuf {
    let base = match env::var_os("HOME") {
        Some(home) => PathBuf::from(home),
        None => env::temp_dir(),
    };

    let mut path = base;
    for part in parts {
        path.push(part);
    }
    path
}

fn cache_root_path() -> PathBuf {
    home_library_path(&["Library", "Caches", "YTDL Studio"])
}

fn deno_cache_path() -> PathBuf {
    cache_root_path().join("deno")
}

fn ytdlp_cache_path() -> PathBuf {
    cache_root_path().join("yt-dlp")
}

fn app_support_path() -> PathBuf {
    home_library_path(&["Library", "Application Support", "YTDL Studio"])
}

/// Diretório onde o runtime yt-dlp atualizável é armazenado (fora do .app)
fn runtime_ytdlp_dir() -> PathBuf {
    app_support_path().join("bin")
}

/// Caminho do runtime yt-dlp atualizável
fn runtime_ytdlp_path() -> PathBuf {
    runtime_ytdlp_dir().join(windows_base_name("yt-dlp"))
}

/// Copia o binário embutido para o diretório de runtime se ainda não existir.
/// Retorna Ok(true) se copiou, Ok(false) se já existia.
fn ensure_runtime_ytdlp<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<bool, String> {
    let dest = runtime_ytdlp_path();
    if dest.exists() {
        return Ok(false);
    }

    // Garante que o diretório existe
    let dir = runtime_ytdlp_dir();
    fs::create_dir_all(&dir).map_err(|e| {
        format!("Falha ao criar {}: {}", dir.to_string_lossy(), e)
    })?;

    // Encontra o binário embutido
    let bundled = bundled_binary_candidates("yt-dlp", app)
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "yt-dlp embutido não encontrado para bootstrap".to_string())?;

    fs::copy(&bundled, &dest).map_err(|e| {
        format!(
            "Falha ao copiar yt-dlp de {} para {}: {}",
            bundled.to_string_lossy(),
            dest.to_string_lossy(),
            e
        )
    })?;

    // chmod +x
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dest)
            .map_err(|e| format!("metadata error: {}", e))?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dest, perms)
            .map_err(|e| format!("chmod +x error: {}", e))?;
    }

    Ok(true)
}

/// Lê a versão de um binário yt-dlp via `yt-dlp --version`.
/// Retorna None se falhar.
fn get_ytdlp_version(path: &Path, process_env: &ProcessEnvironment) -> Option<String> {
    let output = run_command_with_timeout(
        path,
        &["--version".to_string()],
        process_env,
        SIDECAR_VERSION_TIMEOUT_MS,
    );
    if output.success {
        let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !v.is_empty() { Some(v) } else { None }
    } else {
        None
    }
}

/// Retorna quantos dias se passaram desde que a versão foi lançada.
/// Versões no formato YYYY.MM.DD
fn days_since_version(version: &str) -> Option<i64> {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() < 3 {
        return None;
    }
    let year: i64 = parts[0].parse().ok()?;
    let month: i64 = parts[1].parse().ok()?;
    let day: i64 = parts[2].parse().ok()?;

    // Data simples: calcula dias desde 1970-01-01 sem dependências externas
    fn days_from_date(y: i64, m: i64, d: i64) -> i64 {
        let days_in_month = [0i64, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let leap = |yr: i64| (yr % 4 == 0 && yr % 100 != 0) || yr % 400 == 0;
        let mut total = 0i64;
        for yr in 1970..y {
            total += if leap(yr) { 366 } else { 365 };
        }
        for mo in 1..m {
            total += days_in_month[mo as usize];
            if mo == 2 && leap(y) { total += 1; }
        }
        total += d;
        total
    }

    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    let now_days = now_secs / 86400 + 719162; // 719162 = days from 1970-01-01 to 1970-01-01 offset correction from epoch
    let version_days = days_from_date(year, month, day);
    Some(now_days - version_days)
}

fn ensure_runtime_dirs() -> Result<(), String> {
    for path in [
        cache_root_path(),
        deno_cache_path(),
        ytdlp_cache_path(),
        app_support_path(),
        runtime_ytdlp_dir(),
    ] {
        fs::create_dir_all(&path).map_err(|err| {
            format!(
                "Falha ao criar diretório gravável {}: {:#?}",
                path.to_string_lossy(),
                err
            )
        })?;
    }

    Ok(())
}

fn process_environment(sidecar_dir: Option<&Path>) -> ProcessEnvironment {
    ProcessEnvironment {
        path: injected_path(sidecar_dir),
        deno_dir: deno_cache_path(),
        xdg_cache_home: cache_root_path(),
        ytdlp_cache_dir: ytdlp_cache_path(),
    }
}

fn binary_arg(name: &str) -> &'static str {
    match name {
        "yt-dlp" | "deno" => "--version",
        _ => "-version",
    }
}

fn read_pipe_to_end<R: Read + Send + 'static>(mut pipe: R) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut buffer = Vec::new();
        if pipe.read_to_end(&mut buffer).is_ok() {
            buffer
        } else {
            Vec::new()
        }
    })
}

fn join_pipe(handle: Option<thread::JoinHandle<Vec<u8>>>) -> Vec<u8> {
    match handle {
        Some(handle) => match handle.join() {
            Ok(buffer) => buffer,
            Err(_) => Vec::new(),
        },
        None => Vec::new(),
    }
}

fn run_command_with_timeout(
    path: &Path,
    args: &[String],
    process_env: &ProcessEnvironment,
    timeout_ms: u64,
) -> TimedCommandOutput {
    let mut command = Command::new(path);
    process_env.apply(&mut command);

    let mut child = match command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            return TimedCommandOutput {
                status_code: None,
                success: false,
                stdout: Vec::new(),
                stderr: Vec::new(),
                spawn_error: Some(format!("{:#?}", err)),
            };
        }
    };

    let stdout_handle = child.stdout.take().map(read_pipe_to_end);
    let stderr_handle = child.stderr.take().map(read_pipe_to_end);
    let started = Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return TimedCommandOutput {
                    status_code: status.code(),
                    success: status.success(),
                    stdout: join_pipe(stdout_handle),
                    stderr: join_pipe(stderr_handle),
                    spawn_error: None,
                };
            }
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let kill_result = child.kill();
                    let _ = child.wait();
                    let mut error = format!("timeout after {} ms", timeout_ms);
                    if let Err(err) = kill_result {
                        error.push_str(&format!("; kill_error: {:#?}", err));
                    }

                    return TimedCommandOutput {
                        status_code: None,
                        success: false,
                        stdout: join_pipe(stdout_handle),
                        stderr: join_pipe(stderr_handle),
                        spawn_error: Some(error),
                    };
                }

                thread::sleep(Duration::from_millis(25));
            }
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                return TimedCommandOutput {
                    status_code: None,
                    success: false,
                    stdout: join_pipe(stdout_handle),
                    stderr: join_pipe(stderr_handle),
                    spawn_error: Some(format!("try_wait_error: {:#?}", err)),
                };
            }
        }
    }
}

fn dependency_info_from_resolution(
    name: &str,
    resolution: Result<BinaryResolution, String>,
    process_env: &ProcessEnvironment,
    timeout_ms: u64,
) -> DependencyInfo {
    match resolution {
        Ok(resolution) => {
            let path = resolution.path().to_path_buf();
            let args = vec![binary_arg(name).to_string()];
            let output = run_command_with_timeout(&path, &args, process_env, timeout_ms);

            let exists = path.exists();
            let is_file = path.is_file();
            let executable = is_executable(&path);
            let metadata_mode = executable_mode(&path);

            DependencyInfo {
                source: resolution.source().to_string(),
                path: path.to_string_lossy().to_string(),
                exists,
                is_file,
                executable,
                metadata_mode,
                spawn_ok: output.spawn_error.is_none(),
                exit_code: output.status_code,
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                spawn_error: output.spawn_error,
            }
        }
        Err(err) => DependencyInfo {
            source: "not_found".to_string(),
            path: "not_found".to_string(),
            exists: false,
            is_file: false,
            executable: false,
            metadata_mode: "metadata_error: binary not found".to_string(),
            spawn_ok: false,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            spawn_error: Some(err),
        },
    }
}

fn debug_current_exe() -> (Option<PathBuf>, String, String) {
    match env::current_exe() {
        Ok(path) => {
            let current_exe = path.to_string_lossy().to_string();
            let current_exe_parent = path
                .parent()
                .map(|parent| parent.to_string_lossy().to_string())
                .unwrap_or_else(|| {
                    format!(
                        "current_exe_parent_error: current_exe has no parent ({})",
                        current_exe
                    )
                });

            (Some(path), current_exe, current_exe_parent)
        }
        Err(err) => (
            None,
            format!("current_exe_error: {:#?}", err),
            format!(
                "current_exe_parent_error: current_exe unavailable: {:#?}",
                err
            ),
        ),
    }
}

fn debug_cwd() -> String {
    match env::current_dir() {
        Ok(path) => path.to_string_lossy().to_string(),
        Err(err) => format!("current_dir_error: {:#?}", err),
    }
}

fn dependency_log_path() -> PathBuf {
    home_library_path(&["Library", "Logs", "YTDL Studio", "dependencies-debug.json"])
}

fn dependencies_cache_path() -> PathBuf {
    app_support_path().join("dependencies-cache.json")
}

fn unix_timestamp_string() -> String {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_secs().to_string(),
        Err(err) => format!("system_time_error: {:#?}", err),
    }
}

fn read_dependencies_cache_file() -> Result<Option<DependenciesCache>, String> {
    let path = dependencies_cache_path();
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(&path).map_err(|err| {
        format!(
            "Falha ao ler cache de dependências em {}: {:#?}",
            path.to_string_lossy(),
            err
        )
    })?;

    let cache = serde_json::from_str::<DependenciesCache>(&contents).map_err(|err| {
        format!(
            "Falha ao interpretar cache de dependências em {}: {:#?}",
            path.to_string_lossy(),
            err
        )
    })?;

    Ok(Some(cache))
}

fn cache_paths_are_valid(cache: &DependenciesCache) -> bool {
    let yt_dlp = PathBuf::from(&cache.yt_dlp_path);
    let ffmpeg = PathBuf::from(&cache.ffmpeg_path);
    let deno = PathBuf::from(&cache.deno_path);

    yt_dlp.exists()
        && yt_dlp.is_file()
        && is_executable(&yt_dlp)
        && ffmpeg.exists()
        && ffmpeg.is_file()
        && is_executable(&ffmpeg)
        && deno.exists()
        && deno.is_file()
        && is_executable(&deno)
}

fn ui_dependency_path_from_raw_path(path: &str) -> String {
    if path.contains(".app/Contents/MacOS/") {
        "embutido no app".to_string()
    } else {
        path.to_string()
    }
}

fn status_from_cache(cache: &DependenciesCache, provisional: bool) -> DependenciesStatus {
    DependenciesStatus {
        yt_dlp_path: ui_dependency_path_from_raw_path(&cache.yt_dlp_path),
        ffmpeg_path: ui_dependency_path_from_raw_path(&cache.ffmpeg_path),
        deno_path: ui_dependency_path_from_raw_path(&cache.deno_path),
        yt_dlp_version: Some(cache.yt_dlp_version.clone()),
        ffmpeg_version: Some(cache.ffmpeg_version.clone()),
        deno_version: Some(cache.deno_version.clone()),
        checked_at: Some(cache.checked_at.clone()),
        provisional,
    }
}

fn write_dependencies_cache(
    light: &LightDependenciesResult,
    status: &DependenciesStatus,
) -> Result<(), String> {
    let path = dependencies_cache_path();
    let cache = DependenciesCache {
        yt_dlp_path: light.yt_dlp.path.clone(),
        ffmpeg_path: light.ffmpeg.path.clone(),
        deno_path: light.deno.path.clone(),
        yt_dlp_version: status
            .yt_dlp_version
            .clone()
            .unwrap_or_else(|| "not_checked_light".to_string()),
        ffmpeg_version: status
            .ffmpeg_version
            .clone()
            .unwrap_or_else(|| "not_checked_light".to_string()),
        deno_version: status
            .deno_version
            .clone()
            .unwrap_or_else(|| "not_checked_light".to_string()),
        checked_at: unix_timestamp_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };

    let json = serde_json::to_string_pretty(&cache)
        .map_err(|err| format!("Falha ao serializar cache de dependências: {:#?}", err))?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Falha ao criar diretório do cache {}: {:#?}",
                parent.to_string_lossy(),
                err
            )
        })?;
    }

    fs::write(&path, json).map_err(|err| {
        format!(
            "Falha ao gravar cache de dependências em {}: {:#?}",
            path.to_string_lossy(),
            err
        )
    })
}

fn light_dependency_info_from_resolution(
    resolution: Result<BinaryResolution, String>,
) -> LightDependencyInfo {
    match resolution {
        Ok(resolution) => {
            let path = resolution.path().to_path_buf();
            LightDependencyInfo {
                source: resolution.source().to_string(),
                path: path.to_string_lossy().to_string(),
                exists: path.exists(),
                is_file: path.is_file(),
                executable: is_executable(&path),
                metadata_mode: executable_mode(&path),
                resolve_error: None,
            }
        }
        Err(err) => LightDependencyInfo {
            source: "not_found".to_string(),
            path: "not_found".to_string(),
            exists: false,
            is_file: false,
            executable: false,
            metadata_mode: "metadata_error: binary not found".to_string(),
            resolve_error: Some(err),
        },
    }
}

fn light_dependency_ok(info: &LightDependencyInfo) -> bool {
    info.exists && info.is_file && info.executable
}

fn build_light_dependencies<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> LightDependenciesResult {
    let sidecar_dir = get_sidecars_dir(app);
    let (_current_exe_path, current_exe, current_exe_parent) = debug_current_exe();
    let injected_path = injected_path(sidecar_dir.as_deref());

    LightDependenciesResult {
        current_exe,
        current_exe_parent,
        cwd: debug_cwd(),
        sidecar_dir: sidecar_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "not_found".to_string()),
        bundle_sidecar_candidates: all_bundle_sidecar_candidates(app),
        injected_path,
        cache_file_path: dependencies_cache_path().to_string_lossy().to_string(),
        cache_write_error: None,
        yt_dlp: light_dependency_info_from_resolution(resolve_binary_path("yt-dlp", app)),
        ffmpeg: light_dependency_info_from_resolution(resolve_binary_path("ffmpeg", app)),
        deno: light_dependency_info_from_resolution(resolve_binary_path("deno", app)),
    }
}

fn light_dependencies_json(light: &LightDependenciesResult) -> String {
    match serde_json::to_string_pretty(light) {
        Ok(json) => json,
        Err(err) => format!(
            "Falha ao serializar check_dependencies_light: {:#?}\nDebug bruto: {:#?}",
            err, light
        ),
    }
}

fn light_status_from_result(light: &LightDependenciesResult) -> DependenciesStatus {
    let cache = match read_dependencies_cache_file() {
        Ok(Some(cache)) => Some(cache),
        Ok(None) | Err(_) => None,
    };

    let versions_from_cache = cache.as_ref().filter(|cache| {
        cache.yt_dlp_path == light.yt_dlp.path
            && cache.ffmpeg_path == light.ffmpeg.path
            && cache.deno_path == light.deno.path
    });

    DependenciesStatus {
        yt_dlp_path: ui_light_dependency_path(&light.yt_dlp),
        ffmpeg_path: ui_light_dependency_path(&light.ffmpeg),
        deno_path: ui_light_dependency_path(&light.deno),
        yt_dlp_version: versions_from_cache.map(|cache| cache.yt_dlp_version.clone()),
        ffmpeg_version: versions_from_cache.map(|cache| cache.ffmpeg_version.clone()),
        deno_version: versions_from_cache.map(|cache| cache.deno_version.clone()),
        checked_at: Some(unix_timestamp_string()),
        provisional: false,
    }
}

fn build_debug_dependencies<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> DebugDependenciesResult {
    let sidecar_dir = get_sidecars_dir(app);
    if let Some(ref dir) = sidecar_dir {
        let _ = ensure_ffmpeg_symlink(dir);
    }

    let (_current_exe_path, current_exe, current_exe_parent) = debug_current_exe();

    let injected_path = injected_path(sidecar_dir.as_deref());
    let process_env = process_environment(sidecar_dir.as_deref());
    let yt_dlp = dependency_info_from_resolution(
        "yt-dlp",
        resolve_binary_path("yt-dlp", app),
        &process_env,
        SIDECAR_VERSION_TIMEOUT_MS,
    );
    let ffmpeg = dependency_info_from_resolution(
        "ffmpeg",
        resolve_binary_path("ffmpeg", app),
        &process_env,
        SIDECAR_VERSION_TIMEOUT_MS,
    );
    let deno = dependency_info_from_resolution(
        "deno",
        resolve_binary_path("deno", app),
        &process_env,
        SIDECAR_VERSION_TIMEOUT_MS,
    );

    DebugDependenciesResult {
        current_exe,
        current_exe_parent,
        cwd: debug_cwd(),
        sidecar_dir: sidecar_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "not_found".to_string()),
        bundle_sidecar_candidates: all_bundle_sidecar_candidates(app),
        injected_path,
        log_file_path: dependency_log_path().to_string_lossy().to_string(),
        log_write_error: None,
        yt_dlp,
        ffmpeg,
        deno,
    }
}

fn write_debug_dependencies_log(debug: &DebugDependenciesResult) -> Option<String> {
    let path = dependency_log_path();
    let json = match serde_json::to_string_pretty(debug) {
        Ok(json) => json,
        Err(err) => return Some(format!("serialize_error: {:#?}", err)),
    };

    if let Some(parent) = path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            return Some(format!(
                "create_dir_all_error: path={} error={:#?}",
                parent.to_string_lossy(),
                err
            ));
        }
    }

    match fs::write(&path, json) {
        Ok(()) => None,
        Err(err) => Some(format!(
            "write_error: path={} error={:#?}",
            path.to_string_lossy(),
            err
        )),
    }
}

fn build_and_persist_debug_dependencies<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> DebugDependenciesResult {
    let mut debug = build_debug_dependencies(app);

    if let Some(err) = write_debug_dependencies_log(&debug) {
        debug.log_write_error = Some(err);
        let _ = write_debug_dependencies_log(&debug);
    }

    debug
}

fn ui_light_dependency_path(info: &LightDependencyInfo) -> String {
    if info.source == "bundled" {
        "embutido no app".to_string()
    } else if info.path.trim().is_empty() || info.path == "not_found" {
        "não encontrado".to_string()
    } else {
        info.path.clone()
    }
}

fn command_failure(label: &str, path: &Path, output: &TimedCommandOutput) -> String {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{}\n{}", stdout, stderr);
    let code = output
        .status_code
        .map(|code| code.to_string())
        .unwrap_or_else(|| "sem código".to_string());

    let mut message = if is_youtube_js_solver_error(&combined) {
        format!(
            "Falha no resolvedor JavaScript do YouTube. O app precisa de Deno/EJS funcional para listar formatos reais de vídeo. Rode diagnóstico EJS.\n\n{} falhou. path: {}. exit_code: {}.",
            label,
            path.to_string_lossy(),
            code
        )
    } else {
        format!(
            "{} falhou. path: {}. exit_code: {}.",
            label,
            path.to_string_lossy(),
            code
        )
    };

    if !stderr.trim().is_empty() {
        message.push_str(&format!("\nstderr:\n{}", stderr.trim()));
    }
    if !stdout.trim().is_empty() {
        message.push_str(&format!("\nstdout:\n{}", stdout.trim()));
    }
    if stderr.trim().is_empty() && stdout.trim().is_empty() {
        message.push_str("\nO processo terminou sem stdout/stderr.");
    }
    if let Some(err) = &output.spawn_error {
        message.push_str(&format!("\nspawn_error:\n{}", err));
    }

    message
}

fn is_youtube_js_solver_error(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("n challenge solving failed")
        || lower.contains("signature solving failed")
        || lower.contains("supported javascript runtime")
        || lower.contains("challenge solver script distribution")
        || lower.contains("only images are available for download")
}

/// Detecta o erro específico de parse do Facebook no stderr/stdout do yt-dlp
fn is_facebook_parse_error(text: &str) -> bool {
    let lower = text.to_lowercase();
    lower.contains("[facebook]") && lower.contains("cannot parse")
        || lower.contains("[facebook]") && lower.contains("unable to extract")
        || lower.contains("[facebook]") && lower.contains("no video formats found")
}

/// Retorna true se a versão é mais antiga que YTDLP_OUTDATED_DAYS dias
fn is_version_outdated(version: &str) -> bool {
    days_since_version(version)
        .map(|days| days > YTDLP_OUTDATED_DAYS)
        .unwrap_or(false)
}

/// Sanitiza stderr/stdout de yt-dlp para diagnósticos:
/// remove cookies, tokens, headers sensíveis
fn sanitize_ytdlp_output(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for line in text.lines() {
        let lower = line.to_lowercase();
        // Remove linhas com cookies, tokens, auth, headers sensíveis
        if lower.contains("cookie")
            || lower.contains("authorization")
            || lower.contains("bearer ")
            || lower.contains("access_token")
            || lower.contains("x-api-key")
            || lower.contains("x-fb-")
        {
            result.push_str("[SANITIZED]\n");
        } else {
            result.push_str(line);
            result.push('\n');
        }
    }
    result.trim_end().to_string()
}

/// Obtém a lista de alvos de impersonação disponíveis no yt-dlp instalado
fn get_impersonate_targets(yt_dlp_path: &Path, process_env: &ProcessEnvironment) -> Vec<String> {
    let output = run_command_with_timeout(
        yt_dlp_path,
        &["--list-impersonate-targets".to_string()],
        process_env,
        SIDECAR_VERSION_TIMEOUT_MS,
    );
    if !output.success {
        return vec![];
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect()
}

fn ytdlp_args_with_runtime<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    args: &[String],
    remote_components: bool,
) -> Result<Vec<String>, String> {
    let deno = resolve_binary_path("deno", app)?;
    let ffmpeg = resolve_binary_path("ffmpeg", app).ok();

    let mut full_args = vec![
        "--js-runtimes".to_string(),
        format!("deno:{}", deno.path().to_string_lossy()),
        "--cache-dir".to_string(),
        ytdlp_cache_path().to_string_lossy().to_string(),
    ];

    if remote_components {
        full_args.push("--remote-components".to_string());
        full_args.push("ejs:github".to_string());
    }

    if let Some(ffmpeg) = ffmpeg {
        if let Some(parent) = ffmpeg.path().parent() {
            full_args.push("--ffmpeg-location".to_string());
            full_args.push(parent.to_string_lossy().to_string());
        }
    }

    full_args.extend(args.iter().cloned());
    Ok(full_args)
}

fn stdout_has_video_formats(stdout: &str) -> bool {
    stdout.lines().any(|line| {
        let lower = line.to_lowercase();
        (lower.contains("video only") || lower.contains("audio only"))
            && line.chars().next().map(|ch| ch.is_ascii_alphanumeric()).unwrap_or(false)
    })
}

fn command_context<R: tauri::Runtime>(
    name: &str,
    app: &tauri::AppHandle<R>,
) -> Result<(PathBuf, ProcessEnvironment), String> {
    ensure_runtime_dirs()?;
    let resolution = resolve_binary_path(name, app)?;
    let path = resolution.path().to_path_buf();
    let sidecar_dir = match &resolution {
        BinaryResolution::Bundled(path) => path.parent().map(Path::to_path_buf),
        _ => get_sidecars_dir(app),
    };

    if let Some(ref dir) = sidecar_dir {
        let _ = ensure_ffmpeg_symlink(dir);
    }

    Ok((path, process_environment(sidecar_dir.as_deref())))
}

#[tauri::command]
pub fn debug_dependencies<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> DebugDependenciesResult {
    build_and_persist_debug_dependencies(&app)
}

#[tauri::command]
pub fn debug_ejs<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<DebugEjsResult, String> {
    ensure_runtime_dirs()?;
    let (yt_dlp_path, process_env) = command_context("yt-dlp", &app)?;
    let deno_resolution = resolve_binary_path("deno", &app)?;
    let deno_path = deno_resolution.path().to_path_buf();

    let deno_version_args = vec!["--version".to_string()];
    let deno_version_output =
        run_command_with_timeout(
            &deno_path,
            &deno_version_args,
            &process_env,
            SIDECAR_VERSION_TIMEOUT_MS,
        );
    let deno_version = String::from_utf8_lossy(&deno_version_output.stdout).to_string();

    let url = "https://www.youtube.com/watch?v=ub0W7-rSkyg".to_string();
    let probe_args = vec!["-F".to_string(), url.clone()];
    let args = ytdlp_args_with_runtime(&app, &probe_args, true)?;
    let output = run_command_with_timeout(&yt_dlp_path, &args, &process_env, 60_000);
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();

    Ok(DebugEjsResult {
        yt_dlp_path: yt_dlp_path.to_string_lossy().to_string(),
        deno_path: deno_path.to_string_lossy().to_string(),
        deno_exists: deno_path.exists(),
        deno_version,
        deno_spawn_ok: deno_version_output.spawn_error.is_none() && deno_version_output.success,
        deno_dir: process_env.deno_dir.to_string_lossy().to_string(),
        yt_dlp_cache_dir: process_env.ytdlp_cache_dir.to_string_lossy().to_string(),
        injected_path: process_env.path.clone(),
        yt_dlp_ejs_test: EjsTestResult {
            url,
            args,
            exit_code: output.status_code,
            stdout_contains_video_formats: stdout_has_video_formats(&stdout),
            stdout_excerpt: stdout.chars().take(4_000).collect(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            spawn_error: output.spawn_error,
        },
    })
}

#[tauri::command]
pub fn get_dependencies_cache() -> Result<Option<DependenciesStatus>, String> {
    match read_dependencies_cache_file()? {
        Some(cache) if cache_paths_are_valid(&cache) => Ok(Some(status_from_cache(&cache, true))),
        Some(_) | None => Ok(None),
    }
}

#[tauri::command]
pub fn check_dependencies_light<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<DependenciesStatus, String> {
    let light = build_light_dependencies(&app);

    if !light_dependency_ok(&light.yt_dlp)
        || !light_dependency_ok(&light.ffmpeg)
        || !light_dependency_ok(&light.deno)
    {
        return Err(light_dependencies_json(&light));
    }

    let status = light_status_from_result(&light);
    let _ = write_dependencies_cache(&light, &status);

    Ok(status)
}

#[tauri::command]
pub fn check_dependencies<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<DependenciesStatus, String> {
    check_dependencies_light(app)
}

#[tauri::command]
pub fn get_default_download_dir() -> Result<String, String> {
    dirs::download_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Não foi possível determinar a pasta de downloads do sistema.".to_string())
}

/// Verifica o estado de atualização do yt-dlp runtime e embutido
#[tauri::command]
pub fn check_ytdlp_update<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> YtdlpUpdateStatus {
    let process_env = process_environment(None);
    let runtime = runtime_ytdlp_path();
    let is_runtime = runtime.exists() && is_executable(&runtime);

    let active_path = if is_runtime {
        runtime.clone()
    } else {
        // fallback: binário embutido
        resolve_binary_path("yt-dlp", &app)
            .map(|r| r.path().to_path_buf())
            .unwrap_or_else(|_| runtime.clone())
    };

    let installed_version = get_ytdlp_version(&active_path, &process_env);
    let days = installed_version.as_deref().and_then(days_since_version);
    let is_outdated = days.map(|d| d > YTDLP_OUTDATED_DAYS).unwrap_or(false);
    let impersonate_targets = get_impersonate_targets(&active_path, &process_env);

    YtdlpUpdateStatus {
        installed_version,
        channel: "stable".to_string(),
        update_available: is_outdated,
        latest_version: None, // verificação offline — usa heurística de idade
        runtime_path: runtime.to_string_lossy().to_string(),
        is_bundled: !is_runtime,
        is_outdated,
        days_since_release: days,
        impersonate_available: !impersonate_targets.is_empty(),
        impersonate_targets,
    }
}

/// Atualiza o yt-dlp runtime de forma atômica.
/// `channel`: "stable" ou "nightly"
#[tauri::command]
pub fn update_ytdlp<R: tauri::Runtime>(
    channel: String,
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    ensure_runtime_dirs()?;

    // Bootstrap: garante que o runtime existe antes de atualizar
    let _ = ensure_runtime_ytdlp(&app);

    let runtime = runtime_ytdlp_path();
    if !runtime.exists() {
        return Err("Runtime yt-dlp não encontrado após bootstrap.".to_string());
    }

    let process_env = process_environment(None);

    // Monta argumento de atualização
    let update_arg = match channel.as_str() {
        "nightly" => "--update-to".to_string(),
        _ => "--update".to_string(),
    };

    let mut args = vec![update_arg];
    if channel == "nightly" {
        args.push("nightly".to_string());
    }

    let output = run_command_with_timeout(&runtime, &args, &process_env, 120_000);

    if !output.success {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Atualização do yt-dlp falhou.\nstdout: {}\nstderr: {}",
            stdout.trim(),
            stderr.trim()
        ));
    }

    // Pega versão nova
    let new_version = get_ytdlp_version(&runtime, &process_env)
        .unwrap_or_else(|| "desconhecida".to_string());
    Ok(format!("yt-dlp atualizado para {} (canal: {})", new_version, channel))
}

/// Lista os alvos de impersonação do yt-dlp instalado
#[tauri::command]
pub fn list_impersonate_targets<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> ImpersonateInfo {
    match command_context("yt-dlp", &app) {
        Ok((path, process_env)) => {
            let targets = get_impersonate_targets(&path, &process_env);
            let available = !targets.is_empty();
            ImpersonateInfo { available, targets, error: None }
        }
        Err(e) => ImpersonateInfo {
            available: false,
            targets: vec![],
            error: Some(e),
        },
    }
}

/// Resolve argumentos de cookies de navegador.
/// Se browser for "ginsbrowser", descriptografa cookies do GinsBrowser/DICloak
/// e exporta para Netscape cookies.txt, retornando `["--cookies", path]`.
/// Para outros navegadores suportados nativamente pelo yt-dlp, retorna `["--cookies-from-browser", browser]`.
fn resolve_browser_cookie_args(browser: &str) -> Result<Vec<String>, String> {
    if browser == "none" || browser.is_empty() {
        Ok(vec![])
    } else if browser == "ginsbrowser" {
        let cookies_file = app_support_path().join("ginsbrowser_cookies.txt");
        let (path, count) = crate::gins_cookies::export_gins_cookies_to_netscape(&cookies_file)
            .map_err(|e| format!("GinsBrowser: {}", e))?;
        println!("[GINS_COOKIES] {} cookies exportados com sucesso para {:?}", count, path);
        Ok(vec!["--cookies".to_string(), path.to_string_lossy().to_string()])
    } else {
        Ok(vec!["--cookies-from-browser".to_string(), browser.to_string()])
    }
}

/// Coleta diagnóstico específico do Facebook (sanitizado)
#[tauri::command]
pub fn get_facebook_diagnostic(
    url: String,
    browser: String,
    app: tauri::AppHandle,
) -> Result<FacebookDiagnostic, String> {
    let (yt_dlp_path, process_env) = command_context("yt-dlp", &app)?;

    let installed_version = get_ytdlp_version(&yt_dlp_path, &process_env);
    let impersonate_targets = get_impersonate_targets(&yt_dlp_path, &process_env);

    // Tentativa 1: sem impersonação
    let mut args1: Vec<String> = vec![];
    let cookie_args = resolve_browser_cookie_args(&browser)?;
    args1.extend(cookie_args);
    args1.push("-vU".to_string());
    args1.push(url.clone());
    let args1_full = ytdlp_args_with_runtime(&app, &args1, false)?;
    let out1 = run_command_with_timeout(&yt_dlp_path, &args1_full, &process_env, 60_000);
    let stderr1 = String::from_utf8_lossy(&out1.stderr).to_string();
    let attempt1_success = out1.success;

    // Tentativa 2: com --impersonate chrome (se disponível)
    let has_impersonate = impersonate_targets.iter()
        .any(|t| t.to_lowercase().contains("chrome"));
    let (attempt2_success, attempt2_stderr) = if !attempt1_success && has_impersonate {
        let mut args2 = args1.clone();
        args2.push("--impersonate".to_string());
        args2.push("chrome".to_string());
        let args2_full = ytdlp_args_with_runtime(&app, &args2, false)?;
        let out2 = run_command_with_timeout(&yt_dlp_path, &args2_full, &process_env, 60_000);
        let stderr2 = String::from_utf8_lossy(&out2.stderr).to_string();
        (out2.success, stderr2)
    } else {
        (false, String::new())
    };

    let classification = if attempt1_success || attempt2_success {
        "success".to_string()
    } else if is_facebook_parse_error(&stderr1) {
        "facebook_parse_error".to_string()
    } else if is_version_outdated(installed_version.as_deref().unwrap_or("")) {
        "outdated_version".to_string()
    } else {
        "unknown_error".to_string()
    };

    Ok(FacebookDiagnostic {
        url,
        yt_dlp_version: installed_version,
        attempt1_success,
        attempt1_stderr_sanitized: sanitize_ytdlp_output(&stderr1),
        attempt2_impersonate: has_impersonate,
        attempt2_success,
        attempt2_stderr_sanitized: sanitize_ytdlp_output(&attempt2_stderr),
        impersonate_targets,
        error_classification: classification,
    })
}

#[tauri::command]
pub fn scan_url(url: String, browser: String, app: tauri::AppHandle) -> Result<String, String> {
    // Bootstrap: garante runtime na primeira execução (non-blocking se já existe)
    let _ = ensure_runtime_ytdlp(&app);

    let (yt_dlp_path, process_env) = command_context("yt-dlp", &app)?;
    let mut args = Vec::new();

    let cookie_args = resolve_browser_cookie_args(&browser)?;
    args.extend(cookie_args);

    args.push("-J".to_string());
    args.push(url.clone());

    let args_without_remote = ytdlp_args_with_runtime(&app, &args, false)?;
    let mut output =
        run_command_with_timeout(&yt_dlp_path, &args_without_remote, &process_env, 120_000);
    if !output.success {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}\n{}", stdout, stderr);
        if is_youtube_js_solver_error(&combined) {
            let args_with_remote = ytdlp_args_with_runtime(&app, &args, true)?;
            output = run_command_with_timeout(&yt_dlp_path, &args_with_remote, &process_env, 120_000);
        } else if is_facebook_parse_error(&combined) {
            // Retry com --impersonate chrome se disponível
            let targets = get_impersonate_targets(&yt_dlp_path, &process_env);
            let has_chrome = targets.iter().any(|t| t.to_lowercase().contains("chrome"));
            if has_chrome {
                let mut args_fb = args.clone();
                args_fb.push("--impersonate".to_string());
                args_fb.push("chrome".to_string());
                let args_fb_full = ytdlp_args_with_runtime(&app, &args_fb, false)?;
                output = run_command_with_timeout(&yt_dlp_path, &args_fb_full, &process_env, 120_000);
            }
        }
    }

    if !output.success {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let combined = format!("{}\n{}", stdout, stderr);

        // Mensagem de erro específica para Facebook
        if is_facebook_parse_error(&combined) {
            return Err(
                "O extrator do Facebook não conseguiu interpretar esta página. \
                Isso pode ser uma incompatibilidade temporária do yt-dlp com mudanças do Facebook. \
                Tente atualizar o motor yt-dlp para a versão mais recente (ou nightly), \
                usar cookies da conta que consegue reproduzir o vídeo, \
                ou aguardar correção upstream.".to_string()
            );
        }

        // Mensagem de erro específica para plataformas de membros/cursos (SPA)
        if combined.contains("Unsupported URL") && (url.contains("academypass.ai") || url.contains("hotmart") || url.contains("kiwify")) {
            return Err(
                "A URL informada é a página de navegação de uma plataforma de cursos/membros (Single Page Application).\n\n\
                O yt-dlp não consegue extrair o vídeo diretamente da casca da página porque o player de vídeo é carregado dinamicamente via JavaScript/iframe (ex: Vimeo, Panda Video, Cloudflare Stream).\n\n\
                Como baixar esta aula:\n\
                1. Abra a aula no navegador;\n\
                2. Inspecione o elemento do vídeo (F12 -> Elements ou aba Rede/Network);\n\
                3. Copie o link do player incorporado (ex: https://player.vimeo.com/video/...);\n\
                4. Cole o link direto do player no YTDL Studio.".to_string()
            );
        }

        return Err(command_failure("yt-dlp scan", &yt_dlp_path, &output));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
pub fn start_download(
    args: Vec<String>,
    window: tauri::Window,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let (yt_dlp_path, process_env) = command_context("yt-dlp", &app)?;

    // Substitui --cookies-from-browser ginsbrowser por --cookies <path>
    let mut processed_args = Vec::with_capacity(args.len());
    let mut skip_next = false;
    for i in 0..args.len() {
        if skip_next {
            skip_next = false;
            continue;
        }
        if args[i] == "--cookies-from-browser" && i + 1 < args.len() && args[i + 1] == "ginsbrowser" {
            let cookie_args = resolve_browser_cookie_args("ginsbrowser")?;
            processed_args.extend(cookie_args);
            skip_next = true;
        } else {
            processed_args.push(args[i].clone());
        }
    }

    let args_without_remote = ytdlp_args_with_runtime(&app, &processed_args, false)?;
    let args_with_remote = ytdlp_args_with_runtime(&app, &processed_args, true)?;

    fn run_streaming_download(
        yt_dlp_path: &Path,
        process_env: &ProcessEnvironment,
        args: &[String],
        window: &tauri::Window,
    ) -> Result<(), String> {
        let mut command = Command::new(yt_dlp_path);
        process_env.apply(&mut command);

        let mut child = command
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| {
                format!(
                    "Falha ao iniciar yt-dlp em {}: {}",
                    yt_dlp_path.to_string_lossy(),
                    err
                )
            })?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stderr_buffer = std::sync::Arc::new(std::sync::Mutex::new(String::new()));

        let window_stdout = window.clone();
        if let Some(stdout) = stdout {
            std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    let _ = window_stdout.emit("download-log", line);
                }
            });
        }

        let window_stderr = window.clone();
        if let Some(stderr) = stderr {
            let stderr_buffer = stderr_buffer.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    if let Ok(mut buffer) = stderr_buffer.lock() {
                        buffer.push_str(&line);
                        buffer.push('\n');
                    }
                    let _ = window_stderr.emit("download-log", line);
                }
            });
        }

        let status = child
            .wait()
            .map_err(|err| format!("Falha ao aguardar yt-dlp: {}", err))?;

        if !status.success() {
            let stderr = stderr_buffer
                .lock()
                .map(|buffer| buffer.clone())
                .unwrap_or_else(|_| "stderr_buffer_lock_error".to_string());
            let code = status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "desconhecido".to_string());

            if is_youtube_js_solver_error(&stderr) {
                return Err(format!(
                    "Falha no resolvedor JavaScript do YouTube. O app precisa de Deno/EJS funcional para listar formatos reais de vídeo. Rode diagnóstico EJS.\n\nyt-dlp terminou com código de erro {}\n\nstderr:\n{}",
                    code,
                    stderr.trim()
                ));
            }

            return Err(format!(
                "yt-dlp terminou com código de erro {}\n\nstderr:\n{}",
                code,
                stderr.trim()
            ));
        }

        Ok(())
    }

    match run_streaming_download(&yt_dlp_path, &process_env, &args_without_remote, &window) {
        Ok(()) => Ok(()),
        Err(err) if is_youtube_js_solver_error(&err) => {
            let _ = window.emit(
                "download-log",
                "Retry automático com --remote-components ejs:github".to_string(),
            );
            run_streaming_download(&yt_dlp_path, &process_env, &args_with_remote, &window)
        }
        Err(err) => Err(err),
    }
}

/// Exporta cookies do GinsBrowser para arquivo Netscape no diretório de suporte da aplicação
#[tauri::command]
pub fn export_gins_cookies() -> Result<String, String> {
    let cookies_file = app_support_path().join("ginsbrowser_cookies.txt");
    let (path, count) = crate::gins_cookies::export_gins_cookies_to_netscape(&cookies_file)?;
    Ok(format!("{} cookies do GinsBrowser exportados para {:?}", count, path))
}

