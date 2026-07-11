import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetTestDb, closeDb } from './helpers/pg.js';
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
} from '../src/repositories/statsRepo.js';
import { JOURNAL_WHITELIST, UNFILED } from '../src/services/journalWhitelist.js';

before(async () => {
  await resetTestDb();
});

after(async () => {
  await closeDb();
});

async function makeItem({ type = 'journalArticle', title, date, doi, publicationTitle, creators = [] } = {}) {
  const it = new Item();
  await it.setItemType(type);
  if (title) it.setField('title', title);
  if (date) it.setField('date', date);
  if (doi) it.setField('DOI', doi);
  if (publicationTitle) it.setField('publicationTitle', publicationTitle);
  for (const c of creators) it.addCreator(c);
  await it.save();
  return it;
}

test('getOverviewStats: counts items, distinct creators, DOI and attachment coverage', async () => {
  await resetTestDb();
  const p1 = await makeItem({
    title: 'Paper 1', doi: '10.1/one',
    creators: [{ firstName: 'Alice', lastName: 'Smith', creatorType: 'author' }],
  });
  await makeItem({
    title: 'Paper 2',
    creators: [
      { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
      { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
    ],
  });
  // Child attachment item (parentItemID set) so it is not counted as a top-level item.
  const att = new Item();
  await att.setItemType('document');
  att.setParent(p1.id);
  await att.save();
  await insertAttachment({ itemId: att.id, parentItemId: p1.id, linkMode: 0, path: 'x.pdf' });

  const stats = await getOverviewStats();
  assert.equal(stats.totalItems, 2);
  assert.equal(stats.totalCreators, 2);
  assert.equal(stats.withDoi, 1);
  assert.equal(stats.withAttachment, 1);
  assert.equal(stats.journalCount, JOURNAL_WHITELIST.length);
});

test('getOverviewStats: empty database returns all zeros', async () => {
  await resetTestDb();
  const stats = await getOverviewStats();
  assert.equal(stats.totalItems, 0);
  assert.equal(stats.totalCreators, 0);
  assert.equal(stats.withDoi, 0);
  assert.equal(stats.withAttachment, 0);
});

test('getItemTypeDistribution: groups top-level non-deleted items by type', async () => {
  await resetTestDb();
  await makeItem({ type: 'journalArticle', title: 'A' });
  await makeItem({ type: 'journalArticle', title: 'B' });
  await makeItem({ type: 'book', title: 'C' });

  const dist = await getItemTypeDistribution();
  const map = Object.fromEntries(dist.map(d => [d.itemType, d.count]));
  assert.equal(map.journalArticle, 2);
  assert.equal(map.book, 1);
});

test('getPublicationYearHistogram: extracts years and drops implausible outliers', async () => {
  await resetTestDb();
  await makeItem({ title: 'A', date: '2020-01-01' });
  await makeItem({ title: 'B', date: '2020-06-01' });
  await makeItem({ title: 'C', date: '2021' });
  await makeItem({ title: 'D', date: '1900' });
  await makeItem({ title: 'E', date: 'Sept 2020' });

  const hist = await getPublicationYearHistogram();
  const map = Object.fromEntries(hist.map(h => [h.year, h.count]));
  assert.equal(map[2020], 3);
  assert.equal(map[2021], 1);
  assert.equal(map[1900], undefined);
});

test('getJournalBreakdown: matches listJournals() counts and buckets UNFILED', async () => {
  await resetTestDb();
  const journalName = JOURNAL_WHITELIST[0];
  await makeItem({ title: 'A', publicationTitle: journalName, date: '2022' });
  await makeItem({ title: 'B', publicationTitle: journalName, date: '2023' });
  await makeItem({ title: 'C', publicationTitle: 'Some Other Journal', date: '2022' });

  const breakdown = await getJournalBreakdown();
  const target = breakdown.find(j => j.name === journalName);
  assert.equal(target.itemCount, 2);
  assert.deepEqual(target.years, [{ year: 2022, count: 1 }, { year: 2023, count: 1 }]);

  const unfiled = breakdown.find(j => j.name === UNFILED);
  assert.equal(unfiled.itemCount, 1);
  assert.deepEqual(unfiled.years, [{ year: 2022, count: 1 }]);
});

test('getFullTextStatusCounts: delegates to fulltextRepo.getFullTextCounts()', async () => {
  await resetTestDb();
  const p1 = await makeItem({ title: 'A' });
  const p2 = await makeItem({ title: 'B' });
  await upsertFullText(p1.id, { state: 'done' });
  await upsertFullText(p2.id, { state: 'failed', errCode: '429' });

  const counts = await getFullTextStatusCounts();
  assert.equal(counts.done, 1);
  assert.equal(counts.failed, 1);
});

test('getIngestionActivity: buckets submitted/completed timestamps by hour', async () => {
  await resetTestDb();
  const p1 = await makeItem({ title: 'A' });
  const p2 = await makeItem({ title: 'B' });
  await upsertFullText(p1.id, { state: 'done', submittedAt: '2026-07-08 07:05:00', completedAt: '2026-07-08 07:40:00' });
  await upsertFullText(p2.id, { state: 'done', submittedAt: '2026-07-08 07:50:00', completedAt: '2026-07-08 08:10:00' });

  const activity = await getIngestionActivity();
  const bucket07 = activity.find(a => a.hour === '2026-07-08 07:00');
  const bucket08 = activity.find(a => a.hour === '2026-07-08 08:00');
  assert.equal(bucket07.submitted, 2);
  assert.equal(bucket07.completed, 1);
  assert.equal(bucket08.completed, 1);
});
