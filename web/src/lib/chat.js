// Client-side chat history persistence (localStorage only — no server DB).
// Keyed per item so each paper has its own independent conversation.

const STORAGE_PREFIX = 'otero.chat.';

export const CHAT_PRESETS = [
  { label: '总结全文', prompt: '请用中文总结这篇论文的核心内容，包括研究问题、方法和主要结论。' },
  { label: '研究方法', prompt: '这篇论文使用了什么研究方法？请详细说明数据来源、变量设计和分析方法。' },
  { label: '主要贡献', prompt: '这篇论文的主要理论贡献和实践贡献分别是什么？' },
  { label: '局限性', prompt: '这篇论文提到了哪些局限性？未来研究方向是什么？' },
];

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
