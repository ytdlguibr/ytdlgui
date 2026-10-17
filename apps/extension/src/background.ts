import { ACTIVE_VIDEO_STORAGE_KEY } from './messages';
import type { ExtensionMessage, OpenPanelMessage } from './messages';

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (
    message.type === 'VIDEO_DETECTED' ||
    message.type === 'VIDEO_CHANGED' ||
    message.type === 'VIDEO_CLEARED'
  ) {
    const value = 'video' in message ? message.video ?? null : null;
    void chrome.storage.local.set({ [ACTIVE_VIDEO_STORAGE_KEY]: value });
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'OPEN_YTDL_STUDIO') {
    const openMessage = message as OpenPanelMessage;
    void chrome.storage.local.set({ [ACTIVE_VIDEO_STORAGE_KEY]: openMessage.video }).then(() => {
      try {
        chrome.action.openPopup(() => {
          const failed = Boolean(chrome.runtime.lastError);
          if (failed && sender.tab?.id) {
            void chrome.tabs.sendMessage(sender.tab.id, { type: 'SHOW_INLINE_PANEL' });
          }
          sendResponse({ ok: !failed });
        });
      } catch {
        if (sender.tab?.id) {
          void chrome.tabs.sendMessage(sender.tab.id, { type: 'SHOW_INLINE_PANEL' });
        }
        sendResponse({ ok: false });
      }
    });
    return true;
  }

  return false;
});
