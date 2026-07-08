// Shared keyword highlighter. Wraps every case-insensitive occurrence of
// `query` inside `text` in a yellow <mark>, matching the app's existing
// highlight style. Returns the original text unchanged when there is no
// query or no match.

export function highlight(text, query) {
  if (!text) return text || '';
  const q = (query || '').trim();
  if (!q) return text;
  const lower = String(text).toLowerCase();
  const ql = q.toLowerCase();
  const parts = [];
  let i = 0;
  let k = lower.indexOf(ql, i);
  while (k !== -1) {
    if (k > i) parts.push(text.slice(i, k));
    parts.push(
      <mark
        key={k}
        className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded-sm px-0"
      >
        {text.slice(k, k + ql.length)}
      </mark>
    );
    i = k + ql.length;
    k = lower.indexOf(ql, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts.length ? <>{parts}</> : text;
}

// Build a short snippet around the first occurrence of `query` within `text`,
// with `pad` characters of context on each side. Returns the snippet string
// (without markup); callers should pass it through `highlight()` to color the
// match. Returns null when `query` is not found in `text`.
export function snippetAround(text, query, pad = 60) {
  if (!text || !query) return null;
  const lower = String(text).toLowerCase();
  const ql = query.trim().toLowerCase();
  if (!ql) return null;
  const idx = lower.indexOf(ql);
  if (idx === -1) return null;
  const start = Math.max(0, idx - pad);
  const end = Math.min(text.length, idx + ql.length + pad);
  let s = text.slice(start, end);
  if (start > 0) s = '…' + s;
  if (end < text.length) s = s + '…';
  return s;
}
