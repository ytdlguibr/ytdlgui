import { MediaFormat, ScanResult, SubtitleTrack } from './download.types';

export function parseScanResult(jsonString: string): ScanResult {
  const raw = JSON.parse(jsonString);

  const formats: MediaFormat[] = (raw.formats || []).map((f: any) => ({
    id: f.format_id,
    ext: f.ext,
    resolution: f.resolution,
    height: f.height,
    fps: f.fps,
    vcodec: f.vcodec !== 'none' ? f.vcodec : undefined,
    acodec: f.acodec !== 'none' ? f.acodec : undefined,
    language: f.language,
    languageName: f.language,
    filesizeApprox: f.filesize_approx || f.filesize,
    note: f.format_note,
    isVideoOnly: f.vcodec !== 'none' && f.acodec === 'none',
    isAudioOnly: f.acodec !== 'none' && f.vcodec === 'none',
  }));

  const parseSubtitles = (subMap: any, automatic: boolean): SubtitleTrack[] => {
    if (!subMap) return [];
    return Object.entries(subMap).map(([lang, subs]: [string, any]) => {
      const formats = subs.map((s: any) => s.ext);
      return {
        language: lang,
        name: subs[0]?.name || lang,
        formats: Array.from(new Set(formats)),
        automatic,
      };
    });
  };

  const subtitles = parseSubtitles(raw.subtitles, false);
  const automaticCaptions = parseSubtitles(raw.automatic_captions, true);

  return {
    id: raw.id,
    title: raw.title,
    webpageUrl: raw.webpage_url,
    duration: raw.duration,
    thumbnail: raw.thumbnail,
    formats,
    subtitles,
    automaticCaptions,
  };
}
