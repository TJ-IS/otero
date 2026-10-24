import { Router } from 'express';
import { Items, Item } from '../../models/Item.js';
import { toBibtex, toRis, toBibtexBatch, toRisBatch } from '../../services/exportService.js';
import { UNFILED } from '../../services/journalWhitelist.js';
import { hideFromPublic, isEditorRequest, publicItemScope } from '../../services/itemVisibility.js';
import { findPdfAttachmentByItemId } from '../../repositories/itemRepo.js';
import { signPdfAccess, withAbsolutePdfUrl } from '../../services/pdfAccess.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

function isPdfAttachment(att) {
  return String(att.contentType || '')
    .toLowerCase()
    .includes('pdf');
}

export const itemsRouter = Router();

function parseYearQuery(value) {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value) || !/^\d+$/.test(String(value))) return undefined;
  const year = Number(value);
  if (!Number.isSafeInteger(year) || year < 1500 || year > 2099) return undefined;
  return year;
}

function yearFilters(query) {
  const year = parseYearQuery(query.year);
  let yearFrom = parseYearQuery(query.yearFrom);
  let yearTo = parseYearQuery(query.yearTo);
  if (year != null) {
    yearFrom = yearFrom == null ? year : Math.max(yearFrom, year);
    yearTo = yearTo == null ? year : Math.min(yearTo, year);
  }
  return { yearFrom, yearTo };
}

function allowDeleted(req, value) {
  return isEditorRequest(req) && (value === 'true' || value === '1');
}

function refuseUnfiledJournal(req, journal) {
  return journal === UNFILED && !isEditorRequest(req);
}

// GET /api/items
itemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const {
      type,
      journal,
      collection,
      search,
      includeDeleted,
      page,
      pageSize,
      sortField,
      sortDir,
    } = req.query;
    if (refuseUnfiledJournal(req, journal)) {
      return res.json({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 });
    }
    const topLevel = req.query.topLevel !== 'false' && req.query.topLevel !== '0';
    const { yearFrom, yearTo } = yearFilters(req.query);
    const result = await Items.list({
      type,
      journal,
      collection,
      search,
      yearFrom,
      yearTo,
      includeDeleted: allowDeleted(req, includeDeleted),
      topLevelOnly: topLevel,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 100,
      sortField: sortField || 'dateModified',
      sortDir: sortDir || 'desc',
      ...publicItemScope(req),
    });
    res.json({
      items: result.items.map((it) => it.toJSON()),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  }),
);

// GET /api/items/export?format=bibtex|ris
itemsRouter.get(
  '/export',
  asyncHandler(async (req, res) => {
    const { format, type, journal, search } = req.query;
    if (refuseUnfiledJournal(req, journal)) {
      return res.status(200).send('');
    }
    const items = await Items.listAll({
      type,
      journal,
      search,
      includeDeleted: false,
      topLevelOnly: true,
      ...publicItemScope(req),
    });
    if (format === 'ris') {
      res.setHeader('Content-Type', 'application/x-research-info-systems');
      res.setHeader('Content-Disposition', 'attachment; filename="otero-export.ris"');
      res.send(toRisBatch(items));
    } else {
      res.setHeader('Content-Type', 'application/x-bibtex');
      res.setHeader('Content-Disposition', 'attachment; filename="otero-export.bib"');
      res.send(toBibtexBatch(items));
    }
  }),
);

// GET /api/items/keys — all item keys matching a filter (for batch actions).
itemsRouter.get(
  '/keys',
  asyncHandler(async (req, res) => {
    const { type, journal, collection, search, includeDeleted } = req.query;
    if (refuseUnfiledJournal(req, journal)) {
      return res.json({ keys: [] });
    }
    const { yearFrom, yearTo } = yearFilters(req.query);
    const keys = await Items.listKeys({
      type,
      journal,
      collection,
      search,
      yearFrom,
      yearTo,
      includeDeleted: allowDeleted(req, includeDeleted),
      ...publicItemScope(req),
    });
    res.json({ keys });
  }),
);

