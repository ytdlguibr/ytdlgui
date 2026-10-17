import { useEffect, useRef, useState } from 'react';
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'installed'
  | 'error';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function AppUpdateBanner() {
  const updateRef = useRef<Update | null>(null);
  const [state, setState] = useState<AppUpdateState>('idle');
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState('');

  const clearUpdate = async () => {
    const current = updateRef.current;
    updateRef.current = null;
    if (current) await current.close();
  };

  const checkForUpdate = async (manual: boolean) => {
    if (!isTauriRuntime()) return;

    setState('checking');
    setMessage('');

    try {
      const update = await check({ timeout: 10_000 });
      await clearUpdate();
      updateRef.current = update;

      if (!update) {
        setState('up_to_date');
        if (manual) setMessage('O aplicativo ja esta atualizado.');
        return;
      }

      setAvailableVersion(update.version);
      setNotes(update.body?.trim() || null);
      setState('available');
    } catch (error) {
      console.warn('[updater] check failed', error);
      setState(manual ? 'error' : 'idle');
      if (manual) setMessage(`Falha ao verificar atualizacao: ${errorMessage(error)}`);
    }
  };

  const installUpdate = async () => {
    let update = updateRef.current;
    if (!update) {
      await checkForUpdate(true);
      update = updateRef.current;
    }

    if (!update) return;

    setState('downloading');
    setProgress(null);
    setMessage('Baixando atualizacao assinada...');

    let downloaded = 0;
    let contentLength: number | undefined;
    const onProgress = (event: DownloadEvent) => {
      if (event.event === 'Started') {
        contentLength = event.data.contentLength;
        return;
      }

      if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
        if (contentLength && contentLength > 0) {
          setProgress(Math.min(100, Math.round((downloaded / contentLength) * 100)));
        }
      }
    };

    try {
      await update.downloadAndInstall(onProgress, { timeout: 600_000 });
      await clearUpdate();
      setState('installed');
      setProgress(100);
      setMessage('Atualizacao instalada. Reiniciando o YTDL Studio...');
      await relaunch();
    } catch (error) {
      setState('error');
      setMessage(`Falha ao instalar atualizacao: ${errorMessage(error)}`);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdate(false), 1_200);
    return () => {
      window.clearTimeout(timer);
      void clearUpdate();
    };
  }, []);

  if (!isTauriRuntime() || state === 'idle') return null;

  const isBusy = state === 'checking' || state === 'downloading';

  return (
    <section className="border border-border bg-card/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Atualizacao do aplicativo</h2>
          {state === 'checking' && (
            <p className="mt-1 text-xs text-muted-foreground">Verificando atualizacoes...</p>
          )}
          {state === 'available' && (
            <p className="mt-1 text-xs text-muted-foreground">
              A versao {availableVersion} esta pronta para instalar.
            </p>
          )}
          {state === 'downloading' && (
            <p className="mt-1 text-xs text-muted-foreground">
              {progress === null ? 'Baixando pacote...' : `Baixando pacote: ${progress}%`}
            </p>
          )}
          {message && (
            <p className={`mt-1 text-xs ${state === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
              {message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => void checkForUpdate(true)}
            disabled={isBusy}
            className="px-3 py-1 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            Verificar agora
          </button>
          {state === 'available' && (
            <button
              onClick={() => void installUpdate()}
              disabled={isBusy}
              className="px-3 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Baixar e instalar
            </button>
          )}
        </div>
      </div>

      {notes && state === 'available' && (
        <details className="border border-border bg-muted/30">
          <summary className="cursor-pointer p-2 text-xs text-muted-foreground">
            Ver novidades desta versao
          </summary>
          <pre className="border-t border-border p-3 text-xs whitespace-pre-wrap text-muted-foreground font-sans">
            {notes}
          </pre>
        </details>
      )}
    </section>
  );
}
