import {
  canonicalYouTubeWatchUrl,
  extractYouTubeVideoId,
  youtubeThumbnailUrl,
} from '../../../packages/core/src';
import type { DetectedVideo } from '../../../packages/core/src';

function readTitle(): string {
  const selectors = [
    'h1.ytd-watch-metadata yt-formatted-string',
    'h1.title yt-formatted-string',
    'meta[name="title"]',
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element instanceof HTMLMetaElement && element.content.trim()) {
      return element.content.trim();
    }
    if (element?.textContent?.trim()) {
      return element.textContent.trim();
    }
  }

  return document.title.replace(/\s+-\s+YouTube$/, '').trim();
}

export function detectYouTubeVideo(): DetectedVideo | null {
  const videoId = extractYouTubeVideoId(window.location.href);
  if (!videoId) return null;

  return {
    videoId,
    url: canonicalYouTubeWatchUrl(videoId),
    title: readTitle() || videoId,
    thumbnail: youtubeThumbnailUrl(videoId),
  };
}
