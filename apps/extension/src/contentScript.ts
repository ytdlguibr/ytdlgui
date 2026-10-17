import type { DetectedVideo } from '../../../packages/core/src';
import type { ExtensionMessage } from './messages';
import { detectYouTubeVideo } from './youtubeDetector';

let currentVideoId: string | null = null;
let button: HTMLButtonElement | null = null;
let inlinePanel: HTMLDivElement | null = null;

function sendMessage(message: ExtensionMessage) {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function removeButton() {
  button?.remove();
  button = null;
}

function closeInlinePanel() {
  inlinePanel?.remove();
  inlinePanel = null;
}

function showInlinePanel(video: DetectedVideo) {
  closeInlinePanel();

  inlinePanel = document.createElement('div');
  inlinePanel.style.cssText = [
    'position:fixed',
    'right:24px',
    'bottom:24px',
    'z-index:2147483647',
    'width:320px',
    'padding:16px',
    'border-radius:10px',
    'border:1px solid #d9dee7',
    'background:#ffffff',
    'box-shadow:0 18px 50px rgba(15,23,42,.18)',
    'font:13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'color:#111827',
  ].join(';');

  inlinePanel.innerHTML = `
    <div style="display:flex;gap:12px;align-items:flex-start">
      <img src="${video.thumbnail}" alt="" style="width:96px;height:54px;object-fit:cover;border-radius:6px;background:#eef2f7" />
      <div style="min-width:0">
        <div style="font-weight:700;line-height:1.25;max-height:48px;overflow:hidden">${video.title}</div>
        <div style="margin-top:6px;color:#667085">Vídeos públicos apenas nesta versão.</div>
      </div>
    </div>
    <div style="margin-top:12px;color:#667085">
      Abra o popup da extensão para analisar formatos e criar o job remoto.
    </div>
    <button data-ytdl-close style="margin-top:12px;width:100%;height:34px;border:0;border-radius:7px;background:#111827;color:white;font-weight:700;cursor:pointer">Fechar</button>
  `;

  inlinePanel.querySelector('[data-ytdl-close]')?.addEventListener('click', closeInlinePanel);
  document.documentElement.appendChild(inlinePanel);
}

function placeButton(video: DetectedVideo) {
  if (!button) {
    button = document.createElement('button');
    button.textContent = 'Baixar no YTDL Studio';
    button.type = 'button';
    button.style.cssText = [
      'margin-left:8px',
      'height:36px',
      'padding:0 14px',
      'border:1px solid rgba(15,23,42,.12)',
      'border-radius:18px',
      'background:#111827',
      'color:#fff',
      'font:600 13px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'cursor:pointer',
    ].join(';');
    button.addEventListener('click', () => {
      sendMessage({ type: 'OPEN_YTDL_STUDIO', video });
    });
  }

  const targets = [
    '#top-level-buttons-computed',
    '#actions #actions-inner',
    '#actions',
  ];
  const target = targets
    .map((selector) => document.querySelector(selector))
    .find((element): element is Element => Boolean(element));

  if (target && button.parentElement !== target) {
    target.appendChild(button);
  } else if (!target && button.parentElement !== document.body) {
    button.style.position = 'fixed';
    button.style.right = '24px';
    button.style.bottom = '24px';
    button.style.zIndex = '2147483646';
    document.body.appendChild(button);
  }
}

function detectAndNotify() {
  const video = detectYouTubeVideo();

  if (!video) {
    if (currentVideoId) {
      currentVideoId = null;
      removeButton();
      closeInlinePanel();
      sendMessage({ type: 'VIDEO_CLEARED' });
    }
    return;
  }

  placeButton(video);

  if (video.videoId !== currentVideoId) {
    const hadVideo = Boolean(currentVideoId);
    currentVideoId = video.videoId;
    sendMessage({
      type: hadVideo ? 'VIDEO_CHANGED' : 'VIDEO_DETECTED',
      video,
    });
  }
}

function patchHistoryMethod(name: 'pushState' | 'replaceState') {
  const original = history[name];
  history[name] = function patchedHistoryMethod(...args) {
    const result = original.apply(this, args);
    window.dispatchEvent(new Event('ytdl-studio-location-change'));
    return result;
  };
}

patchHistoryMethod('pushState');
patchHistoryMethod('replaceState');
window.addEventListener('popstate', detectAndNotify);
window.addEventListener('yt-navigate-finish', detectAndNotify);
window.addEventListener('ytdl-studio-location-change', () => setTimeout(detectAndNotify, 100));

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_VIDEO') {
    sendResponse(detectYouTubeVideo());
    return true;
  }

  if (message.type === 'SHOW_INLINE_PANEL') {
    const video = detectYouTubeVideo();
    if (video) showInlinePanel(video);
    sendResponse({ ok: Boolean(video) });
    return true;
  }

  return false;
});

detectAndNotify();
setInterval(detectAndNotify, 1500);
