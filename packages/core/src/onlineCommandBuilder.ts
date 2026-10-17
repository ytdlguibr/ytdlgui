import type { OnlineDownloadSelection } from './types';

export function validateOnlineSelection(selection: OnlineDownloadSelection): void {
  if (!selection.url.trim()) {
    throw new Error('URL obrigatória.');
  }

  if (selection.audioFormatIds.length === 0) {
    throw new Error('Selecione pelo menos uma faixa de áudio.');
  }

  if (selection.container === 'mp4' && selection.audioFormatIds.length > 1) {
    throw new Error('MP4 não suporta múltiplas faixas de áudio neste fluxo. Use MKV.');
  }
}

export function buildOnlineDownloadArgs(
  selection: OnlineDownloadSelection,
  outputTemplate: string
): string[] {
  validateOnlineSelection(selection);

  const args: string[] = ['--no-playlist'];

  if (selection.videoFormatId) {
    args.push('-f', [selection.videoFormatId, ...selection.audioFormatIds].join('+'));
  } else if (selection.container === 'mp4') {
    args.push(
      '-f',
      `bestvideo[ext=mp4]+${selection.audioFormatIds.join('+')}/best[ext=mp4]/best`
    );
  } else {
    args.push('-f', `bv*+${selection.audioFormatIds.join('+')}/b`);
  }

  if (selection.container === 'mkv' && selection.audioFormatIds.length > 1) {
    args.push('--audio-multistreams');
  }

  args.push('--merge-output-format', selection.container);

  if (selection.subtitleMode !== 'none') {
    if (selection.subtitleMode === 'auto' || selection.subtitleMode === 'manual_and_auto') {
      args.push('--write-auto-subs');
    }

    if (selection.subtitleMode === 'manual' || selection.subtitleMode === 'manual_and_auto') {
      args.push('--write-subs');
    }

    if (selection.subtitleLanguages.length > 0) {
      args.push('--sub-langs', selection.subtitleLanguages.join(','));
    }

    if (selection.subtitleDelivery === 'external_srt' || selection.subtitleDelivery === 'both') {
      args.push('--sub-format', 'srt');
    }

    if (selection.subtitleDelivery === 'embedded' || selection.subtitleDelivery === 'both') {
      args.push('--embed-subs');
    }
  }

  if (selection.embedMetadata !== false) {
    args.push('--embed-metadata');
  }

  if (selection.embedChapters !== false) {
    args.push('--embed-chapters');
  }

  args.push('-o', outputTemplate, selection.url);

  return args;
}
