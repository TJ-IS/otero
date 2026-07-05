import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey, isValidKey } from '../src/utils/key.js';
import { extractDoi, normalizeDoi, isDoi } from '../src/utils/doi.js';
import { isValidIsbn, toIsbn13, formatIsbn, extractIsbn, cleanIsbn } from '../src/utils/isbn.js';

test('generateKey produces 8-char uppercase keys', () => {
  for (let i = 0; i < 50; i++) {
    const k = generateKey();
    assert.equal(k.length, 8);
    assert.ok(isValidKey(k));
  }
});

test('extractDoi finds DOI in text and strips URL prefix / trailing punctuation', () => {
  assert.equal(extractDoi('see https://doi.org/10.1000/xyz123 for more.'), '10.1000/xyz123');
  assert.equal(extractDoi('see 10.5555/3295222.3295349.'), '10.5555/3295222.3295349');
  assert.equal(extractDoi('no doi here'), null);
  assert.equal(normalizeDoi('https://dx.doi.org/10.1000/xyz),'), '10.1000/xyz');
  assert.ok(isDoi('10.1000/xyz123'));
  assert.ok(!isDoi('not-a-doi'));
});

test('ISBN validation and conversion', () => {
  // Real ISBN-10 -> ISBN-13
  assert.ok(isValidIsbn('0306406152'));
  assert.equal(toIsbn13('0306406152'), '9780306406157');
  assert.ok(isValidIsbn('9780306406157'));
  assert.equal(cleanIsbn('978-3-16-148410-0'), '9783161484100');
  assert.ok(isValidIsbn('9783161484100'));
});

test('extractIsbn handles hyphens and mixed text', () => {
  assert.equal(extractIsbn('ISBN: 978-3-16-148410-0'), '9783161484100');
  assert.equal(extractIsbn('isbn 0306406152.'), '9780306406157');
  assert.equal(extractIsbn('no isbn here'), null);
});

test('formatIsbn produces standard hyphen groups', () => {
  const f = formatIsbn('9783161484100');
  assert.ok(f.includes('-'));
  assert.ok(f.startsWith('978-'));
});
