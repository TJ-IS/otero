import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { setDb, closeDb, getDb } from '../src/db/connection.js';
import { runMigrations } from '../src/db/migrate.js';
import { seed } from '../src/db/seed.js';
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

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  setDb(db);
  runMigrations();
  seed();
  return db;
}

function makeItem({ type = 'journalArticle', title, date, doi, publicationTitle, creators = [] } = {}) {
  const it = new Item();
  it.setItemType(type);
  if (title) it.setField('title', title);
  if (date) it.setField('date', date);
  if (doi) it.setField('DOI', doi);
  if (publicationTitle) it.setField('publicationTitle', publicationTitle);
  for (const c of creators) it.addCreator(c);
  it.save();
  return it;
}

test('getOverviewStats: counts items, distinct creators, DOI and attachment coverage', () => {
  setup();
  try {
    const p1 = makeItem({
      title: 'Paper 1', doi: '10.1/one',
      creators: [{ firstName: 'Alice', lastName: 'Smith', creatorType: 'author' }],
    });
    makeItem({
      title: 'Paper 2',
      creators: [
        { firstName: 'Alice', lastName: 'Smith', creatorType: 'author' },
        { firstName: 'Bob', lastName: 'Jones', creatorType: 'author' },
      ],
    });
    insertAttachment({ itemId: p1.id, parentItemId: p1.id, linkMode: 0, path: 'x.pdf' });

    const stats = getOverviewStats();
    assert.equal(stats.totalItems, 2);
    assert.equal(stats.totalCreators, 2);
    assert.equal(stats.withDoi, 1);
    assert.equal(stats.withAttachment, 1);
    assert.equal(stats.journalCount, JOURNAL_WHITELIST.length);
  } finally {
    closeDb();
  }
});

test('getOverviewStats: empty database returns all zeros', () => {
  setup();
  try {
    const stats = getOverviewStats();
    assert.equal(stats.totalItems, 0);
    assert.equal(stats.totalCreators, 0);
    assert.equal(stats.withDoi, 0);
    assert.equal(stats.withAttachment, 0);
  } finally {
    closeDb();
  }
});

test('getItemTypeDistribution: groups top-level non-deleted items by type', () => {
  setup();
  try {
    makeItem({ type: 'journalArticle', title: 'A' });
    makeItem({ type: 'journalArticle', title: 'B' });
    makeItem({ type: 'book', title: 'C' });

    const dist = getItemTypeDistribution();
    const map = Object.fromEntries(dist.map(d => [d.itemType, d.count]));
    assert.equal(map.journalArticle, 2);
    assert.equal(map.book, 1);
  } finally {
    closeDb();
  }
});

test('getPublicationYearHistogram: extracts years and drops implausible outliers', () => {
  setup();
  try {
    makeItem({ title: 'A', date: '2020-01-01' });
    makeItem({ title: 'B', date: '2020-06-01' });
    makeItem({ title: 'C', date: '2021' });
    makeItem({ title: 'D', date: '1900' }); // implausible, dropped
    makeItem({ title: 'E', date: 'Sept 2020' }); // month-name noise, but still has a valid year token

    const hist = getPublicationYearHistogram();
    const map = Object.fromEntries(hist.map(h => [h.year, h.count]));
    assert.equal(map[2020], 3);
    assert.equal(map[2021], 1);
    assert.equal(map[1900], undefined);
  } finally {
    closeDb();
  }
});

test('getJournalBreakdown: matches listJournals() counts and buckets UNFILED', () => {
  setup();
  try {
    const journalName = JOURNAL_WHITELIST[0];
    makeItem({ title: 'A', publicationTitle: journalName, date: '2022' });
    makeItem({ title: 'B', publicationTitle: journalName, date: '2023' });
    makeItem({ title: 'C', publicationTitle: 'Some Other Journal', date: '2022' });

    const breakdown = getJournalBreakdown();
    const target = breakdown.find(j => j.name === journalName);
    assert.equal(target.itemCount, 2);
    assert.deepEqual(target.years, [{ year: 2022, count: 1 }, { year: 2023, count: 1 }]);

    const unfiled = breakdown.find(j => j.name === UNFILED);
    assert.equal(unfiled.itemCount, 1);
    assert.deepEqual(unfiled.years, [{ year: 2022, count: 1 }]);
  } finally {
    closeDb();
  }
});

test('getFullTextStatusCounts: delegates to fulltextRepo.getFullTextCounts()', () => {
  setup();
  try {
    const p1 = makeItem({ title: 'A' });
    const p2 = makeItem({ title: 'B' });
    upsertFullText(p1.id, { state: 'done' });
    upsertFullText(p2.id, { state: 'failed', errCode: '429' });

    const counts = getFullTextStatusCounts();
    assert.equal(counts.done, 1);
    assert.equal(counts.failed, 1);
  } finally {
    closeDb();
  }
});

test('getIngestionActivity: buckets submitted/completed timestamps by hour', () => {
  setup();
  try {
    const p1 = makeItem({ title: 'A' });
    const p2 = makeItem({ title: 'B' });
    upsertFullText(p1.id, { state: 'done', submittedAt: '2026-07-08 07:05:00', completedAt: '2026-07-08 07:40:00' });
    upsertFullText(p2.id, { state: 'done', submittedAt: '2026-07-08 07:50:00', completedAt: '2026-07-08 08:10:00' });

    const activity = getIngestionActivity();
    const bucket07 = activity.find(a => a.hour === '2026-07-08 07:00');
    const bucket08 = activity.find(a => a.hour === '2026-07-08 08:00');
    assert.equal(bucket07.submitted, 2);
    assert.equal(bucket07.completed, 1);
    assert.equal(bucket08.completed, 1);
  } finally {
    closeDb();
  }
});
