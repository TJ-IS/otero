import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMineruTokens } from '../src/config.js';

test('parseMineruTokens collects primary, numbered, and list vars without duplicates', () => {
  const tokens = parseMineruTokens({
    OTERO_MINERU_TOKEN: ' tok-a ',
    OTERO_MINERU_TOKENS: 'tok-b, tok-c;tok-a',
    OTERO_MINERU_TOKEN_2: '"tok-d"',
    OTERO_MINERU_TOKEN_10: 'tok-e',
    OTERO_MINERU_TOKEN_3: 'tok-f',
    OTERO_MINERU_MODEL: 'vlm',
  });
  assert.deepEqual(tokens, ['tok-a', 'tok-b', 'tok-c', 'tok-d', 'tok-f', 'tok-e']);
});

test('parseMineruTokens ignores empty values', () => {
  assert.deepEqual(parseMineruTokens({}), []);
  assert.deepEqual(
    parseMineruTokens({
      OTERO_MINERU_TOKEN: '',
      OTERO_MINERU_TOKENS: '  , ; ',
      OTERO_MINERU_TOKEN_2: '""',
    }),
    [],
  );
});
