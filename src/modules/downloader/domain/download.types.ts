export type BrowserOption =
  | 'none'
  | 'ginsbrowser'
  | 'firefox'
  | 'chrome'
  | 'brave'
  | 'edge'
  | 'safari'
  | 'vivaldi';

export type OutputContainer = 'mp4' | 'mkv';

export type SubtitleMode =
  | 'none'
  | 'manual'
  | 'auto'
  | 'manual_and_auto';

export type SubtitleDelivery =
  | 'external_srt'
  | 'embedded'
  | 'both';

export interface MediaFormat {
  id: string;
  ext: string;
  resolution?: string;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  language?: string;
  languageName?: string;
  filesizeApprox?: number;
  note?: string;
  isVideoOnly: boolean;
  isAudioOnly: boolean;
}

export interface SubtitleTrack {
  language: string;
  name: string;
  formats: string[];
  automatic: boolean;
}

export interface ScanResult {
  id: string;
  title: string;
  webpageUrl: string;
  duration?: number;
  thumbnail?: string;
  formats: MediaFormat[];
  subtitles: SubtitleTrack[];
  automaticCaptions: SubtitleTrack[];
}

export interface DownloadSelection {
  url: string;
  browser: BrowserOption;
  videoFormatId: string;
  audioFormatIds: string[];
  container: OutputContainer;
  subtitleMode: SubtitleMode;
  subtitleLanguages: string[];
  subtitleDelivery: SubtitleDelivery;
  outputDir: string;
  outputTemplate: string;
  embedMetadata: boolean;
  embedChapters: boolean;
}

export type DownloadState =
  | 'idle'
  | 'checking_dependencies'
  | 'scanning'
  | 'ready'
  | 'downloading'
  | 'done'
  | 'error';

export interface DependenciesStatus {
  yt_dlp_path: string;
  ffmpeg_path: string;
  deno_path: string;
  yt_dlp_version?: string | null;
  ffmpeg_version?: string | null;
  deno_version?: string | null;
  checked_at?: string | null;
  provisional?: boolean;
}

export interface LightDependencyInfo {
  source: 'bundled' | 'env' | 'homebrew' | 'not_found' | string;
  path: string;
  exists: boolean;
  is_file: boolean;
  executable: boolean;
  metadata_mode: string;
  resolve_error: string | null;
}

export interface LightDependenciesResult {
  current_exe: string;
  current_exe_parent: string;
  cwd: string;
  sidecar_dir: string;
  bundle_sidecar_candidates: string[];
  injected_path: string;
  cache_file_path: string;
  cache_write_error: string | null;
  yt_dlp: LightDependencyInfo;
  ffmpeg: LightDependencyInfo;
  deno: LightDependencyInfo;
}

export interface DependencyInfo {
  source: 'bundled' | 'env' | 'homebrew' | 'not_found' | string;
  path: string;
  exists: boolean;
  is_file: boolean;
  executable: boolean;
  metadata_mode: string;
  spawn_ok: boolean;
  exit_code: number | null;
  stdout: string;
  stderr: string;
  spawn_error: string | null;
}

export interface DebugDependenciesResult {
  current_exe: string;
  current_exe_parent: string;
  cwd: string;
  sidecar_dir: string;
  bundle_sidecar_candidates: string[];
  injected_path: string;
  log_file_path: string;
  log_write_error: string | null;
  yt_dlp: DependencyInfo;
  ffmpeg: DependencyInfo;
  deno: DependencyInfo;
}

export interface EjsTestResult {
  url: string;
  args: string[];
  exit_code: number | null;
  stdout_contains_video_formats: boolean;
  stdout_excerpt: string;
  stderr: string;
  spawn_error: string | null;
}

export interface DebugEjsResult {
  yt_dlp_path: string;
  deno_path: string;
  deno_exists: boolean;
  deno_version: string;
  deno_spawn_ok: boolean;
  deno_dir: string;
  yt_dlp_cache_dir: string;
  injected_path: string;
  yt_dlp_ejs_test: EjsTestResult;
}

export interface YtdlpUpdateStatus {
  installed_version: string | null;
  channel: 'stable' | 'nightly' | string;
  update_available: boolean;
  latest_version: string | null;
  runtime_path: string;
  is_bundled: boolean;
  is_outdated: boolean;
  days_since_release: number | null;
  impersonate_available: boolean;
  impersonate_targets: string[];
}

export interface ImpersonateInfo {
  available: boolean;
  targets: string[];
  error: string | null;
}

export interface FacebookDiagnostic {
  url: string;
  yt_dlp_version: string | null;
  attempt1_success: boolean;
  attempt1_stderr_sanitized: string;
  attempt2_impersonate: boolean;
  attempt2_success: boolean;
  attempt2_stderr_sanitized: string;
  impersonate_targets: string[];
  error_classification: 'success' | 'facebook_parse_error' | 'outdated_version' | 'unknown_error' | string;
}