// GET /api/items/:key/export?format=bibtex|ris
itemsRouter.get(
  '/:key/export',
  asyncHandler(async (req, res) => {
    const it = await Item.loadByKey(req.params.key);
    if (!it || hideFromPublic(req, it)) return res.status(404).json({ error: 'not found' });
    const json = it.toJSON();
    const format = req.query.format || 'bibtex';
    if (format === 'ris') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(toRis(json));
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(toBibtex(json));
    }
  }),
);

// GET /api/items/:key
itemsRouter.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const it = await Item.loadByKey(req.params.key);
    if (!it || hideFromPublic(req, it)) return res.status(404).json({ error: 'not found' });
    res.json(it.toJSON());
  }),
);

// POST /api/items
itemsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const it = new Item();
    if (!body.itemType) return res.status(400).json({ error: 'itemType required' });
    await it.setItemType(body.itemType);
    if (body.fields) for (const [k, v] of Object.entries(body.fields)) it.setField(k, v);
    if (body.creators) it.setCreators(body.creators);
    await it.save();
    res.status(201).json(it.toJSON());
  }),
);

// PATCH /api/items/:key
itemsRouter.patch(
  '/:key',
  asyncHandler(async (req, res) => {
    const it = await Item.loadByKey(req.params.key);
    if (!it) return res.status(404).json({ error: 'not found' });
    const body = req.body ?? {};
    if (body.itemType) await it.setItemType(body.itemType);
    if (body.fields) {
      for (const [k, v] of Object.entries(body.fields)) {
        if (v === null) it.setField(k, null);
        else it.setField(k, v);
      }
    }
    if (body.creators) it.setCreators(body.creators);
    await it.save();
    res.json(it.toJSON());
  }),
);

// DELETE /api/items/:key
itemsRouter.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const it = await Item.loadByKey(req.params.key);
    if (!it) return res.status(404).json({ error: 'not found' });
    const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
    await it.delete(permanent);
    res.json({ deleted: true, permanent });
  }),
);

// GET /api/items/:key/pdf-url — mint a short-lived signed PDF URL (logged-in only).
itemsRouter.get(
  '/:key/pdf-url',
  asyncHandler(async (req, res) => {
    if (!req.auth?.address) {
      return res.status(404).json({ error: 'not found' });
    }
    const it = await Item.loadByKey(req.params.key);
    if (!it || hideFromPublic(req, it)) return res.status(404).json({ error: 'not found' });

    let attachmentKey = typeof req.query.attachment === 'string' ? req.query.attachment : '';
    if (attachmentKey) {
      const { Attachment } = await import('../../models/Attachment.js');
      const atts = await Attachment.listByParent(it.id);
      const match = atts.find((a) => a.key === attachmentKey && isPdfAttachment(a));
      if (!match) return res.status(404).json({ error: 'pdf not available' });
    } else {
      attachmentKey = await findPdfAttachmentByItemId(it.id);
    }
    if (!attachmentKey) return res.status(404).json({ error: 'pdf not available' });

    res.json(withAbsolutePdfUrl(req, signPdfAccess(attachmentKey), { itemKey: it.key }));
  }),
);

// GET /api/items/:key/attachments
itemsRouter.get(
  '/:key/attachments',
  asyncHandler(async (req, res) => {
    const it = await Item.loadByKey(req.params.key);
    if (!it || hideFromPublic(req, it)) return res.status(404).json({ error: 'not found' });
    const { Attachment } = await import('../../models/Attachment.js');
    const atts = await Attachment.listByParent(it.id);
    const payload = atts.map((a) => a.toJSON());
    res.json({
      attachments: req.auth?.address ? payload : payload.filter((a) => !isPdfAttachment(a)),
    });
  }),
);
