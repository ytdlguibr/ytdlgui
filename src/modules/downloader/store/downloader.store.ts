import { create } from 'zustand';
import { DownloadState, DownloadSelection, ScanResult, DependenciesStatus } from '../domain/download.types';

interface DownloaderState {
  appState: DownloadState;
  scanResult: ScanResult | null;
  selection: DownloadSelection;
  logs: string[];
  depsStatus: DependenciesStatus | null;

  setAppState: (state: DownloadState) => void;
  setScanResult: (result: ScanResult | null) => void;
  setDepsStatus: (status: DependenciesStatus | null) => void;
  updateSelection: (updates: Partial<DownloadSelection>) => void;
  addLog: (log: string) => void;
  clearLogs: () => void;
}

const initialSelection: DownloadSelection = {
  url: '',
  browser: 'none',
  videoFormatId: '',
  audioFormatIds: [],
  container: 'mp4',
  subtitleMode: 'none',
  subtitleLanguages: ['pt', 'en-orig', 'en'],
  subtitleDelivery: 'external_srt',
  outputDir: '',
  outputTemplate: '%(title)s [%(id)s].%(ext)s',
  embedMetadata: true,
  embedChapters: true,
};

export const useDownloaderStore = create<DownloaderState>((set) => ({
  appState: 'idle',
  scanResult: null,
  selection: initialSelection,
  logs: [],
  depsStatus: null,

  setAppState: (state) => set({ appState: state }),
  setScanResult: (scanResult) => set({ scanResult }),
  setDepsStatus: (depsStatus) => set({ depsStatus }),
  updateSelection: (updates) => set((state) => ({ 
    selection: { ...state.selection, ...updates } 
  })),
  addLog: (log) => set((state) => ({ logs: [...state.logs, log] })),
  clearLogs: () => set({ logs: [] }),
}));
