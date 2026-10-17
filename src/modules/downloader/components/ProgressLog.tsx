import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useDownloaderStore } from '../store/downloader.store';

export function ProgressLog() {
  const { logs, addLog, appState } = useDownloaderStore();
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const unlisten = listen<string>('download-log', (event) => {
      addLog(event.payload);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [addLog]);

  useEffect(() => {
    if (appState === 'downloading') {
      setIsExpanded(true);
    }
  }, [appState]);

  useEffect(() => {
    if (logEndRef.current && isExpanded) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isExpanded]);

  if (logs.length === 0 && appState !== 'downloading' && appState !== 'done' && appState !== 'error') {
    return null;
  }

  return (
    <div className="bg-card text-card-foreground rounded-lg shadow-sm border border-border overflow-hidden flex flex-col">
      <button 
        className="p-4 flex justify-between items-center bg-muted/50 hover:bg-muted font-medium w-full text-left"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>Logs de Progresso {appState === 'downloading' ? '(Baixando...)' : appState === 'done' ? '(Concluído)' : ''}</span>
        <span>{isExpanded ? '▼' : '▶'}</span>
      </button>
      
      {isExpanded && (
        <div className="p-4 h-64 overflow-y-auto bg-black text-green-400 font-mono text-xs">
          {logs.length === 0 && <p className="text-gray-500">Aguardando logs...</p>}
          {logs.map((log, i) => (
            <div key={i} className="break-all whitespace-pre-wrap">{log}</div>
          ))}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}
