export type OutputContainer = 'mp4' | 'mkv';

export type SubtitleMode =
  | 'none'
  | 'manual'
  | 'auto'
  | 'manual_and_auto';

export type SubtitleDelivery = 'external_srt' | 'embedded' | 'both';

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

export interface OnlineDownloadSelection {
  url: string;
  videoFormatId: string;
  audioFormatIds: string[];
  container: OutputContainer;
  subtitleMode: SubtitleMode;
  subtitleLanguages: string[];
  subtitleDelivery: SubtitleDelivery;
  embedMetadata?: boolean;
  embedChapters?: boolean;
}

export interface PresetSelection {
  videoFormatId: string;
  audioFormatIds: string[];
  container: OutputContainer;
  subtitleMode: SubtitleMode;
  subtitleLanguages: string[];
  subtitleDelivery: SubtitleDelivery;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export interface JobRequest extends OnlineDownloadSelection {}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'downloading'
  | 'merging'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface JobSnapshot {
  id: string;
  status: JobStatus;
  phase: string;
  progress?: number;
  error?: ApiErrorBody;
  downloadUrl?: string;
  expiresAt?: string;
}
