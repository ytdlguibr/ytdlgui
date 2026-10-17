import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDownloaderStore } from '../modules/downloader/store/downloader.store';
import { UrlInput } from '../modules/downloader/components/UrlInput';
import { DownloadConfig } from '../modules/downloader/components/DownloadConfig';
import { ProgressLog } from '../modules/downloader/components/ProgressLog';
import { YtdlpUpdateBanner } from '../modules/downloader/components/YtdlpUpdateBanner';
import { AppUpdateBanner } from '../modules/downloader/components/AppUpdateBanner';
import {
  DependenciesStatus,
  DebugDependenciesResult,
  YtdlpUpdateStatus,
} from '../modules/downloader/domain/download.types';

const EMPTY_BACKEND_ERROR =
  'Backend retornou erro vazio. Isso é bug de tratamento de erro.';
const DEPENDENCY_LOG_PATH = '~/Library/Logs/YTDL Studio/dependencies-debug.json';
const appStart = performance.now();

type DependencyBootState = 'checking' | 'cached' | 'ok' | 'failed' | 'diagnosing';
type DebugPayload = DebugDependenciesResult | Record<string, unknown>;

function logBoot(event: string, extra: Record<string, unknown> = {}) {
  console.info('[boot]', {
    event,
    elapsed_ms: Math.round(performance.now() - appStart),
    ...extra,
  });
}

function stringifyInvokeError(error: unknown): string {
  if (typeof error === 'string') {
    return error.trim() || EMPTY_BACKEND_ERROR;
  }

  if (error instanceof Error) {
    return error.message.trim() || EMPTY_BACKEND_ERROR;
  }

  if (error == null) {
    return EMPTY_BACKEND_ERROR;
  }

  try {
    const json = JSON.stringify(error, null, 2);
    const value = json && json !== '{}' ? json : String(error);
    return value.trim() || EMPTY_BACKEND_ERROR;
  } catch {
    const value = String(error);
    return value.trim() || EMPTY_BACKEND_ERROR;
  }
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value, null, 2);
    return json?.trim() || EMPTY_BACKEND_ERROR;
  } catch (error) {
    return `Falha ao serializar diagnóstico no frontend: ${stringifyInvokeError(error)}`;
  }
}

function dependencyStatusText(status: DependenciesStatus, cached = false): string {
  const suffix = cached || status.provisional ? ' (cache)' : '';
  return `yt-dlp ${status.yt_dlp_path} OK | ffmpeg ${status.ffmpeg_path} OK | deno ${status.deno_path} OK${suffix}`;
}

