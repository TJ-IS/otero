import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JOURNAL_WHITELIST,
  UNFILED,
  classifyJournal,
} from '../src/services/journalWhitelist.js';
import {
  AIS_BASKET_JOURNALS,
  UNFILED as WEB_UNFILED,
  ALLOWED_PUBLICATION_TITLES,
} from '../web/src/lib/items.js';
import { JOURNAL_META } from '../src/services/journalMeta.js';
import { JOURNAL_META as WEB_JOURNAL_META } from '../web/src/lib/journal-meta.js';
import { normalizeCalibrationFields } from '../src/services/calibrateService.js';
import { mapRecognized } from '../src/services/metadataMapper.js';

// 11 journals, no HTML entities, no stray "Communications of the ACM".
test('backend JOURNAL_WHITELIST is the canonical 11 AIS basket journals', () => {
  assert.equal(JOURNAL_WHITELIST.length, 11);
  assert.ok(JOURNAL_WHITELIST.includes('Information and Organization'));
  assert.ok(JOURNAL_WHITELIST.includes('The Journal of Strategic Information Systems'));
  assert.ok(JOURNAL_WHITELIST.includes('Information & Management'));
  assert.ok(!JOURNAL_WHITELIST.includes('Communications of the ACM'));
  // No HTML entities anywhere.
  for (const j of JOURNAL_WHITELIST) {
    assert.ok(!j.includes('&amp;'), `journal name contains &amp;: ${j}`);
    assert.ok(!j.includes('&lt;'), `journal name contains &lt;: ${j}`);
  }
});

// Frontend copy must stay identical to the backend source of truth.
test('frontend AIS_BASKET_JOURNALS matches backend JOURNAL_WHITELIST', () => {
  assert.deepEqual(AIS_BASKET_JOURNALS, JOURNAL_WHITELIST);
  assert.equal(WEB_UNFILED, UNFILED);
  assert.deepEqual(ALLOWED_PUBLICATION_TITLES, [...JOURNAL_WHITELIST, UNFILED]);
});

test('journal meta covers the whitelist and stays in sync across frontend and backend', () => {
  assert.deepEqual(JOURNAL_META.map((j) => j.name), JOURNAL_WHITELIST);
  assert.deepEqual(WEB_JOURNAL_META, JOURNAL_META);
  for (const journal of JOURNAL_META) {
    assert.ok(journal.abbr, `missing abbr for ${journal.name}`);
    assert.ok(journal.publisher, `missing publisher for ${journal.name}`);
    assert.match(journal.homepage, /^https:\/\//, `homepage must be https for ${journal.name}`);
  }
});

test('classifyJournal maps whitelisted titles through and everything else to UNFILED', () => {
  assert.equal(classifyJournal('MIS Quarterly'), 'MIS Quarterly');
  assert.equal(classifyJournal('Information & Management'), 'Information & Management');
  assert.equal(classifyJournal('Information and Organization'), 'Information and Organization');
  // The HTML-entity form must NOT be treated as whitelisted — it should fall
  // to UNFILED. (Imports are decoded now; any lingering &amp; is bad data.)
  assert.equal(classifyJournal('Information &amp; Management'), UNFILED);
  assert.equal(classifyJournal('Communications of the ACM'), UNFILED);
  assert.equal(classifyJournal(''), UNFILED);
  assert.equal(classifyJournal(null), UNFILED);
  assert.equal(classifyJournal(undefined), UNFILED);
});

test('normalizeCalibrationFields enforces the AIS basket + DOI rules', () => {
  const allowedSet = new Set([
    'title', 'publicationTitle', 'DOI', 'date', 'abstractNote',
  ]);

  // 1. Suggested publicationTitle outside the basket -> reverted to current.
  const out1 = normalizeCalibrationFields(
    { fields: [{ field: 'publicationTitle', current: 'MIS Quarterly', suggested: 'Nature', status: 'incorrect', confidence: 0.9 }] },
    { allowedSet, doiMissing: false },
  );
  assert.equal(out1.length, 1);
  assert.equal(out1[0].suggested, 'MIS Quarterly');
  assert.equal(out1[0].status, 'correct');

  // 2. No DOI -> publicationTitle forced to UNFILED regardless of suggestion.
  const out2 = normalizeCalibrationFields(
    { fields: [{ field: 'publicationTitle', current: '', suggested: 'MIS Quarterly', status: 'missing', confidence: 0.8 }] },
    { allowedSet, doiMissing: true },
  );
  assert.equal(out2[0].suggested, UNFILED);
  assert.equal(out2[0].status, 'incorrect');

  // 3. No DOI + already UNFILED -> stays correct.
  const out3 = normalizeCalibrationFields(
    { fields: [{ field: 'publicationTitle', current: UNFILED, suggested: UNFILED, status: 'correct', confidence: 1 }] },
    { allowedSet, doiMissing: true },
  );
  assert.equal(out3[0].suggested, UNFILED);
  assert.equal(out3[0].status, 'correct');

  // 4. Field not in allowedSet is dropped (LLM must not invent field names).
  const out4 = normalizeCalibrationFields(
    { fields: [{ field: 'journal', current: '', suggested: 'MIS Quarterly', status: 'missing', confidence: 1 }] },
    { allowedSet, doiMissing: false },
  );
  assert.equal(out4.length, 0);

  // 5. Non-publicationTitle fields pass through untouched.
  const out5 = normalizeCalibrationFields(
    { fields: [{ field: 'date', current: '2020', suggested: '2021', status: 'incorrect', confidence: 0.7 }] },
    { allowedSet, doiMissing: false },
  );
  assert.equal(out5[0].suggested, '2021');

  // 6. Missing/empty parsed.fields -> [].
  assert.deepEqual(normalizeCalibrationFields({}, { allowedSet, doiMissing: false }), []);
  assert.deepEqual(normalizeCalibrationFields({ fields: null }, { allowedSet, doiMissing: false }), []);
});

test('mapRecognized decodes HTML entities from CrossRef container-title and title', () => {
  const recognized = {
    source: 'crossref',
    raw: {
      'container-title': ['Information &amp; Management'],
      'title': ['Foo &amp; Bar: A &lt;Study&gt;'],
      DOI: '10.1234/xyz',
      issued: { 'date-parts': [[2021]] },
    },
  };
  const mapped = mapRecognized(recognized);
  assert.equal(mapped.fields.publicationTitle, 'Information & Management');
  assert.equal(mapped.fields.title, 'Foo & Bar: A <Study>');
  // Canonical journal name now matches the whitelist (no &amp; leakage).
  assert.equal(classifyJournal(mapped.fields.publicationTitle), 'Information & Management');
});
