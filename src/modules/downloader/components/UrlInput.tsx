import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useDownloaderStore } from '../store/downloader.store';
import { parseScanResult } from '../domain/formatParser';

const browsers = [
  { id: 'none', name: 'Nenhum' },
  { id: 'ginsbrowser', name: 'GinsBrowser (DICloak)' },
  { id: 'firefox', name: 'Firefox' },
  { id: 'chrome', name: 'Chrome' },
  { id: 'brave', name: 'Brave' },
  { id: 'edge', name: 'Edge' },
  { id: 'safari', name: 'Safari' },
  { id: 'vivaldi', name: 'Vivaldi' },
];

export function UrlInput() {
  const { selection, updateSelection, setScanResult, appState, setAppState } = useDownloaderStore();
  const [errorMsg, setErrorMsg] = useState('');

  const handleScan = async () => {
    if (!selection.url) return;
    
    setAppState('scanning');
    setErrorMsg('');
    setScanResult(null);

    try {
      const resultJson = await invoke<string>('scan_url', { 
        url: selection.url, 
        browser: selection.browser 
      });
      const result = parseScanResult(resultJson);
      setScanResult(result);
      setAppState('ready');
    } catch (e: any) {
      setErrorMsg(e.toString());
      setAppState('idle');
    }
  };

  return (
    <div className="bg-card text-card-foreground p-6 rounded-lg shadow-sm border border-border space-y-4">
      <div className="flex gap-4">
        <div className="flex-1 space-y-2">
          <label className="text-sm font-medium">URL do Vídeo</label>
          <input 
            type="text" 
            className="w-full p-2 rounded-md border border-input bg-background"
            placeholder="https://youtube.com/..."
            value={selection.url}
            onChange={(e) => updateSelection({ url: e.target.value })}
            disabled={appState === 'scanning' || appState === 'downloading'}
          />
        </div>
        <div className="w-48 space-y-2">
          <label className="text-sm font-medium">Cookies do Navegador</label>
          <select 
            className="w-full p-2 rounded-md border border-input bg-background"
            value={selection.browser}
            onChange={(e) => updateSelection({ browser: e.target.value as any })}
            disabled={appState === 'scanning' || appState === 'downloading'}
          >
            {browsers.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button 
            className="px-6 py-2 bg-primary text-primary-foreground rounded-md font-medium disabled:opacity-50"
            onClick={handleScan}
            disabled={!selection.url || appState === 'scanning' || appState === 'downloading'}
          >
            {appState === 'scanning' ? 'Analisando...' : 'Analisar'}
          </button>
        </div>
      </div>
      
      {errorMsg && (
        <div className="p-4 bg-destructive/10 text-destructive rounded-md text-sm whitespace-pre-wrap">
          {errorMsg}
        </div>
      )}
    </div>
  );
}
