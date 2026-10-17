import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { YtdlpUpdateStatus } from '../domain/download.types';

interface Props {
  onStatusChange?: (status: YtdlpUpdateStatus) => void;
}

type UpdateState = 'idle' | 'checking' | 'updating' | 'done' | 'error';

export function YtdlpUpdateBanner({ onStatusChange }: Props) {
  const [status, setStatus] = useState<YtdlpUpdateStatus | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [updateMessage, setUpdateMessage] = useState('');
  const [expanded, setExpanded] = useState(false);

  const checkUpdate = async () => {
    setUpdateState('checking');
    setUpdateMessage('');
    try {
      const s = await invoke<YtdlpUpdateStatus>('check_ytdlp_update');
      setStatus(s);
      onStatusChange?.(s);
      setUpdateState('idle');
    } catch (e) {
      setUpdateMessage(`Falha ao verificar atualização: ${String(e)}`);
      setUpdateState('error');
    }
  };

  const doUpdate = async (channel: 'stable' | 'nightly') => {
    setUpdateState('updating');
    setUpdateMessage(`Atualizando yt-dlp (${channel})…`);
    try {
      const msg = await invoke<string>('update_ytdlp', { channel });
      setUpdateMessage(msg);
      setUpdateState('done');
      // Recarrega status após atualizar
      const s = await invoke<YtdlpUpdateStatus>('check_ytdlp_update');
      setStatus(s);
      onStatusChange?.(s);
    } catch (e) {
      setUpdateMessage(`Falha ao atualizar: ${String(e)}`);
      setUpdateState('error');
    }
  };

  const isOutdated = status?.is_outdated ?? false;
  const isBundled = status?.is_bundled ?? false;
  const version = status?.installed_version ?? null;
  const days = status?.days_since_release ?? null;

  // Cor do badge de versão
  const badgeColor = isOutdated
    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
    : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-foreground">Motor yt-dlp</span>
            {version ? (
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`text-xs font-mono px-2 py-0.5 rounded-full border ${badgeColor}`}
                >
                  {version}
                </span>
                {days !== null && (
                  <span className="text-xs text-muted-foreground">
                    {days} {days === 1 ? 'dia' : 'dias'} de idade
                  </span>
                )}
                {isBundled && (
                  <span className="text-xs text-muted-foreground/60">(embutido)</span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground mt-0.5">
                {updateState === 'checking' ? 'Verificando…' : 'Versão não verificada'}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isOutdated && (
            <span className="text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full animate-pulse">
              Atualização disponível
            </span>
          )}
          <button
            id="ytdlp-check-update-btn"
            onClick={() => void checkUpdate()}
            disabled={updateState === 'checking' || updateState === 'updating'}
            className="px-3 py-1 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
          >
            {updateState === 'checking' ? 'Verificando…' : 'Verificar'}
          </button>
          <button
            id="ytdlp-toggle-details-btn"
            onClick={() => setExpanded(e => !e)}
            className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            aria-label={expanded ? 'Recolher detalhes' : 'Expandir detalhes'}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Aviso de versão desatualizada */}
      {isOutdated && (
        <p className="text-xs text-amber-400/80">
          ⚠️ O motor yt-dlp está com mais de {YTDLP_OUTDATED_DAYS} dias. Alguns extratores (como Facebook)
          podem falhar. Atualize para a versão estável ou nightly.
        </p>
      )}

      {/* Mensagem de resultado */}
      {updateMessage && (
        <p
          className={`text-xs font-mono rounded px-2 py-1 ${
            updateState === 'error'
              ? 'bg-destructive/10 text-destructive border border-destructive/20'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {updateMessage}
        </p>
      )}

      {/* Detalhes expandíveis */}
      {expanded && status && (
        <div className="space-y-3 pt-2 border-t border-border">
          {/* Botões de atualização */}
          <div className="flex gap-2 flex-wrap">
            <button
              id="ytdlp-update-stable-btn"
              onClick={() => void doUpdate('stable')}
              disabled={updateState === 'updating' || updateState === 'checking'}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateState === 'updating' ? 'Atualizando…' : '↑ Atualizar estável'}
            </button>
            <button
              id="ytdlp-update-nightly-btn"
              onClick={() => void doUpdate('nightly')}
              disabled={updateState === 'updating' || updateState === 'checking'}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors disabled:opacity-50"
            >
              {updateState === 'updating' ? 'Atualizando…' : '↑ Atualizar nightly'}
            </button>
          </div>

          {/* Path do runtime */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-0.5">Runtime path:</p>
            <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded block break-all">
              {status.runtime_path}
            </code>
          </div>

          {/* Impersonation */}
          {status.impersonate_available ? (
            <div>
              <p className="text-xs font-medium text-emerald-400 mb-0.5">
                ✓ Impersonação disponível ({status.impersonate_targets.length} alvos)
              </p>
              <p className="text-xs text-muted-foreground">
                {status.impersonate_targets.slice(0, 5).join(', ')}
                {status.impersonate_targets.length > 5 && ` +${status.impersonate_targets.length - 5} mais`}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Sem suporte a impersonação nesta build. Facebook pode exigir cookies e versão atualizada.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const YTDLP_OUTDATED_DAYS = 30;
