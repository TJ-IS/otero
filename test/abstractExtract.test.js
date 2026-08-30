import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  unsqueezeSpacedLetters,
  isAbstractHeading,
  extractAbstractFromMarkdown,
  extractAbstractFromBlocks,
  extractAbstractFromPlain,
  polishAbstract,
  isAcceptableExtract,
} from '../src/services/abstractExtractRules.js';

test('unsqueezeSpacedLetters joins Elsevier abstract headings', () => {
  assert.equal(unsqueezeSpacedLetters('A B S T R A C T'), 'ABSTRACT');
  assert.equal(unsqueezeSpacedLetters('a b s t r a c t'), 'abstract');
});

test('isAbstractHeading accepts spaced and plain labels', () => {
  assert.equal(isAbstractHeading('Abstract'), true);
  assert.equal(isAbstractHeading('ABSTRACT'), true);
  assert.equal(isAbstractHeading('A B S T R A C T'), true);
  assert.equal(isAbstractHeading('a b s t r a c t'), true);
  assert.equal(isAbstractHeading('Introduction'), false);
});

const DSS_MD = `# Short Term and Total Life Impact analysis

## Abstract

This paper develops a methodology for analyzing and predicting the impact category of malicious code, particularly email worms. The current paper develops two frameworks to classify email worms based on their detrimental impact.

Keywords: Email worms; Detrimental impact
`;

const IM_MD = `# Relation of CIO background

## A B S T R A C T

The literature of the past three decades has not provided a consistent picture of payback for IT investment. Firm strategies and infrastructure play a part in determining return on investment and, in recent years, chief information officer characteristics have been cited as essential factors.

## 1. Introduction
`;

const JMIS_MD = `# Using Perspective-Taking

To cite this article: Hyung Koo Lee, Jong Seok Lee & Mark Keil (2018) Using Perspective-Taking to De-escalate Launch Date Commitment, Journal of Management Information Systems, 35:4, 1251-1276

HYUNG KOO LEE is an Assistant Professor in the Department of Information Technologies at HEC Montréal. He received his Ph.D. in Computer Information Systems from Georgia State University.
`;

test('extractAbstractFromMarkdown stops at Keywords or Introduction', () => {
  const dss = extractAbstractFromMarkdown(DSS_MD);
  assert.ok(dss.includes('methodology for analyzing'));
  assert.ok(!dss.includes('Keywords'));
  const im = extractAbstractFromMarkdown(IM_MD);
  assert.ok(im.includes('payback for IT investment'));
  assert.ok(!im.includes('Introduction'));
});

test('extractAbstractFromMarkdown returns null for T&F cover pages', () => {
  assert.equal(extractAbstractFromMarkdown(JMIS_MD), null);
});

test('extractAbstractFromBlocks uses text_level headings', () => {
  const blocks = [
    { type: 'text', text_level: 1, text: 'Title here', page_idx: 0 },
    { type: 'text', text_level: 2, text: 'Abstract', page_idx: 0 },
    { type: 'text', text: 'This paper develops a methodology for analyzing and predicting the impact category of malicious code, particularly email worms, using two frameworks that classify worms by detrimental impact over the short term and the total life cycle.', page_idx: 0 },
    { type: 'text', text_level: 2, text: 'Keywords', page_idx: 0 },
    { type: 'text', text: 'Email worms', page_idx: 0 },
  ];
  const abs = extractAbstractFromBlocks(blocks);
  assert.ok(abs.includes('methodology for analyzing'));
  assert.ok(!abs.includes('Email worms'));
});

test('extractAbstractFromPlain finds letter-spaced ABSTRACT in flattened text', () => {
  const plain = 'Relation of CIO background A R T I C L E I N F O Keywords: CIO A B S T R A C T The literature of the past three decades has not provided a consistent picture of payback for IT investment. Firm strategies and infrastructure play a part in determining return on investment in recent years. 1. Introduction Numerous facets of IT have been examined.';
  const abs = extractAbstractFromPlain(plain);
  assert.ok(abs);
  assert.ok(abs.includes('payback for IT investment'));
  assert.ok(!abs.includes('Introduction'));
});

test('polishAbstract joins MinerU ligatures and drops Elsevier footer', () => {
  const raw = 'This paper studies classi fi cation and signi fi cant effects. © 2009 Elsevier B.V. All rights reserved.';
  assert.equal(polishAbstract(raw), 'This paper studies classification and significant effects.');
});

test('isAcceptableExtract rejects mid-sentence and incomplete endings', () => {
  const good = 'This paper develops a methodology for analyzing email worms and predicting their impact over the short term and the total life cycle of the infection. Two frameworks classify worms by detrimental impact and are validated statistically and practically against a corpus of observed outbreaks.';
  assert.equal(isAcceptableExtract(good), true);
  assert.equal(isAcceptableExtract('of articles on distance effect in online contexts. Study Distance measure Context'), false);
  assert.equal(isAcceptableExtract('This paper develops a methodology for analyzing email worms and predicting'), false);
});
