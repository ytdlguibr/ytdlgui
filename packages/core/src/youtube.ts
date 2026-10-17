export interface DetectedVideo {
  videoId: string;
  url: string;
  title: string;
  thumbnail: string;
}

export function extractYouTubeVideoId(urlLike: string): string | null {
  try {
    const url = new URL(urlLike);
    const host = url.hostname.replace(/^www\./, '');

    if (host === 'youtube.com' && url.pathname === '/watch') {
      return url.searchParams.get('v');
    }

    if (host === 'youtu.be') {
      return url.pathname.slice(1) || null;
    }

    return null;
  } catch {
    return null;
  }
}

export function canonicalYouTubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

export function youtubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
}
