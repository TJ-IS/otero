// Thin fetch wrapper for the Otero REST API. All paths are relative to the
// same origin (Vite dev proxy or production static hosting).

const BASE = '';

let authToken = null;

export function setAuthToken(token) {
  authToken = token;
}

export function getAuthToken() {
  return authToken;
}

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  const res = await fetch(BASE + path, {
    headers,
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
  // Auth
  async getMe() { return req('/api/auth/me'); },
  async getNonce(address) {
    return req(`/api/auth/nonce?address=${encodeURIComponent(address)}`).then(r => r.message);
  },
  async verifyWallet(address, nonce, signature) {
    return req('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, nonce, signature }) });
  },

  // Items
  listItems({ type, journal, collection, search, topLevel = true, includeDeleted = false, page = 1, pageSize = 100, sortField = 'dateModified', sortDir = 'desc' } = {}) {
    const qs = new URLSearchParams();
    if (type) qs.set('type', type);
    if (journal) qs.set('journal', journal);
    if (collection) qs.set('collection', collection);
    if (search) qs.set('search', search);
    qs.set('topLevel', String(topLevel));
    if (includeDeleted) qs.set('includeDeleted', 'true');
    qs.set('page', String(page));
    qs.set('pageSize', String(pageSize));
    qs.set('sortField', sortField);
    qs.set('sortDir', sortDir);
    return req(`/api/items?${qs.toString()}`);
  },
  listItemKeys({ type, journal, collection, search, includeDeleted = false } = {}) {
    const qs = new URLSearchParams();
    if (type) qs.set('type', type);
    if (journal) qs.set('journal', journal);
    if (collection) qs.set('collection', collection);
    if (search) qs.set('search', search);
    if (includeDeleted) qs.set('includeDeleted', 'true');
    return req(`/api/items/keys?${qs.toString()}`).then(r => r.keys);
  },
  async fetchItemExport(key, format = 'bibtex') {
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    const res = await fetch(`/api/items/${key}/export?format=${format}`, { headers });
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

  // Authors
  getAuthorGraph(minPapers = 3) {
    return req(`/api/authors/graph?minPapers=${encodeURIComponent(minPapers)}`);
  },
  getAuthor(id) {
    return req(`/api/authors/${encodeURIComponent(id)}`);
  },

  // Dashboard stats
  getStatsOverview() { return req('/api/stats/overview'); },
  getStatsItemTypes() { return req('/api/stats/item-types').then(r => r.itemTypes); },
  getStatsYears() { return req('/api/stats/years').then(r => r.years); },
  getStatsJournals() { return req('/api/stats/journals').then(r => r.journals); },
  getStatsFulltext() { return req('/api/stats/fulltext').then(r => r.counts); },
  getStatsIngestion() { return req('/api/stats/ingestion').then(r => r.activity); },
  getStatsDoiCoverage() { return req('/api/stats/doi-coverage'); },
  getStatsDoiCoverageBreakdown() { return req('/api/stats/doi-coverage/breakdown'); },
  getStatsDoiCoverageMissing({ journal, year } = {}) {
    const qs = new URLSearchParams();
    if (journal) qs.set('journal', journal);
    if (year != null && year !== '') qs.set('year', String(year));
    const q = qs.toString();
    return req(`/api/stats/doi-coverage/missing${q ? `?${q}` : ''}`);
  },
  getAuthorAnalytics({ topN, coreN } = {}) {
    const qs = new URLSearchParams();
    if (topN != null) qs.set('topN', String(topN));
    if (coreN != null) qs.set('coreN', String(coreN));
    const q = qs.toString();
    return req(`/api/authors/analytics${q ? `?${q}` : ''}`);
  },

  // Import
  uploadPdf(file) {
    const fd = new FormData();
    fd.append('pdf', file);
    const headers = {};
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    return fetch('/api/import/pdf', { method: 'POST', headers, body: fd }).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'upload failed');
      return json;
    });
  },

  // Full-text (MinerU)
  parseFulltext(key, { force = false } = {}) {
    const qs = force ? '?force=true' : '';
    return req(`/api/items/${key}/fulltext/parse${qs}`, { method: 'POST' });
  },
  getFulltext(key) { return req(`/api/items/${key}/fulltext`); },
  getFulltextStructure(key) { return req(`/api/items/${key}/fulltext/structure`); },
  deleteFulltext(key) { return req(`/api/items/${key}/fulltext`, { method: 'DELETE' }); },
  parseFulltextBatch(keys) {
    return req('/api/fulltext/parse-batch', { method: 'POST', body: JSON.stringify({ keys }) });
  },
  retryFailedFulltext() {
    return req('/api/fulltext/retry-failed', { method: 'POST' });
  },
  listFulltextPending({ filter = 'all', page = 1, pageSize = 50 } = {}) {
    const qs = new URLSearchParams({ filter, page: String(page), pageSize: String(pageSize) });
    return req(`/api/fulltext/pending?${qs.toString()}`);
  },
  calibrateItem(key) {
    return req(`/api/items/${key}/calibrate`, { method: 'POST' });
  },
  enrichFromCrossref(key, { doi, fields, creators, itemType } = {}) {
    return req(`/api/items/${key}/crossref`, {
      method: 'POST',
      body: JSON.stringify({ doi, fields, creators, itemType }),
    });
  },

  // Admin
  getAdminStatus() { return req('/api/admin/status'); },
  getAdminPostgresStatus() { return req('/api/admin/status/postgres'); },
  getAdminR2Status() { return req('/api/admin/status/r2'); },
  getAdminTrash({ page = 1, pageSize = 50 } = {}) {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return req(`/api/admin/trash?${qs.toString()}`);
  },
  emptyAdminTrash() { return req('/api/admin/trash', { method: 'DELETE' }); },
  getAdminDuplicates() { return req('/api/admin/duplicates'); },
  checkAdminDuplicates({ doi, title, author, limit } = {}) {
    const qs = new URLSearchParams();
    if (doi) qs.set('doi', doi);
    if (title) qs.set('title', title);
    if (author) qs.set('author', author);
    if (limit) qs.set('limit', String(limit));
    return req(`/api/admin/duplicates?${qs.toString()}`);
  },
  preCheckDuplicate(body) {
    return req('/api/admin/duplicates/check', { method: 'POST', body: JSON.stringify(body) });
  },
  getAdminReconcile({ force = false } = {}) {
    return req(`/api/admin/reconcile${force ? '?force=1' : ''}`);
  },
  deleteAdminOrphanObjects(names) {
    return req('/api/admin/reconcile/delete', { method: 'POST', body: JSON.stringify({ names }) });
  },

  // Merkle DOI proofs
  getMerkleRoot() { return req('/api/merkle/root'); },
  checkMerkleExists(doi) {
    return req(`/api/merkle/exists?doi=${encodeURIComponent(doi)}`);
  },
  verifyMerkleProof(doi, proof) {
    return req('/api/merkle/verify', { method: 'POST', body: JSON.stringify({ doi, proof }) });
  },
  rebuildMerkleTree() { return req('/api/merkle/rebuild', { method: 'POST' }); },
};
