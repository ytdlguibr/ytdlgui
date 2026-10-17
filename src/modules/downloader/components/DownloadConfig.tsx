import { useDownloaderStore } from '../store/downloader.store';
import { OutputContainer } from '../domain/download.types';
import { buildDownloadCommand, buildPreviewCommand } from '../domain/commandBuilder';
import { invoke } from '@tauri-apps/api/core';

export function DownloadConfig() {
  const { appState, scanResult, selection, updateSelection, setAppState, clearLogs, addLog } = useDownloaderStore();

  if (!scanResult || (appState !== 'ready' && appState !== 'downloading' && appState !== 'done')) {
    return null;
  }

  const videos = [...scanResult.formats]
    .filter(f => !f.isAudioOnly && !f.isVideoOnly === false || f.vcodec)
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (a.vcodec || '').localeCompare(b.vcodec || ''));

  // Sort audios: pt first, en next, m4a before webm, highest bitrate/size first
  const audios = [...scanResult.formats]
    .filter(f => f.isAudioOnly)
    .sort((a, b) => {
      // 1. pt-BR or pt first
      const isA_PT = a.language === 'pt-BR' || a.language === 'pt' ? 1 : 0;
      const isB_PT = b.language === 'pt-BR' || b.language === 'pt' ? 1 : 0;
      if (isA_PT !== isB_PT) return isB_PT - isA_PT;

      // 2. m4a before webm
      const isA_m4a = a.ext === 'm4a' ? 1 : 0;
      const isB_m4a = b.ext === 'm4a' ? 1 : 0;
      if (isA_m4a !== isB_m4a) return isB_m4a - isA_m4a;

      // 3. Highest bitrate/size first
      if ((b.filesizeApprox || 0) !== (a.filesizeApprox || 0)) {
        return (b.filesizeApprox || 0) - (a.filesizeApprox || 0);
      }

      // 4. en-US / en-orig / en next
      const isA_EN = a.language?.startsWith('en') ? 1 : 0;
      const isB_EN = b.language?.startsWith('en') ? 1 : 0;
      if (isA_EN !== isB_EN) return isB_EN - isA_EN;

      // 5. DRC last
      const isA_DRC = a.note?.toLowerCase().includes('drc') ? 1 : 0;
      const isB_DRC = b.note?.toLowerCase().includes('drc') ? 1 : 0;
      if (isA_DRC !== isB_DRC) return isA_DRC - isB_DRC;

      return 0;
    });

  const handleAudioChange = (formatId: string, checked: boolean) => {
    let newAudioIds = [...selection.audioFormatIds];
    if (checked) {
      newAudioIds.push(formatId);
    } else {
      newAudioIds = newAudioIds.filter(id => id !== formatId);
    }

    let newContainer = selection.container;
    if (newAudioIds.length > 1) {
      newContainer = 'mkv';
    }

    updateSelection({ audioFormatIds: newAudioIds, container: newContainer });
  };

  const handleContainerChange = (container: OutputContainer) => {
    if (container === 'mp4' && selection.audioFormatIds.length > 1) {
      alert("MP4 não suporta múltiplas faixas de áudio nativamente de forma confiável. Remova faixas de áudio ou use MKV.");
      return;
    }
    updateSelection({ container });
  };

  const commandPreview = buildPreviewCommand(selection);

  const handleDownload = async () => {
    if (selection.audioFormatIds.length === 0) {
      alert("Selecione pelo menos uma faixa de áudio.");
      return;
    }

    clearLogs();
    setAppState('downloading');
    try {
      const args = buildDownloadCommand(selection);
      await invoke('start_download', { args });
      setAppState('done');
    } catch (e) {
      addLog(e instanceof Error ? e.message : String(e));
      setAppState('error');
    }
  };

  const applyPreset = (type: 'mp4_edit' | '4k_max' | 'archive') => {
    if (type === 'mp4_edit') {
      const h264Video = videos.find(v => v.vcodec?.includes('avc1') || v.vcodec?.includes('h264') || v.vcodec?.includes('mp4v'));
      // Prefer m4a in PT, fallback to EN, or best m4a
      const bestM4aPT = audios.find(a => a.ext === 'm4a' && (a.language === 'pt-BR' || a.language === 'pt'));
      const bestM4aEN = audios.find(a => a.ext === 'm4a' && a.language?.startsWith('en'));
      const bestM4a = bestM4aPT || bestM4aEN || audios.find(a => a.ext === 'm4a') || audios[0];

      updateSelection({
        videoFormatId: h264Video?.id || 'bestvideo[ext=mp4][vcodec^=avc1]',
        audioFormatIds: bestM4a ? [bestM4a.id] : [],
        container: 'mp4',
        subtitleMode: 'manual_and_auto',
        subtitleDelivery: 'external_srt',
      });
    } else if (type === '4k_max') {
      const bestVideo = videos[0];
      const bestAudio = audios[0];
      updateSelection({
        videoFormatId: bestVideo?.id || '',
        audioFormatIds: bestAudio ? [bestAudio.id] : [],
        container: 'mp4', // will be auto-changed to mkv if multiple audios, but preset is single audio
      });
    } else if (type === 'archive') {
      const bestVideo = videos[0];
      updateSelection({
        videoFormatId: bestVideo?.id || '',
        audioFormatIds: audios.map(a => a.id),
        container: 'mkv',
        subtitleMode: 'manual_and_auto',
        subtitleDelivery: 'both',
        subtitleLanguages: ['all', '-live_chat']
      });
    }
  };

  return (
    <div className="bg-card text-card-foreground p-6 rounded-lg shadow-sm border border-border space-y-6">
      
      {/* Presets */}
      <div className="flex gap-2 mb-4 border-b border-border pb-4">
        <span className="text-sm font-medium mr-2 self-center">Presets:</span>
        <button className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80" onClick={() => applyPreset('mp4_edit')}>
          MP4 Edição (H.264 + m4a)
        </button>
        <button className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80" onClick={() => applyPreset('4k_max')}>
          Máxima Qualidade (Único Áudio)
        </button>
        <button className="px-3 py-1 bg-secondary text-secondary-foreground rounded-md text-sm hover:bg-secondary/80" onClick={() => applyPreset('archive')}>
          Arquivo Completo (MKV + Tudo)
        </button>
      </div>

      <div className="flex gap-4">
        {scanResult.thumbnail && (
          <img src={scanResult.thumbnail} alt="Thumbnail" className="w-48 h-28 object-cover rounded-md" />
        )}
        <div>
          <h2 className="text-xl font-bold">{scanResult.title}</h2>
          {scanResult.duration && <p className="text-muted-foreground text-sm">Duração: {Math.floor(scanResult.duration / 60)}:{(scanResult.duration % 60).toString().padStart(2, '0')}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Vídeo (Resolução / Codec)</label>
            <select 
              className="w-full p-2 rounded-md border border-input bg-background"
              value={selection.videoFormatId}
              onChange={(e) => updateSelection({ videoFormatId: e.target.value })}
              disabled={appState === 'downloading'}
            >
              <option value="">Melhor Qualidade Automática (Default)</option>
              {videos.map(v => (
                <option key={v.id} value={v.id}>
                  {v.id} — {v.height ? `${v.height}p` : 'N/A'} — {v.ext} — {v.vcodec} {v.vcodec?.includes('avc') ? '— H.264' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Áudio(s)</label>
            <div className="h-40 overflow-y-auto border border-input rounded-md p-2 space-y-2 bg-background">
              {audios.map(a => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input 
                    type="checkbox" 
                    checked={selection.audioFormatIds.includes(a.id)}
                    onChange={(e) => handleAudioChange(a.id, e.target.checked)}
                    disabled={appState === 'downloading'}
                    className="rounded border-input"
                  />
                  {a.id} — {a.language || 'Desconhecido'} — {a.ext} {a.filesizeApprox ? `— ${(a.filesizeApprox / 1024 / 1024).toFixed(1)}MB` : ''} {a.note?.toLowerCase().includes('drc') ? '(DRC)' : ''}
                </label>
              ))}
            </div>
            {selection.audioFormatIds.length === 0 && (
               <p className="text-xs text-destructive">Selecione pelo menos uma faixa de áudio.</p>
            )}
            {selection.audioFormatIds.length > 1 && selection.container === 'mp4' && (
               <p className="text-xs text-destructive">Aviso: Múltiplos áudios forçarão o container MKV.</p>
            )}
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Container de Saída</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2">
                <input 
                  type="radio" 
                  name="container" 
                  value="mp4"
                  checked={selection.container === 'mp4'}
                  onChange={() => handleContainerChange('mp4')}
                  disabled={appState === 'downloading'}
                /> MP4
              </label>
              <label className="flex items-center gap-2">
                <input 
                  type="radio" 
                  name="container" 
                  value="mkv"
                  checked={selection.container === 'mkv'}
                  onChange={() => handleContainerChange('mkv')}
                  disabled={appState === 'downloading'}
                /> MKV
              </label>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Legendas</label>
            <select 
              className="w-full p-2 rounded-md border border-input bg-background"
              value={selection.subtitleMode}
              onChange={(e) => updateSelection({ subtitleMode: e.target.value as any })}
              disabled={appState === 'downloading'}
            >
              <option value="none">Nenhuma</option>
              <option value="manual">Manuais/Oficiais</option>
              <option value="auto">Automáticas</option>
              <option value="manual_and_auto">Ambas</option>
            </select>
          </div>

          {selection.subtitleMode !== 'none' && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Idiomas das Legendas (separados por vírgula)</label>
                <input 
                  type="text" 
                  className="w-full p-2 rounded-md border border-input bg-background"
                  value={selection.subtitleLanguages.join(',')}
                  onChange={(e) => updateSelection({ subtitleLanguages: e.target.value.split(',').map(s => s.trim()) })}
                  disabled={appState === 'downloading'}
                />
                <p className="text-xs text-muted-foreground">Ex: pt, en, all,-live_chat</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Entrega de Legendas</label>
                <select 
                  className="w-full p-2 rounded-md border border-input bg-background"
                  value={selection.subtitleDelivery}
                  onChange={(e) => updateSelection({ subtitleDelivery: e.target.value as any })}
                  disabled={appState === 'downloading'}
                >
                  <option value="external_srt">Arquivo SRT externo</option>
                  <option value="embedded">Embutida no arquivo de vídeo</option>
                  <option value="both">Ambas</option>
                </select>
              </div>
            </>
          )}
          
          <div className="space-y-2">
            <label className="text-sm font-medium">Pasta de Saída</label>
            <input 
              type="text" 
              className="w-full p-2 rounded-md border border-input bg-background"
              value={selection.outputDir}
              onChange={(e) => updateSelection({ outputDir: e.target.value })}
              disabled={appState === 'downloading'}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 pt-4 border-t border-border">
        <label className="text-sm font-medium flex justify-between">
          <span>Comando Gerado</span>
          <button 
            className="text-primary hover:underline text-xs"
            onClick={() => navigator.clipboard.writeText(commandPreview)}
          >
            Copiar Comando
          </button>
        </label>
        <div className="p-3 bg-muted rounded-md border border-border overflow-x-auto">
          <code className={`text-xs whitespace-pre-wrap font-mono ${commandPreview.includes('Selecione pelo menos uma faixa de áudio') ? 'text-destructive' : 'text-muted-foreground'}`}>
            {commandPreview}
          </code>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button 
          className="px-8 py-3 bg-primary text-primary-foreground rounded-md font-bold text-lg disabled:opacity-50 hover:bg-primary/90 transition-colors"
          onClick={handleDownload}
          disabled={appState === 'downloading' || selection.audioFormatIds.length === 0}
        >
          {appState === 'downloading' ? 'Baixando...' : 'Iniciar Download'}
        </button>
      </div>
    </div>
  );
}
