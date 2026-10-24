import fs from 'node:fs';
import path from 'node:path';
import { Item } from '../models/Item.js';
import { query } from '../db/connection.js';
import { config } from '../config.js';
import { JOURNAL_WHITELIST } from './journalWhitelist.js';
import { fetchByDoi } from './recognizers/crossref.js';
import { mapRecognized } from './metadataMapper.js';
import { extractItem } from './extractService.js';
import {
  TEST_GARBAGE_KEYS,
  SKIP_AUTHOR_KEYS,
  CONFIRMED_AUTHOR_KEYS,
  rewriteDoi,
  doisEqual,
  shouldOverwriteDate,
  shouldOverwriteTitle,
  shouldReplaceCreators,
  isPlaceholderAbstract,
  shouldOverwriteAbstract,
  isTestGarbage,
  phase3KeySet,
  stripMarkup,
} from './metadataRepairRules.js';

export {
  rewriteDoi,
  shouldOverwriteDate,
  shouldOverwriteTitle,
  shouldReplaceCreators,
  isPlaceholderAbstract,
  shouldOverwriteAbstract,
  isTestGarbage,
} from './metadataRepairRules.js';

const CROSSREF_GAP_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function creatorSnapshot(creators) {
  return (creators || []).map((c) => ({
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    creatorType: c.creatorType || 'author',
    fieldMode: c.fieldMode ?? 0,
  }));
}

function creatorLabel(c) {
  const first = c.firstName || '';
  const last = c.lastName || '';
  return [last, first].filter(Boolean).join(', ') || '(empty)';
}

function mapCrossrefCreators(mapped) {
  return (mapped.creators || []).map((c, i) => ({
    firstName: c.firstName || '',
    lastName: c.lastName || c.name || '',
    creatorType: c.creatorType || 'author',
    fieldMode: c.name && !c.firstName ? 1 : 0,
    orderIndex: i,
  }));
}

function stripCrossrefAbstract(mapped) {
  if (mapped.fields.abstractNote) {
    mapped.fields.abstractNote = stripMarkup(mapped.fields.abstractNote);
  }
  return mapped;
}

async function loadBasketItem(key) {
  const item = await Item.loadByKey(key);
  if (!item || item.deleted) return null;
  return item;
}

async function fetchMapped(doi) {
  const recognized = await fetchByDoi(doi);
  if (!recognized) return null;
  return stripCrossrefAbstract(mapRecognized(recognized));
}

function journalParams() {
  return JOURNAL_WHITELIST;
}

function basketJoin() {
  return `
    JOIN "itemData" pd ON pd."itemID" = i."itemID"
    JOIN fields pf ON pf."fieldID" = pd."fieldID" AND pf."fieldName" = 'publicationTitle'
    JOIN "itemDataValues" pv ON pv."valueID" = pd."valueID"
  `;
}

async function findKeysByBadDois() {
  const rows = await query(
    `
    SELECT i.key, dv.value AS doi
    FROM items i
    ${basketJoin()}
    JOIN "itemData" dd ON dd."itemID" = i."itemID"
    JOIN fields df ON df."fieldID" = dd."fieldID" AND df."fieldName" = 'DOI'
    JOIN "itemDataValues" dv ON dv."valueID" = dd."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND (
        dv.value ~* 'i[,.]dss'
        OR dv.value ~* 'i[,.]im[,.]'
        OR dv.value ~* '^https?://'
        OR dv.value ~* '^doi:'
        OR dv.value ~ '10\\.17705/1\\.jais\\.'
        OR dv.value ~ '10\\.17005/1jais\\.'
        OR dv.value ~ ','
      )
  `,
    [journalParams()],
  );
  return rows.filter((r) => rewriteDoi(r.doi) !== String(r.doi || '').trim()).map((r) => r.key);
}

