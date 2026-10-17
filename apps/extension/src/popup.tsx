import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  applyPreset,
  buildDefaultOnlineSelection,
  sortAudioFormats,
  sortVideoFormats,
} from '../../../packages/core/src';
import type {
  DetectedVideo,
  JobSnapshot,
  OnlineDownloadSelection,
  ScanResult,
} from '../../../packages/core/src';
import {
  cancelJob,
  createJob,
  getApiSettings,
  openJobEvents,
  saveApiSettings,
  scanVideo,
} from './apiClient';
import {
  ACTIVE_VIDEO_STORAGE_KEY,
  API_SETTINGS_STORAGE_KEY,
  defaultApiSettings,
} from './messages';
import type { ApiSettings } from './messages';
import './popup.css';

function formatSize(bytes?: number): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mergeSelection(
  selection: OnlineDownloadSelection,
  updates: Partial<OnlineDownloadSelection>
): OnlineDownloadSelection {
  return { ...selection, ...updates };
}

function Popup() {
  const [video, setVideo] = useState<DetectedVideo | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selection, setSelection] = useState<OnlineDownloadSelection | null>(null);
  const [settings, setSettings] = useState<ApiSettings>(defaultApiSettings);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab.id) {
        try {
          const detected = await chrome.tabs.sendMessage<DetectedVideo | null>(activeTab.id, {
            type: 'GET_CURRENT_VIDEO',
          });
          if (detected) {
            await chrome.storage.local.set({ [ACTIVE_VIDEO_STORAGE_KEY]: detected });
            setVideo(detected);
            setSelection(buildDefaultOnlineSelection(detected.url));
          }
        } catch {
          // The popup can also be opened outside YouTube; storage fallback handles that.
        }
      }

      const stored = await chrome.storage.local.get<Record<string, DetectedVideo | ApiSettings>>([
        ACTIVE_VIDEO_STORAGE_KEY,
        API_SETTINGS_STORAGE_KEY,
      ]);
      const storedVideo = stored[ACTIVE_VIDEO_STORAGE_KEY] as DetectedVideo | undefined;
      if (storedVideo && !video) {
        setVideo(storedVideo);
        setSelection(buildDefaultOnlineSelection(storedVideo.url));
      }
      setSettings(await getApiSettings());
    }

    void load();
  }, []);

  const videos = useMemo(
    () => (scanResult ? sortVideoFormats(scanResult.formats) : []),
    [scanResult]
  );
  const audios = useMemo(
    () => (scanResult ? sortAudioFormats(scanResult.formats) : []),
    [scanResult]
  );

  const updateSelection = (updates: Partial<OnlineDownloadSelection>) => {
    setSelection((current) => (current ? mergeSelection(current, updates) : current));
  };

  const handleScan = async () => {
    if (!video) return;
    setBusy(true);
    setError('');
    setJob(null);
    try {
      await saveApiSettings(settings);
      const result = await scanVideo(video.url);
      setScanResult(result);
      const nextSelection = buildDefaultOnlineSelection(video.url);
      const bestAudio = sortAudioFormats(result.formats)[0];
      setSelection({
        ...nextSelection,
        audioFormatIds: bestAudio ? [bestAudio.id] : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handlePreset = (preset: 'mp4_edit' | '4k_max' | 'archive') => {
    if (!scanResult || !selection) return;
    updateSelection(applyPreset(scanResult, preset));
  };

  const handleAudioToggle = (id: string, checked: boolean) => {
    if (!selection) return;
    const audioFormatIds = checked
      ? [...selection.audioFormatIds, id]
      : selection.audioFormatIds.filter((audioId) => audioId !== id);
    updateSelection({
      audioFormatIds,
      container: audioFormatIds.length > 1 ? 'mkv' : selection.container,
    });
  };

  const handleCreateJob = async () => {
    if (!selection) return;
    setBusy(true);
    setError('');
    try {
      await saveApiSettings(settings);
      const created = await createJob(selection);
      setJob(created);
      const events = await openJobEvents(
        created.id,
        (snapshot) => {
          setJob(snapshot);
          if (snapshot.status === 'completed' || snapshot.status === 'failed' || snapshot.status === 'cancelled') {
            events.close();
          }
        },
        (err) => setError(err.message)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!job) return;
    setJob(await cancelJob(job.id));
  };

  return (
    <div className="app stack">
      <div className="header">
        <div>
          <div className="brand">YTDL Studio</div>
          <div className="muted">Online downloader para vídeos públicos</div>
        </div>
      </div>

      <div className="card stack">
        <label>
          API
          <input
            value={settings.baseUrl}
            onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
          />
        </label>
        <label>
          Token
          <input
            type="password"
            value={settings.token}
            placeholder="Bearer token do SaaS"
            onChange={(event) => setSettings({ ...settings, token: event.target.value })}
          />
        </label>
      </div>

      {!video && (
        <div className="card stack">
          <div className="title">Abra um vídeo público do YouTube.</div>
          <div className="muted">A extensão só envia a URL quando você clica em analisar.</div>
        </div>
      )}

      {video && (
        <div className="card stack">
          <div className="video">
            <img className="thumb" src={video.thumbnail} alt="" />
            <div>
              <div className="title">{video.title}</div>
              <div className="muted">{video.videoId}</div>
            </div>
          </div>
          <div className="notice">
            Processa apenas vídeos públicos nesta versão. Conteúdo que exige login será recusado.
          </div>
          <button className="button" onClick={handleScan} disabled={busy}>
            {busy && !scanResult ? 'Analisando...' : 'Analisar formatos'}
          </button>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {scanResult && selection && (
        <div className="card stack">
          <div className="row">
            <button className="button secondary" onClick={() => handlePreset('mp4_edit')}>MP4 edição</button>
            <button className="button secondary" onClick={() => handlePreset('4k_max')}>Máxima</button>
            <button className="button secondary" onClick={() => handlePreset('archive')}>Arquivo</button>
          </div>

          <label>
            Vídeo
            <select
              value={selection.videoFormatId}
              onChange={(event) => updateSelection({ videoFormatId: event.target.value })}
            >
              <option value="">Melhor automático</option>
              {videos.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.height ? `${format.height}p` : format.resolution || 'N/A'} · {format.ext} · {format.vcodec || 'codec'}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="muted">Áudio</div>
            <div className="scroll stack">
              {audios.map((format) => (
                <label className="check" key={format.id}>
                  <input
                    type="checkbox"
                    checked={selection.audioFormatIds.includes(format.id)}
                    onChange={(event) => handleAudioToggle(format.id, event.target.checked)}
                  />
                  <span>
                    {format.language || 'desconhecido'} · {format.ext} · {formatSize(format.filesizeApprox)} {format.note || ''}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="row">
            <label>
              Contêiner
              <select
                value={selection.container}
                onChange={(event) => updateSelection({ container: event.target.value as 'mp4' | 'mkv' })}
              >
                <option value="mp4">MP4</option>
                <option value="mkv">MKV</option>
              </select>
            </label>
            <label>
              Legendas
              <select
                value={selection.subtitleMode}
                onChange={(event) => updateSelection({ subtitleMode: event.target.value as OnlineDownloadSelection['subtitleMode'] })}
              >
                <option value="none">Nenhuma</option>
                <option value="manual">Manuais</option>
                <option value="auto">Automáticas</option>
                <option value="manual_and_auto">Manuais + automáticas</option>
              </select>
            </label>
          </div>

          <button className="button" onClick={handleCreateJob} disabled={busy}>
            {busy ? 'Criando job...' : 'Criar job remoto'}
          </button>
        </div>
      )}

      {job && (
        <div className="card stack">
          <div className="title">{job.phase}</div>
          <div className="muted">Status: {job.status}</div>
          <div className="progress">
            <div style={{ width: `${Math.max(0, Math.min(100, job.progress || 0))}%` }} />
          </div>
          {job.error && <div className="error">{job.error.message}</div>}
          {job.downloadUrl && (
            <a className="link" href={job.downloadUrl} target="_blank" rel="noreferrer">
              Baixar arquivo final
            </a>
          )}
          {job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled' && (
            <button className="button secondary" onClick={handleCancel}>Cancelar</button>
          )}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Popup />);
