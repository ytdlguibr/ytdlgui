import {
  type ApiErrorBody,
  type JobRequest,
  type JobSnapshot,
  type ScanResult,
} from '../../../packages/core/src';
import {
  API_SETTINGS_STORAGE_KEY,
  defaultApiSettings,
} from './messages';
import type { ApiSettings } from './messages';

async function readSettings(): Promise<ApiSettings> {
  const stored = await chrome.storage.local.get<Record<string, ApiSettings>>(
    API_SETTINGS_STORAGE_KEY
  );
  return {
    ...defaultApiSettings,
    ...(stored[API_SETTINGS_STORAGE_KEY] || {}),
  };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const settings = await readSettings();
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (settings.token.trim()) {
    headers.set('authorization', `Bearer ${settings.token.trim()}`);
  }

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let error: ApiErrorBody;
    try {
      error = (await response.json()) as ApiErrorBody;
    } catch {
      error = {
        error: `HTTP_${response.status}`,
        message: await response.text(),
      };
    }
    throw new Error(error.message || error.error);
  }

  return (await response.json()) as T;
}

export async function scanVideo(url: string): Promise<ScanResult> {
  return request<ScanResult>('/scan', {
    method: 'POST',
    body: JSON.stringify({ url, source: 'extension' }),
  });
}

export async function createJob(payload: JobRequest): Promise<JobSnapshot> {
  return request<JobSnapshot>('/jobs', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function cancelJob(id: string): Promise<JobSnapshot> {
  return request<JobSnapshot>(`/jobs/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
  });
}

export async function openJobEvents(
  id: string,
  onEvent: (snapshot: JobSnapshot) => void,
  onError: (error: Error) => void
): Promise<EventSource> {
  const settings = await readSettings();
  const url = new URL(
    `${settings.baseUrl.replace(/\/$/, '')}/jobs/${encodeURIComponent(id)}/events`
  );
  if (settings.token.trim()) {
    url.searchParams.set('token', settings.token.trim());
  }

  const events = new EventSource(url.toString());
  events.onmessage = (event) => onEvent(JSON.parse(event.data) as JobSnapshot);
  events.onerror = () => onError(new Error('Conexão de progresso interrompida.'));
  return events;
}

export async function saveApiSettings(settings: ApiSettings): Promise<void> {
  await chrome.storage.local.set({ [API_SETTINGS_STORAGE_KEY]: settings });
}

export async function getApiSettings(): Promise<ApiSettings> {
  return readSettings();
}