async function findKeysByBrokenCreators() {
  const rows = await query(
    `
    SELECT DISTINCT i.key
    FROM items i
    ${basketJoin()}
    LEFT JOIN "itemCreators" ic ON ic."itemID" = i."itemID"
    LEFT JOIN creators c ON c."creatorID" = ic."creatorID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND (
        ic."itemID" IS NULL
        OR (btrim(COALESCE(c."firstName", '')) = '' AND btrim(COALESCE(c."lastName", '')) = '')
        OR c."firstName" ~* '^and[ .]'
        OR lower(btrim(COALESCE(c."lastName", ''))) IN ('jene','wendy','joan','fion','dasy1','and','jr.','jr')
        OR (btrim(COALESCE(c."firstName", '')) = '' AND lower(btrim(COALESCE(c."lastName", ''))) IN ('recker','rosemann','green','indulska','mild','degross'))
        OR COALESCE(c."lastName", '') ~* 't17855'
        OR COALESCE(c."firstName", '') ~* 't17855'
      )
  `,
    [journalParams()],
  );
  return rows.map((r) => r.key);
}

async function findKeysByBadTitles() {
  const rows = await query(
    `
    SELECT i.key
    FROM items i
    ${basketJoin()}
    JOIN "itemData" td ON td."itemID" = i."itemID"
    JOIN fields tf ON tf."fieldID" = td."fieldID" AND tf."fieldName" = 'title'
    JOIN "itemDataValues" tv ON tv."valueID" = td."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND (
        tv.value ~* '^JAIS Author Template$'
        OR tv.value ~ 'â•|â€|Ã.|�'
      )
  `,
    [journalParams()],
  );
  return rows.map((r) => r.key);
}

async function findKeysByBadDates() {
  const rows = await query(
    `
    SELECT i.key
    FROM items i
    ${basketJoin()}
    JOIN "itemData" dtd ON dtd."itemID" = i."itemID"
    JOIN fields dtf ON dtf."fieldID" = dtd."fieldID" AND dtf."fieldName" = 'date'
    JOIN "itemDataValues" dtv ON dtv."valueID" = dtd."valueID"
    LEFT JOIN LATERAL (
      SELECT dv.value
      FROM "itemData" dd
      JOIN fields df ON df."fieldID" = dd."fieldID" AND df."fieldName" = 'DOI'
      JOIN "itemDataValues" dv ON dv."valueID" = dd."valueID"
      WHERE dd."itemID" = i."itemID"
      LIMIT 1
    ) doi ON TRUE
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND (
        dtv.value !~ '^[0-9]{4}$'
        OR (
          doi.value ~ 'misq/([12][0-9]{3})'
          AND dtv.value ~ '^[0-9]{4}'
          AND abs(
            substring(doi.value from 'misq/([12][0-9]{3})')::int
            - left(dtv.value, 4)::int
          ) >= 3
        )
      )
  `,
    [journalParams()],
  );
  return rows.map((r) => r.key);
}

async function findKeysByPlaceholderAbstracts() {
  const rows = await query(
    `
    SELECT i.key, av.value AS abstract
    FROM items i
    ${basketJoin()}
    JOIN "itemData" ad ON ad."itemID" = i."itemID"
    JOIN fields af ON af."fieldID" = ad."fieldID" AND af."fieldName" = 'abstractNote'
    JOIN "itemDataValues" av ON av."valueID" = ad."valueID"
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND btrim(av.value) <> ''
      AND (
        length(btrim(av.value)) < 200
        OR av.value ~* '<jats:p\\s*/>'
        OR av.value ~* 'research (article|note|essay)'
        OR av.value ~* 'corrected proof|accepted manuscript|doi:\\s*10\\.'
      )
  `,
    [journalParams()],
  );
  return rows.filter((r) => isPlaceholderAbstract(r.abstract)).map((r) => r.key);
}

async function findEmptyAuthorKeys() {
  const rows = await query(
    `
    SELECT i.key
    FROM items i
    ${basketJoin()}
    WHERE i.deleted = 0 AND i."parentItemID" IS NULL
      AND pv.value = ANY($1)
      AND NOT EXISTS (SELECT 1 FROM "itemCreators" ic WHERE ic."itemID" = i."itemID")
  `,
    [journalParams()],
  );
  return rows.map((r) => r.key).filter((key) => !SKIP_AUTHOR_KEYS.has(key));
}

function filterKeys(keys, onlyKeys) {
  if (!onlyKeys || onlyKeys.length === 0) return keys;
  const allow = new Set(onlyKeys);
  return keys.filter((key) => allow.has(key));
}

