// Thin fetch wrapper for the Otero REST API. All paths are relative to the
// same origin (Vite dev proxy or production static hosting).

const BASE = '';

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    let detail;
    try { detail = (await res.json()).error; } catch { detail = res.statusText; }
    throw new Error(`${res.status} ${detail || ''}`.trim());
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  // Items
  listItems({ type, journal, collection, search, topLevel = true, includeDeleted = false } = {}) {
    const qs = new URLSearchParams();
    if (type) qs.set('type', type);
    if (journal) qs.set('journal', journal);
    if (collection) qs.set('collection', collection);
    if (search) qs.set('search', search);
    qs.set('topLevel', String(topLevel));
    if (includeDeleted) qs.set('includeDeleted', 'true');
    return req(`/api/items?${qs.toString()}`).then(r => r.items);
  },
  async fetchItemExport(key, format = 'bibtex') {
    const res = await fetch(`/api/items/${key}/export?format=${format}`);
    if (!res.ok) {
      let detail;
      try { detail = (await res.json()).error; } catch { detail = res.statusText; }
      throw new Error(`${res.status} ${detail || ''}`.trim());
    }
    return res.text();
  },
  getItem(key) { return req(`/api/items/${key}`); },
  getItemAttachments(key) { return req(`/api/items/${key}/attachments`).then(r => r.attachments); },
  createItem(body) { return req('/api/items', { method: 'POST', body: JSON.stringify(body) }); },
  updateItem(key, body) { return req(`/api/items/${key}`, { method: 'PATCH', body: JSON.stringify(body) }); },
  deleteItem(key, permanent = false) {
    const qs = permanent ? '?permanent=true' : '';
    return req(`/api/items/${key}${qs}`, { method: 'DELETE' });
  },

  // Collections
  listCollections() { return req('/api/collections').then(r => r.collections); },
  getCollection(key) { return req(`/api/collections/${key}`); },
  createCollection({ name, parentKey }) {
    return req('/api/collections', { method: 'POST', body: JSON.stringify({ name, parentKey }) });
  },
  deleteCollection(key, permanent = false) {
    const qs = permanent ? '?permanent=true' : '';
    return req(`/api/collections/${key}${qs}`, { method: 'DELETE' });
  },
  addItemToCollection(collectionKey, itemKey) {
    return req(`/api/collections/${collectionKey}/items`, {
      method: 'POST', body: JSON.stringify({ itemKey }),
    });
  },

  // Journals
  listJournals() { return req('/api/journals').then(r => r.journals); },

  // Import
  uploadPdf(file) {
    const fd = new FormData();
    fd.append('pdf', file);
    return fetch('/api/import/pdf', { method: 'POST', body: fd }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'upload failed');
      return json;
    });
  },
};
