import fs from 'node:fs';
import path from 'node:path';
import { query } from '../db/connection.js';
import { config } from '../config.js';
import { Item } from '../models/Item.js';
import { JOURNAL_WHITELIST } from './journalWhitelist.js';
import { isPlaceholderAbstract, shouldOverwriteAbstract } from './metadataRepairRules.js';
import { extractAbstractFromPlain, isAcceptableExtract, polishAbstract } from './abstractExtractRules.js';

const APPLY_CONCURRENCY = 8;

function journalParams() {
  return JOURNAL_WHITELIST;
}

function logProgress(message) {
  process.stderr.write(`${message}\n`);
}

async function runConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, async () => {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
    }
  }));
}

async function findCandidates({ journals, limit, keys } = {}) {
  const pubs = journals?.length ? journals : journalParams();
  const keyFilter = keys?.length ? 'AND i.key = ANY($2)' : '';
  const limitSql = limit ? `LIMIT ${Number(limit)}` : '';
  const params = keys?.length ? [pubs, keys] : [pubs];
  return query(`
    SELECT
      i.key,
      pv.value AS journal,
      left(COALESCE(ft."plainText", ''), 8000) AS excerpt,
      COALESCE(av.value, '') AS abstract
    FROM items i
    JOIN "itemTypes" it ON it."itemTypeID" = i."itemTypeID" AND it."typeName" = 'journalArticle'
    JOIN "itemData" pd ON pd."itemID" = i."itemID"
    JOIN fields pf ON pf."fieldID" = pd."fieldID" AND pf."fieldName" = 'publicationTitle'
    JOIN "itemDataValues" pv ON pv."valueID" = pd."valueID"
    JOIN "itemFullText" ft ON ft."itemID" = i."itemID" AND ft.state = 'done'
    LEFT JOIN "itemData" ad ON ad."itemID" = i."itemID"
      AND ad."fieldID" = (SELECT "fieldID" FROM fields WHERE "fieldName" = 'abstractNote')
    LEFT JOIN "itemDataValues" av ON av."valueID" = ad."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND (
        av.value IS NULL
        OR btrim(av.value) = ''
        OR length(btrim(av.value)) < 250
        OR av.value ~* '<jats:p[[:space:]]*/>'
      )
      ${keyFilter}
    ORDER BY pv.value, i."itemID"
    ${limitSql}
  `, params);
}

export async function extractAbstracts({
  apply = false,
  logPath = null,
  limit = null,
  keys = null,
  journals = null,
} = {}) {
  const rows = await findCandidates({ journals, limit, keys });
  logProgress(`[extract-abstracts] loaded ${rows.length} empty/placeholder candidates`);
  const lines = [];
  const pending = [];
  const byJournal = new Map();
  const bump = (journal, field) => {
    const rec = byJournal.get(journal) || { journal, candidates: 0, hit: 0, skip: 0, noText: 0 };
    rec[field] += 1;
    byJournal.set(journal, rec);
  };

  for (const row of rows) {
    const current = row.abstract || '';
    if (!isPlaceholderAbstract(current)) {
      bump(row.journal, 'skip');
      continue;
    }
    bump(row.journal, 'candidates');
    if (!row.excerpt || row.excerpt.trim().length < 80) {
      lines.push({
        key: row.key,
        journal: row.journal,
        action: 'skip',
        reason: 'no MinerU plainText',
      });
      bump(row.journal, 'noText');
      continue;
    }
    const extracted = extractAbstractFromPlain(row.excerpt);
    if (!extracted) {
      lines.push({ key: row.key, journal: row.journal, action: 'skip', reason: 'no Abstract heading in opening text' });
      continue;
    }
    const polished = polishAbstract(extracted);
    if (!isAcceptableExtract(polished) || !shouldOverwriteAbstract(current, polished, { allowEmpty: true })) {
      lines.push({ key: row.key, journal: row.journal, action: 'skip', reason: 'quality gate' });
      continue;
    }
    const rec = {
      key: row.key,
      journal: row.journal,
      action: apply ? 'apply' : 'dry-run',
      from: current.slice(0, 80),
      chars: polished.length,
      preview: polished.slice(0, 220),
    };
    bump(row.journal, 'hit');
    if (apply) pending.push({ rec, polished });
    else lines.push(rec);
  }

  if (apply && pending.length) {
    let wrote = 0;
    logProgress(`[extract-abstracts] writing ${pending.length} abstracts (${APPLY_CONCURRENCY} concurrent)`);
    await runConcurrent(pending, APPLY_CONCURRENCY, async ({ rec, polished }) => {
      try {
        const item = await Item.loadByKey(rec.key);
        if (item && !item.deleted) {
          item.setField('abstractNote', polished);
          await item.save();
        }
        lines.push(rec);
      } catch (err) {
        rec.action = 'skip';
        rec.reason = `save failed: ${err.message}`;
        lines.push(rec);
        logProgress(`[extract-abstracts] failed ${rec.key}: ${err.message}`);
      }
      wrote += 1;
      if (wrote % 50 === 0 || wrote === pending.length) {
        logProgress(`[extract-abstracts] wrote ${wrote}/${pending.length}`);
      }
    });
  }

  const summary = {
    scanned: rows.length,
    candidates: lines.length,
    hit: lines.filter((l) => l.action === 'apply' || l.action === 'dry-run').length,
    skipped: lines.filter((l) => l.action === 'skip').length,
    byJournal: [...byJournal.values()].map((j) => ({
      ...j,
      rate: j.candidates ? Math.round((100 * j.hit) / j.candidates) : 0,
    })),
  };

  const outPath = logPath || path.join(
    config.dataDir,
    `extract-abstracts-${apply ? 'apply' : 'dry-run'}-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  return { apply, summary, logPath: outPath, samples: {
    hits: lines.filter((l) => l.action !== 'skip').slice(0, 8),
    misses: lines.filter((l) => l.action === 'skip').slice(0, 8),
  } };
}
