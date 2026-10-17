import type { DetectedVideo } from '../../../packages/core/src';

export const ACTIVE_VIDEO_STORAGE_KEY = 'ytdlStudioActiveVideo';
export const API_SETTINGS_STORAGE_KEY = 'ytdlStudioApiSettings';

export interface ApiSettings {
  baseUrl: string;
  token: string;
}

export interface VideoMessage {
  type: 'VIDEO_DETECTED' | 'VIDEO_CHANGED' | 'VIDEO_CLEARED';
  video?: DetectedVideo;
}

export interface OpenPanelMessage {
  type: 'OPEN_YTDL_STUDIO';
  video: DetectedVideo;
}

export interface GetCurrentVideoMessage {
  type: 'GET_CURRENT_VIDEO';
}

export interface ShowInlinePanelMessage {
  type: 'SHOW_INLINE_PANEL';
}

export type ExtensionMessage =
  | VideoMessage
  | OpenPanelMessage
  | GetCurrentVideoMessage
  | ShowInlinePanelMessage;

export const defaultApiSettings: ApiSettings = {
  baseUrl: 'https://api.ytdlstudio.app',
  token: '',
};
