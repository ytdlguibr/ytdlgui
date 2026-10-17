import {
  type MediaFormat,
  type OnlineDownloadSelection,
  type PresetSelection,
  type ScanResult,
} from './types';

export function sortVideoFormats(formats: MediaFormat[]): MediaFormat[] {
  return [...formats]
    .filter((format) => !format.isAudioOnly && Boolean(format.vcodec))
    .sort(
      (a, b) =>
        (b.height || 0) - (a.height || 0) ||
        (a.vcodec || '').localeCompare(b.vcodec || '')
    );
}

export function sortAudioFormats(formats: MediaFormat[]): MediaFormat[] {
  return [...formats]
    .filter((format) => format.isAudioOnly)
    .sort((a, b) => {
      const isApt = a.language === 'pt-BR' || a.language === 'pt' ? 1 : 0;
      const isBpt = b.language === 'pt-BR' || b.language === 'pt' ? 1 : 0;
      if (isApt !== isBpt) return isBpt - isApt;

      const isAm4a = a.ext === 'm4a' ? 1 : 0;
      const isBm4a = b.ext === 'm4a' ? 1 : 0;
      if (isAm4a !== isBm4a) return isBm4a - isAm4a;

      if ((b.filesizeApprox || 0) !== (a.filesizeApprox || 0)) {
        return (b.filesizeApprox || 0) - (a.filesizeApprox || 0);
      }

      const isAen = a.language?.startsWith('en') ? 1 : 0;
      const isBen = b.language?.startsWith('en') ? 1 : 0;
      if (isAen !== isBen) return isBen - isAen;

      const isAdrc = a.note?.toLowerCase().includes('drc') ? 1 : 0;
      const isBdrc = b.note?.toLowerCase().includes('drc') ? 1 : 0;
      if (isAdrc !== isBdrc) return isAdrc - isBdrc;

      return 0;
    });
}

export function buildDefaultOnlineSelection(url: string): OnlineDownloadSelection {
  return {
    url,
    videoFormatId: '',
    audioFormatIds: [],
    container: 'mp4',
    subtitleMode: 'none',
    subtitleLanguages: ['pt', 'en-orig', 'en'],
    subtitleDelivery: 'external_srt',
    embedMetadata: true,
    embedChapters: true,
  };
}

export function applyPreset(
  scanResult: ScanResult,
  preset: 'mp4_edit' | '4k_max' | 'archive'
): PresetSelection {
  const videos = sortVideoFormats(scanResult.formats);
  const audios = sortAudioFormats(scanResult.formats);

  if (preset === 'mp4_edit') {
    const h264Video = videos.find(
      (video) =>
        video.vcodec?.includes('avc1') ||
        video.vcodec?.includes('h264') ||
        video.vcodec?.includes('mp4v')
    );
    const bestM4aPt = audios.find(
      (audio) => audio.ext === 'm4a' && (audio.language === 'pt-BR' || audio.language === 'pt')
    );
    const bestM4aEn = audios.find(
      (audio) => audio.ext === 'm4a' && audio.language?.startsWith('en')
    );
    const bestM4a =
      bestM4aPt || bestM4aEn || audios.find((audio) => audio.ext === 'm4a') || audios[0];

    return {
      videoFormatId: h264Video?.id || 'bestvideo[ext=mp4][vcodec^=avc1]',
      audioFormatIds: bestM4a ? [bestM4a.id] : [],
      container: 'mp4',
      subtitleMode: 'manual_and_auto',
      subtitleLanguages: ['pt', 'en-orig', 'en'],
      subtitleDelivery: 'external_srt',
    };
  }

  if (preset === 'archive') {
    return {
      videoFormatId: videos[0]?.id || '',
      audioFormatIds: audios.map((audio) => audio.id),
      container: 'mkv',
      subtitleMode: 'manual_and_auto',
      subtitleLanguages: ['all', '-live_chat'],
      subtitleDelivery: 'both',
    };
  }

  return {
    videoFormatId: videos[0]?.id || '',
    audioFormatIds: audios[0] ? [audios[0].id] : [],
    container: 'mp4',
    subtitleMode: 'none',
    subtitleLanguages: ['pt', 'en-orig', 'en'],
    subtitleDelivery: 'external_srt',
  };
}