function App() {
  const { appState, setAppState, depsStatus, setDepsStatus } = useDownloaderStore();
  const [errorMsg, setErrorMsg] = useState('');
  const [debugInfo, setDebugInfo] = useState<DebugPayload | null>(null);
  const [copied, setCopied] = useState(false);
  const [dependencyState, setDependencyState] =
    useState<DependencyBootState>('checking');
  const [dependencyMessage, setDependencyMessage] =
    useState('Verificando binários...');
  const [_ytdlpUpdateStatus, setYtdlpUpdateStatus] = useState<YtdlpUpdateStatus | null>(null);

  useEffect(() => {
    async function initOutputDir() {
      if (!appState || appState === 'error') return;
      const currentDir = useDownloaderStore.getState().selection.outputDir;
      if (!currentDir) {
        try {
          const defaultDir = await invoke<string>('get_default_download_dir');
          if (defaultDir) {
            useDownloaderStore.getState().updateSelection({ outputDir: defaultDir });
          }
        } catch (e) {
          console.error("Failed to get default download dir:", e);
        }
      }
    }
    void initOutputDir();
  }, []);

  useEffect(() => {
    logBoot('first_render');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadCache() {
      try {
        const cache = await invoke<DependenciesStatus | null>('get_dependencies_cache');
        if (!cancelled && cache) {
          setDepsStatus(cache);
          setDependencyState('cached');
          setDependencyMessage(dependencyStatusText(cache, true));
        }
      } catch (error) {
        console.warn('[boot] dependency cache ignored', error);
      }
    }

    async function checkLight() {
      logBoot('check_light_start');

      try {
        const status = await invoke<DependenciesStatus>('check_dependencies_light');
        if (cancelled) return;

        setDepsStatus(status);
        setDependencyState('ok');
        setDependencyMessage(dependencyStatusText(status));
        setAppState('idle');
        logBoot('check_light_done', { ok: true });
      } catch (error) {
        if (cancelled) return;

        const reportedError = stringifyInvokeError(error);
        setDepsStatus(null);
        setDependencyState('failed');
        setDependencyMessage('Falha ao validar binários');
        setErrorMsg(
          `Não foi possível validar os binários embutidos.\n\ncheck_dependencies_light:\n${reportedError}`
        );
        setAppState('error');
        logBoot('check_light_done', { ok: false });
      }
    }

    void loadCache();
    void checkLight();

    return () => {
      cancelled = true;
    };
  }, [setAppState, setDepsStatus]);

  const runFullDiagnostics = async (): Promise<DebugPayload> => {
    setDependencyState('diagnosing');
    setDependencyMessage('Rodando diagnóstico completo...');
    logBoot('debug_start');

    try {
      const debug = await invoke<DebugDependenciesResult>('debug_dependencies');
      setDebugInfo(debug);
      setErrorMsg(safeJson(debug));
      setDependencyState('failed');
      setDependencyMessage('Diagnóstico completo pronto');
      logBoot('debug_done', { ok: true });
      return debug;
    } catch (error) {
      const debugFailure = {
        debug_dependencies_invoke_error: stringifyInvokeError(error),
        log_file_path: DEPENDENCY_LOG_PATH,
      };
      setDebugInfo(debugFailure);
      setErrorMsg(safeJson(debugFailure));
      setDependencyState('failed');
      setDependencyMessage('Falha ao rodar diagnóstico completo');
      logBoot('debug_done', { ok: false });
      return debugFailure;
    }
  };

  const handleCopyDebug = async () => {
    const diagnostics = debugInfo ?? (await runFullDiagnostics());
    const payload = {
      error_reported: errorMsg.trim() || EMPTY_BACKEND_ERROR,
      log_file_path:
        'log_file_path' in diagnostics
          ? diagnostics.log_file_path
          : DEPENDENCY_LOG_PATH,
      debug_dependencies: diagnostics,
    };

    try {
      await navigator.clipboard.writeText(safeJson(payload));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setErrorMsg(
        `${errorMsg.trim() || EMPTY_BACKEND_ERROR}\n\nFalha ao copiar diagnóstico: ${stringifyInvokeError(error)}`
      );
    }
  };

  if (appState === 'error' && dependencyState !== 'ok' && dependencyState !== 'cached') {
    const visibleError = errorMsg.trim() || EMPTY_BACKEND_ERROR;
    const logFilePath =
      debugInfo &&
      'log_file_path' in debugInfo &&
      typeof debugInfo.log_file_path === 'string'
        ? debugInfo.log_file_path
        : DEPENDENCY_LOG_PATH;
    const diagnosticJson = debugInfo
      ? safeJson(debugInfo)
      : 'Diagnóstico completo ainda não executado.';

    return (
      <div className="flex flex-col items-center justify-center min-h-screen w-screen bg-background text-foreground p-8 overflow-y-auto">
        <div className="max-w-3xl w-full bg-card p-6 rounded-lg border border-border shadow-xl space-y-6">
          <h1 className="text-3xl text-destructive font-bold mb-2 flex items-center gap-2">
            Erro de Dependência
          </h1>
          <p className="text-muted-foreground text-sm">
            O aplicativo abriu, mas não conseguiu validar os binários embutidos de <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">yt-dlp</code>, <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">ffmpeg</code> e <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">deno</code>.
          </p>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Erro reportado:</h2>
            <pre className="bg-muted p-4 rounded-md text-xs whitespace-pre-wrap text-destructive border border-destructive/20 overflow-x-auto max-h-60 font-mono">{visibleError}</pre>
          </div>

          <div className="space-y-4 pt-2 border-t border-border">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Diagnóstico:</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Arquivo local: <code className="bg-muted px-1.5 py-0.5 rounded font-mono">{logFilePath}</code>
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void runFullDiagnostics()}
                  disabled={dependencyState === 'diagnosing'}
                  className="px-3 py-1 text-xs font-medium bg-secondary text-secondary-foreground rounded hover:bg-secondary/80 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {dependencyState === 'diagnosing' ? 'Diagnosticando...' : 'Rodar diagnóstico completo'}
                </button>
                <button
                  onClick={handleCopyDebug}
                  disabled={dependencyState === 'diagnosing'}
                  className="px-3 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {copied ? 'Copiado!' : 'Copiar diagnóstico'}
                </button>
              </div>
            </div>

            <details className="group border border-border rounded bg-muted/30">
              <summary className="cursor-pointer p-3 text-xs font-medium text-muted-foreground select-none hover:bg-muted/50 transition-colors flex items-center justify-between">
                <span>Visualizar JSON completo de diagnóstico</span>
                <span className="text-[10px] group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="p-3 border-t border-border bg-black/40">
                <pre className="text-[10px] leading-relaxed text-emerald-400 overflow-x-auto max-h-80 font-mono">{diagnosticJson}</pre>
              </div>
            </details>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 max-w-5xl mx-auto space-y-6 flex flex-col">
      <header className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">YTDL Studio</h1>
          <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">v0.1.3</span>
        </div>
        <p className="text-muted-foreground">Orquestrador avançado para yt-dlp</p>

        <div className="mt-2 text-xs text-muted-foreground/70 flex flex-col">
          <span>{dependencyMessage}</span>
          {depsStatus && (
            <>
              <span>yt-dlp: {depsStatus.yt_dlp_path}</span>
              <span>ffmpeg: {depsStatus.ffmpeg_path}</span>
              <span>deno: {depsStatus.deno_path}</span>
            </>
          )}
        </div>
      </header>

      <main className="space-y-6 flex-1">
        <AppUpdateBanner />
        <YtdlpUpdateBanner onStatusChange={setYtdlpUpdateStatus} />
        <UrlInput />
        <DownloadConfig />
        <ProgressLog />
      </main>
    </div>
  );
}

export default App;
