// Client-side chat history persistence (localStorage only — no server DB).
// Keyed per item so each paper has its own independent conversation.

import i18n from '../i18n/index.js';

const STORAGE_PREFIX = 'otero.chat.';

const PRESET_IDS = ['summary', 'method', 'contribution', 'limitation'];

export function getChatPresets() {
  return PRESET_IDS.map((id) => ({
    label: i18n.t(`item:chat.presets.${id}.label`),
    prompt: i18n.t(`item:chat.presets.${id}.prompt`),
  }));
}

// Live array-like export so CHAT_PRESETS.map(...) always reads current locale.
export const CHAT_PRESETS = new Proxy([], {
  get(_target, prop) {
    const presets = getChatPresets();
    const value = presets[prop];
    return typeof value === 'function' ? value.bind(presets) : value;
  },
});

function storageKey(itemKey) {
  return `${STORAGE_PREFIX}${itemKey}`;
}

// Messages are stored/loaded in the AI SDK's UIMessage shape:
// { id, role, parts: [{ type: 'text', text }] }
export function loadChatHistory(itemKey) {
  try {
    const raw = localStorage.getItem(storageKey(itemKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChatHistory(itemKey, messages) {
  try {
    localStorage.setItem(storageKey(itemKey), JSON.stringify(messages));
  } catch {
    // localStorage full/unavailable — history just won't persist this session.
  }
}

export function clearChatHistory(itemKey) {
  try {
    localStorage.removeItem(storageKey(itemKey));
  } catch { /* ignore */ }
}
