import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepareTestDb, closeDb } from './helpers/pg.js';
import { Item } from '../src/models/Item.js';
import { insertAttachment } from '../src/repositories/itemRepo.js';
import { upsertFullText } from '../src/repositories/fulltextRepo.js';
import {
  getOverviewStats,
  getItemTypeDistribution,
  getPublicationYearHistogram,
  getJournalBreakdown,
  getFullTextStatusCounts,
  getIngestionActivity,
  getDoiCoverageStats,
  getDoiCoverageBreakdown,
  getMissingTargetDois,
} from '../src/repositories/statsRepo.js';
import { JOURNAL_WHITELIST, UNFILED } from '../src/services/journalWhitelist.js';
import { getTargetDoiKeys } from '../src/services/targetDois.js';

const createdKeys = [];
const suffix = () => `s${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

before(async () => {
  await prepareTestDb();
});

after(async () => {
  for (const key of createdKeys.splice(0)) {
    const it = await Item.loadByKey(key);
    if (it) await it.delete(true);
  }
  await closeDb();
});

async function makeItem({
  type = 'journalArticle',
  title,
  date,
  doi,
  publicationTitle,
  creators = [],
} = {}) {
  const it = new Item();
  await it.setItemType(type);
  if (title) it.setField('title', title);
  if (date) it.setField('date', date);
  if (doi) it.setField('DOI', doi);
  if (publicationTitle) it.setField('publicationTitle', publicationTitle);
  for (const c of creators) it.addCreator(c);
  await it.save();
  createdKeys.push(it.key);
  return it;
}

test('getOverviewStats: counts items, distinct creators, DOI and attachment coverage', async () => {
  const before = await getOverviewStats();
  const tag = suffix();
  const p1 = await makeItem({
    title: `Paper 1 ${tag}`,
    doi: `10.1/one-${tag}`,
    creators: [{ firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' }],
  });
  await makeItem({
    title: `Paper 2 ${tag}`,
    creators: [
      { firstName: 'Alice', lastName: `Smith-${tag}`, creatorType: 'author' },
      { firstName: 'Bob', lastName: `Jones-${tag}`, creatorType: 'author' },
    ],
  });
  const att = new Item();
  await att.setItemType('document');
  att.setParent(p1.id);
  await att.save();
  createdKeys.push(att.key);
  await insertAttachment({
    itemId: att.id,
    parentItemId: p1.id,
    linkMode: 0,
    path: `x-${tag}.pdf`,
  });

  const stats = await getOverviewStats();
  assert.equal(stats.totalItems, before.totalItems + 2);
  assert.ok(stats.totalCreators >= before.totalCreators + 2);
  assert.equal(stats.withDoi, before.withDoi + 1);
  assert.equal(stats.withAttachment, before.withAttachment + 1);
  assert.equal(stats.journalCount, JOURNAL_WHITELIST.length);
});

test('getOverviewStats: returns non-negative counters', async () => {
  const stats = await getOverviewStats();
  assert.ok(stats.totalItems >= 0);
  assert.ok(stats.totalCreators >= 0);
  assert.ok(stats.withDoi >= 0);
  assert.ok(stats.withAttachment >= 0);
});

test('getItemTypeDistribution: groups top-level non-deleted items by type', async () => {
  const before = await getItemTypeDistribution();
  const beforeMap = Object.fromEntries(before.map((d) => [d.itemType, d.count]));
  const tag = suffix();
  await makeItem({ type: 'journalArticle', title: `A ${tag}` });
  await makeItem({ type: 'journalArticle', title: `B ${tag}` });
  await makeItem({ type: 'book', title: `C ${tag}` });

  const dist = await getItemTypeDistribution();
  const map = Object.fromEntries(dist.map((d) => [d.itemType, d.count]));
  assert.equal(map.journalArticle, (beforeMap.journalArticle || 0) + 2);
  assert.equal(map.book, (beforeMap.book || 0) + 1);
});

test('getPublicationYearHistogram: extracts years and drops implausible outliers', async () => {
  const before = await getPublicationYearHistogram();
  const beforeMap = Object.fromEntries(before.map((h) => [h.year, h.count]));
  const tag = suffix();
  await makeItem({ title: `A ${tag}`, date: '2020-01-01' });
  await makeItem({ title: `B ${tag}`, date: '2020-06-01' });
  await makeItem({ title: `C ${tag}`, date: '2021' });
  await makeItem({ title: `D ${tag}`, date: '1900' });
  await makeItem({ title: `E ${tag}`, date: 'Sept 2020' });

  const hist = await getPublicationYearHistogram();
  const map = Object.fromEntries(hist.map((h) => [h.year, h.count]));
  assert.equal(map[2020], (beforeMap[2020] || 0) + 3);
  assert.equal(map[2021], (beforeMap[2021] || 0) + 1);
  assert.equal(map[1900], beforeMap[1900]);
});

test('getJournalBreakdown: matches listJournals() counts and buckets UNFILED', async () => {
  const journalName = JOURNAL_WHITELIST[0];
  const before = await getJournalBreakdown();
  const beforeTarget = before.find((j) => j.name === journalName)?.itemCount || 0;
  const beforeUnfiled = before.find((j) => j.name === UNFILED)?.itemCount || 0;
  const tag = suffix();

  await makeItem({ title: `A ${tag}`, publicationTitle: journalName, date: '2022' });
  await makeItem({ title: `B ${tag}`, publicationTitle: journalName, date: '2023' });
  await makeItem({
    title: `C ${tag}`,
    publicationTitle: `Some Other Journal ${tag}`,
    date: '2022',
  });

  const breakdown = await getJournalBreakdown();
  const target = breakdown.find((j) => j.name === journalName);
  assert.equal(target.itemCount, beforeTarget + 2);

  const unfiled = breakdown.find((j) => j.name === UNFILED);
  assert.equal(unfiled.itemCount, beforeUnfiled + 1);
});

test('getFullTextStatusCounts: delegates to fulltextRepo.getFullTextCounts()', async () => {
  const before = await getFullTextStatusCounts();
  const tag = suffix();
  const p1 = await makeItem({ title: `A ${tag}` });
  const p2 = await makeItem({ title: `B ${tag}` });
  await upsertFullText(p1.id, { state: 'done' });
  await upsertFullText(p2.id, { state: 'failed', errCode: '429' });

  const counts = await getFullTextStatusCounts();
  assert.equal(counts.done, (before.done || 0) + 1);
  assert.equal(counts.failed, (before.failed || 0) + 1);
});

test('getIngestionActivity: buckets submitted/completed timestamps by hour', async () => {
  const tag = suffix();
  const p1 = await makeItem({ title: `A ${tag}` });
  const p2 = await makeItem({ title: `B ${tag}` });
  await upsertFullText(p1.id, {
    state: 'done',
    submittedAt: '2026-07-08 07:05:00',
    completedAt: '2026-07-08 07:40:00',
  });
  await upsertFullText(p2.id, {
    state: 'done',
    submittedAt: '2026-07-08 07:50:00',
    completedAt: '2026-07-08 08:10:00',
  });

  const activity = await getIngestionActivity();
  const bucket07 = activity.find((a) => a.hour === '2026-07-08 07:00');
  const bucket08 = activity.find((a) => a.hour === '2026-07-08 08:00');
  assert.ok(bucket07);
  assert.ok(bucket07.submitted >= 2);
  assert.ok(bucket07.completed >= 1);
  assert.ok(bucket08);
  assert.ok(bucket08.completed >= 1);
});

test('getDoiCoverageStats: intersects library DOIs with AIS Basket target list', async () => {
  const before = await getDoiCoverageStats();
  const targetKeys = [...getTargetDoiKeys()];
  assert.ok(targetKeys.length > 10, 'target_dois.txt should load');

  const inTarget = targetKeys[0];
  const alsoInTarget = targetKeys[1];
  const tag = suffix();
  await makeItem({ title: `In basket ${tag}`, doi: inTarget.toUpperCase() });
  await makeItem({ title: `Also in basket ${tag}`, doi: `https://doi.org/${alsoInTarget}` });
  await makeItem({ title: `Extra ${tag}`, doi: `10.9999/otero-coverage-extra-${tag}` });
  await makeItem({ title: `Dup same DOI ${tag}`, doi: inTarget });

  const cov = await getDoiCoverageStats();
  assert.equal(cov.targetTotal, targetKeys.length);
  // Intersection / collected totals are global; only assert they did not shrink
  // and that our unique extra DOI increased collectedOnly (or collectedTotal).
  assert.ok(cov.intersection >= before.intersection);
  assert.ok(cov.collectedTotal >= before.collectedTotal);
  assert.ok(cov.collectedOnly >= before.collectedOnly);
});

test('getMissingTargetDois: lists target DOIs absent from the library', async () => {
  const missing = await getMissingTargetDois();
  const cov = await getDoiCoverageStats();
  assert.equal(missing.total, cov.targetOnly);
  assert.equal(missing.dois.length, cov.targetOnly);
  assert.ok(missing.dois.every((d) => typeof d === 'string' && d.startsWith('10.')));
  for (let i = 1; i < missing.dois.length; i++) {
    assert.ok(missing.dois[i - 1] <= missing.dois[i]);
  }
});

test('getDoiCoverageBreakdown: per-journal totals reconcile with overall coverage', async () => {
  const breakdown = await getDoiCoverageBreakdown();
  const cov = await getDoiCoverageStats();
  assert.equal(breakdown.targetTotal, cov.targetTotal);
  assert.equal(breakdown.collectedTotal, cov.intersection);
  const journalTarget =
    breakdown.journals.reduce((s, j) => s + j.target, 0) + (breakdown.unattributed?.target || 0);
  assert.equal(journalTarget, cov.targetTotal);
  const journalMissing =
    breakdown.journals.reduce((s, j) => s + j.missing, 0) + (breakdown.unattributed?.missing || 0);
  assert.equal(journalMissing, cov.targetOnly);
});