function uniqueKeys(lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    for (const key of list) {
      if (!key || seen.has(key) || TEST_GARBAGE_KEYS.includes(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

async function collectPhase3Keys() {
  const [badDois, brokenCreators, badTitles, badDates, placeholderAbs] = await Promise.all([
    findKeysByBadDois(),
    findKeysByBrokenCreators(),
    findKeysByBadTitles(),
    findKeysByBadDates(),
    findKeysByPlaceholderAbstracts(),
  ]);
  return uniqueKeys([
    [...phase3KeySet()],
    badDois,
    brokenCreators,
    badTitles,
    badDates,
    placeholderAbs,
  ]);
}

function fieldChange(field, from, to, source, reason) {
  return { field, from, to, source, reason };
}

async function applyFieldChanges(item, changes, { apply }) {
  if (!apply || changes.length === 0) return;
  for (const ch of changes) {
    if (ch.field === 'creators') {
      item.setCreators(ch.to);
    } else {
      item.setField(ch.field, ch.to);
    }
  }
  await item.save();
}

async function repairTestGarbage({ apply, log }) {
  const results = [];
  for (const key of TEST_GARBAGE_KEYS) {
    const item = await Item.loadByKey(key);
    if (!item) {
      const row = { key, phase: 1, action: 'skip', reason: 'not found' };
      log(row);
      results.push(row);
      continue;
    }
    const title = item.getField('title') || '';
    const date = item.getField('date') || '';
    const doi = item.getField('DOI') || '';
    if (!isTestGarbage({ title, date, doi })) {
      const row = {
        key,
        phase: 1,
        action: 'skip',
        reason: 'failed safety check',
        title,
        date,
        doi,
      };
      log(row);
      results.push(row);
      continue;
    }
    if (apply) await item.delete(false);
    const row = {
      key,
      phase: 1,
      action: apply ? 'soft-delete' : 'would-soft-delete',
      title,
      date,
      changes: [fieldChange('deleted', 0, 1, 'safety-list', 'test garbage')],
    };
    log(row);
    results.push(row);
  }
  return results;
}

async function repairDois({ apply, log, onlyKeys }) {
  const keys = filterKeys(await findKeysByBadDois(), onlyKeys);
  const results = [];
  for (const key of keys) {
    const item = await loadBasketItem(key);
    if (!item) continue;
    const current = (item.getField('DOI') || '').trim();
    const rewritten = rewriteDoi(current);
    if (!rewritten || rewritten === current) continue;

    await sleep(CROSSREF_GAP_MS);
    const mapped = await fetchMapped(rewritten);
    if (!mapped) {
      const row = {
        key,
        phase: 2,
        action: 'rollback',
        reason: `Crossref miss after rewrite: ${rewritten}`,
        from: current,
        to: rewritten,
      };
      log(row);
      results.push(row);
      continue;
    }
    const verified = mapped.fields.DOI ? rewriteDoi(mapped.fields.DOI) : rewritten;
    const changes = [
      fieldChange('DOI', current, verified, 'doi-rewrite+crossref', `rewrote ${current}`),
    ];
    await applyFieldChanges(item, changes, { apply });
    const row = {
      key,
      phase: 2,
      action: apply ? 'apply' : 'dry-run',
      changes,
      title: mapped.fields.title || item.getField('title') || '',
    };
    log(row);
    results.push(row);
  }
  return results;
}

function planCrossrefChanges(item, mapped, key) {
  const changes = [];
  const fields = mapped.fields || {};
  const currentDate = item.getField('date') || '';
  if (fields.date && shouldOverwriteDate(currentDate, fields.date)) {
    changes.push(fieldChange('date', currentDate, fields.date, 'crossref', 'year gap or non-YYYY'));
  }
  const currentTitle = item.getField('title') || '';
  if (fields.title && shouldOverwriteTitle(currentTitle)) {
    changes.push(
      fieldChange('title', currentTitle, fields.title, 'crossref', 'template or mojibake'),
    );
  }
  const currentDoi = item.getField('DOI') || '';
  if (fields.DOI && !doisEqual(currentDoi, fields.DOI)) {
    changes.push(
      fieldChange('DOI', currentDoi, rewriteDoi(fields.DOI), 'crossref', 'normalized DOI'),
    );
  }
  const suggestedCreators = mapCrossrefCreators(mapped);
  if (
    !SKIP_AUTHOR_KEYS.has(key) &&
    suggestedCreators.length > 0 &&
    shouldReplaceCreators(item.creators)
  ) {
    changes.push(
      fieldChange(
        'creators',
        creatorSnapshot(item.creators),
        suggestedCreators,
        'crossref',
        'broken or missing authors',
      ),
    );
  }
  const currentAbs = item.getField('abstractNote') || '';
  if (
    shouldOverwriteAbstract(currentAbs, fields.abstractNote, {
      allowEmpty: phase3KeySet().has(key),
    })
  ) {
    changes.push(
      fieldChange(
        'abstractNote',
        currentAbs,
        fields.abstractNote,
        'crossref',
        currentAbs ? 'placeholder abstract' : 'empty abstract on confirmed item',
      ),
    );
  }
  return changes;
}

async function repairFromCrossref({ apply, log, onlyKeys }) {
  const keys = filterKeys(await collectPhase3Keys(), onlyKeys);
  const results = [];
  for (const key of keys) {
    const item = await loadBasketItem(key);
    if (!item) continue;
    const doi = rewriteDoi(item.getField('DOI') || '');
    if (!doi) {
      const row = { key, phase: 3, action: 'skip', reason: 'no DOI' };
      log(row);
      results.push(row);
      continue;
    }
    await sleep(CROSSREF_GAP_MS);
    let mapped;
    try {
      mapped = await fetchMapped(doi);
    } catch (err) {
      const row = { key, phase: 3, action: 'error', reason: err.message };
      log(row);
      results.push(row);
      continue;
    }
    if (!mapped) {
      const row = { key, phase: 3, action: 'skip', reason: `Crossref miss: ${doi}` };
      log(row);
      results.push(row);
      continue;
    }
    const changes = planCrossrefChanges(item, mapped, key);
    if (changes.length === 0) {
      const row = { key, phase: 3, action: 'skip', reason: 'no rule matched' };
      log(row);
      results.push(row);
      continue;
    }
    await applyFieldChanges(item, changes, { apply });
    const row = {
      key,
      phase: 3,
      action: apply ? 'apply' : 'dry-run',
      changes: changes.map((ch) =>
        ch.field === 'creators'
          ? {
              ...ch,
              from: ch.from.map(creatorLabel),
              to: ch.to.map(creatorLabel),
            }
          : ch,
      ),
    };
    log(row);
    results.push(row);
  }
  return results;
}

async function applyCreatorsFromExtract(item, { apply, log }) {
  const result = await extractItem(item.key);
  const confident = (result.creators || []).filter((c) => (c.confidence ?? 0) >= 0.8);
  if (confident.length === 0 || confident.length !== (result.creators || []).length) {
    const row = {
      key: item.key,
      phase: 4,
      action: 'skip',
      reason: 'extract creators below threshold',
    };
    log(row);
    return row;
  }
  const suggested = confident.map((c, i) => ({
    firstName: c.firstName || '',
    lastName: c.lastName || '',
    creatorType: c.creatorType || 'author',
    fieldMode: c.fieldMode ?? 0,
    orderIndex: i,
  }));
  const changes = [
    fieldChange(
      'creators',
      creatorSnapshot(item.creators),
      suggested,
      'extractItem',
      'Crossref had no authors',
    ),
  ];
  await applyFieldChanges(item, changes, { apply });
  const row = {
    key: item.key,
    phase: 4,
    action: apply ? 'apply' : 'dry-run',
    changes: [
      {
        ...changes[0],
        from: changes[0].from.map(creatorLabel),
        to: changes[0].to.map(creatorLabel),
      },
    ],
  };
  log(row);
  return row;
}

async function findPhase4Keys() {
  const empty = await findEmptyAuthorKeys();
  const leftover = [];
  for (const key of CONFIRMED_AUTHOR_KEYS) {
    if (SKIP_AUTHOR_KEYS.has(key) || empty.includes(key)) continue;
    const item = await loadBasketItem(key);
    if (item && shouldReplaceCreators(item.creators)) leftover.push(key);
  }
  return uniqueKeys([empty, leftover]);
}

async function repairAuthorsFallback({ apply, log, onlyKeys }) {
  const keys = filterKeys(await findPhase4Keys(), onlyKeys);
  const results = [];
  for (const key of keys) {
    const item = await loadBasketItem(key);
    if (!item) continue;
    if ((item.creators || []).length > 0 && !shouldReplaceCreators(item.creators)) {
      continue;
    }
    const doi = rewriteDoi(item.getField('DOI') || '');
    if (doi) {
      await sleep(CROSSREF_GAP_MS);
      const mapped = await fetchMapped(doi).catch(() => null);
      const suggested = mapped ? mapCrossrefCreators(mapped) : [];
      if (suggested.length > 0 && !shouldReplaceCreators(suggested)) {
        const changes = [
          fieldChange(
            'creators',
            creatorSnapshot(item.creators),
            suggested,
            'crossref',
            'empty authors, Crossref recovered',
          ),
        ];
        await applyFieldChanges(item, changes, { apply });
        const row = {
          key,
          phase: 4,
          action: apply ? 'apply' : 'dry-run',
          changes: [
            {
              ...changes[0],
              from: changes[0].from.map(creatorLabel),
              to: changes[0].to.map(creatorLabel),
            },
          ],
        };
        log(row);
        results.push(row);
        continue;
      }
    }
    if (!apply) {
      const row = {
        key,
        phase: 4,
        action: 'dry-run',
        reason: 'would extract creators from fulltext (LLM skipped in dry-run)',
      };
      log(row);
      results.push(row);
      continue;
    }
    try {
      results.push(await applyCreatorsFromExtract(item, { apply, log }));
    } catch (err) {
      const row = { key, phase: 4, action: 'error', reason: err.message };
      log(row);
      results.push(row);
    }
  }
  return results;
}

export async function repairMetadata({
  apply = false,
  phase = 'all',
  logPath = null,
  keys = null,
} = {}) {
  const onlyKeys = Array.isArray(keys) ? keys.map((k) => String(k).trim()).filter(Boolean) : [];
  const phases =
    phase === 'all' || phase === '0'
      ? [1, 2, 3, 4]
      : String(phase)
          .split(',')
          .map((p) => Number(p.trim()))
          .filter((n) => n >= 1 && n <= 4);

  const lines = [];
  const log = (row) => {
    const rec = { at: new Date().toISOString(), apply, ...row };
    lines.push(rec);
    const label = rec.action || 'log';
    const extra = rec.reason ? ` ${rec.reason}` : '';
    const n = rec.changes?.length ? ` changes=${rec.changes.length}` : '';
    console.log(`[p${rec.phase || '-'} ${label}] ${rec.key || '-'}${n}${extra}`);
  };

  const results = { apply, phases, items: [] };
  if (phases.includes(1)) results.items.push(...(await repairTestGarbage({ apply, log })));
  if (phases.includes(2)) results.items.push(...(await repairDois({ apply, log, onlyKeys })));
  if (phases.includes(3))
    results.items.push(...(await repairFromCrossref({ apply, log, onlyKeys })));
  if (phases.includes(4))
    results.items.push(...(await repairAuthorsFallback({ apply, log, onlyKeys })));

  const applied = results.items.filter(
    (r) =>
      r.action === 'apply' ||
      r.action === 'soft-delete' ||
      r.action === 'would-soft-delete' ||
      r.action === 'dry-run',
  ).length;
  const skipped = results.items.filter(
    (r) => r.action === 'skip' || r.action === 'rollback',
  ).length;
  const errors = results.items.filter((r) => r.action === 'error').length;
  results.summary = {
    total: results.items.length,
    applied,
    skipped,
    errors,
  };

  const outPath =
    logPath ||
    path.join(
      config.dataDir,
      `repair-metadata-${apply ? 'apply' : 'dry-run'}-${new Date().toISOString().replace(/[:.]/g, '')}.jsonl`,
    );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''),
  );
  results.logPath = outPath;
  return results;
}
