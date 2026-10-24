import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rewriteDoi,
  doisEqual,
  shouldOverwriteDate,
  shouldOverwriteTitle,
  shouldReplaceCreators,
  isPlaceholderAbstract,
  hasSubstantialAbstract,
  shouldOverwriteAbstract,
  isTestGarbage,
} from '../src/services/metadataRepairRules.js';

test('rewriteDoi fixes i.dss, commas, URL prefix, and 1.jais', () => {
  assert.equal(rewriteDoi('10.1016/i.dss.2012.05.033'), '10.1016/j.dss.2012.05.033');
  assert.equal(rewriteDoi('10.1016/i.dss,2011.10.006'), '10.1016/j.dss.2011.10.006');
  assert.equal(rewriteDoi('10.1016/i,dss.2008.07.004'), '10.1016/j.dss.2008.07.004');
  assert.equal(rewriteDoi('10.1016/i,dss,2010.07.013'), '10.1016/j.dss.2010.07.013');
  assert.equal(rewriteDoi('10.1016/i.im,2010.01.006'), '10.1016/j.im.2010.01.006');
  assert.equal(rewriteDoi('https://doi.org/10.2307/20650324'), '10.2307/20650324');
  assert.equal(rewriteDoi('10.17705/1.jais.00540'), '10.17705/1jais.00540');
  assert.equal(rewriteDoi('10.17005/1jais.00537'), '10.17705/1jais.00537');
});

test('rewriteDoi leaves already-correct DOIs unchanged', () => {
  assert.equal(rewriteDoi('10.1016/j.dss.2012.05.033'), '10.1016/j.dss.2012.05.033');
  assert.equal(rewriteDoi('10.17705/1jais.00364'), '10.17705/1jais.00364');
  assert.equal(rewriteDoi('10.2307/249564'), '10.2307/249564');
});

test('doisEqual is case-insensitive after rewrite', () => {
  assert.equal(doisEqual('https://doi.org/10.2307/20650324', '10.2307/20650324'), true);
  assert.equal(doisEqual('10.17705/1.jais.00540', '10.17705/1jais.00540'), true);
});

test('shouldOverwriteDate requires a 3-year gap or a non-YYYY stored date', () => {
  assert.equal(shouldOverwriteDate('1900', '1996'), true);
  assert.equal(shouldOverwriteDate('August 2006', '2006'), true);
  assert.equal(shouldOverwriteDate('2013', '2016'), true);
  assert.equal(shouldOverwriteDate('2024', '2023'), false);
  assert.equal(shouldOverwriteDate('2014', '2014'), false);
  assert.equal(shouldOverwriteDate('', '2014'), true);
  assert.equal(shouldOverwriteDate('1999', ''), false);
});

test('shouldOverwriteTitle only for template or mojibake', () => {
  assert.equal(shouldOverwriteTitle('JAIS Author Template'), true);
  assert.equal(shouldOverwriteTitle('Multihoming Usersâ•Ž Preferences'), true);
  assert.equal(shouldOverwriteTitle('Computer-Based Monitoring'), false);
});

test('shouldReplaceCreators detects empty, Wiley names, and-prefix, and fragments', () => {
  assert.equal(shouldReplaceCreators([]), true);
  assert.equal(shouldReplaceCreators([{ firstName: '', lastName: 'Jene' }]), true);
  assert.equal(shouldReplaceCreators([{ firstName: 'wendy', lastName: '' }]), false);
  assert.equal(shouldReplaceCreators([{ firstName: '', lastName: 'wendy' }]), true);
  assert.equal(
    shouldReplaceCreators([{ firstName: 'and Jonathan D.', lastName: 'Wareham' }]),
    true,
  );
  assert.equal(shouldReplaceCreators([{ firstName: '', lastName: 'and' }]), true);
  assert.equal(shouldReplaceCreators([{ firstName: '', lastName: 'Jr.' }]), true);
  assert.equal(shouldReplaceCreators([{ firstName: '', lastName: '' }]), true);
  assert.equal(shouldReplaceCreators([{ firstName: '', lastName: 'Recker' }]), true);
  assert.equal(shouldReplaceCreators([{ firstName: 'Viswanath', lastName: 'Venkatesh' }]), false);
  assert.equal(
    shouldReplaceCreators([
      { firstName: 'Joey F.', lastName: 'George' },
      { firstName: 'and Duncan', lastName: 'Copeland' },
    ]),
    true,
  );
});

test('isPlaceholderAbstract covers labels, empty jats, and citation strings', () => {
  assert.equal(isPlaceholderAbstract(''), true);
  assert.equal(isPlaceholderAbstract('Research Article'), true);
  assert.equal(isPlaceholderAbstract('Research Note'), true);
  assert.equal(isPlaceholderAbstract('<jats:p/>'), true);
  assert.equal(
    isPlaceholderAbstract(
      'Decision Support Systems, Corrected proof, doi:10.1016/j.dss.2018.08.002',
    ),
    true,
  );
  assert.equal(
    isPlaceholderAbstract(
      'This paper develops a theory of online trust based on a longitudinal field study of virtual teams.',
    ),
    false,
  );
});

test('hasSubstantialAbstract rejects placeholders even when Crossref wraps them', () => {
  assert.equal(hasSubstantialAbstract('<jats:p> Spotlight </jats:p>'), false);
  assert.equal(hasSubstantialAbstract('A'.repeat(90)), true);
});

test('shouldOverwriteAbstract never backfills empty abstracts unless allowEmpty', () => {
  const real =
    'This paper develops a theory of online trust based on a longitudinal field study of virtual teams.';
  assert.equal(shouldOverwriteAbstract('', real), false);
  assert.equal(shouldOverwriteAbstract('', real, { allowEmpty: true }), true);
  assert.equal(shouldOverwriteAbstract('Research Article', real), true);
  assert.equal(
    shouldOverwriteAbstract(real, 'Another substantial abstract from Crossref about methods.'),
    false,
  );
  assert.equal(shouldOverwriteAbstract('Research Note', 'Spotlight'), false);
});

test('isTestGarbage requires no DOI plus title token or 209x date', () => {
  assert.equal(
    isTestGarbage({ title: 'Paper 1 t1785517356628-i2dfm', date: '2099-01-01', doi: '' }),
    true,
  );
  assert.equal(
    isTestGarbage({ title: 'MISQ 2098 t1785517406667-0cp0e', date: 'Spring 2098', doi: '' }),
    true,
  );
  assert.equal(
    isTestGarbage({ title: 'Computer-Based Monitoring', date: '1996', doi: '10.2307/249564' }),
    false,
  );
  assert.equal(
    isTestGarbage({
      title: 'Paper 1 t1785517356628-i2dfm',
      date: '2099-01-01',
      doi: '10.2307/249564',
    }),
    false,
  );
});
