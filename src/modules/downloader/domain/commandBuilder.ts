import { DownloadSelection } from './download.types';

export function buildDownloadCommand(selection: DownloadSelection): string[] {
  if (selection.audioFormatIds.length === 0) {
    throw new Error('Selecione pelo menos uma faixa de áudio.');
  }

  const args: string[] = [];

  if (selection.browser !== 'none') {
    args.push('--cookies-from-browser', selection.browser);
  }

  // Format selection
  if (selection.videoFormatId) {
    const formats = [selection.videoFormatId, ...selection.audioFormatIds];
    args.push('-f', formats.join('+'));
  } else {
    // No specific video selected -> use best default + selected audios
    const audioQuery = selection.audioFormatIds.join('+');
    
    if (selection.container === 'mp4') {
      args.push('-f', `bestvideo[ext=mp4]+${audioQuery}/best[ext=mp4]/best`);
    } else {
      args.push('-f', `bv*+${audioQuery}/b`);
    }
  }

  if (selection.container === 'mkv' && selection.audioFormatIds.length > 1) {
    args.push('--audio-multistreams');
  }

  args.push('--merge-output-format', selection.container);

  // Subtitles
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

  if (selection.embedMetadata) {
    args.push('--embed-metadata');
  }

  if (selection.embedChapters) {
    args.push('--embed-chapters');
  }

  if (selection.outputDir) {
    args.push('-P', selection.outputDir);
  }

  args.push('-o', selection.outputTemplate || '%(title)s [%(id)s].%(ext)s');

  args.push(selection.url);

  return args;
}

export function buildPreviewCommand(selection: DownloadSelection): string {
  try {
    const rawArgs = buildDownloadCommand(selection);
    const args: string[] = [];
    for (let i = 0; i < rawArgs.length; i++) {
      if (rawArgs[i] === '--cookies-from-browser' && rawArgs[i + 1] === 'ginsbrowser') {
        args.push('--cookies', '~/Library/Application Support/YTDL Studio/ginsbrowser_cookies.txt');
        i++;
      } else {
        args.push(rawArgs[i]);
      }
    }
    const quoteArgs = ['-f', '--sub-langs', '-P', '-o', '--cookies'];
    
    return ['yt-dlp', ...args.map((arg, idx) => {
      // url is always the last argument
      if (idx === args.length - 1) return `"${arg}"`;

      if (idx > 0 && quoteArgs.includes(args[idx - 1])) {
        return `"${arg}"`;
      }
      return arg;
    })].join(' ');
  } catch (e: any) {
    return e.message;
  }
}
