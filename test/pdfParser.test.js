import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractPdf } from '../src/services/pdfParser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.join(__dirname, 'fixtures', 'sample.pdf');

/**
 * Build a minimal, valid multi-page PDF. The checked-in sample.pdf has a single
 * page, so this lets us actually observe the `maxPages` limit. Object offsets
 * are computed while assembling the xref table.
 */
function buildPdf(pageTexts) {
  const objects = [];
  const pageCount = pageTexts.length;
  const kids = pageTexts.map((_, i) => `${3 + i} 0 R`).join(' ');
  const fontObj = 3 + pageCount;
  const firstContentObj = 4 + pageCount;

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`;
  for (let i = 0; i < pageCount; i++) {
    objects[3 + i] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
      + `/Contents ${firstContentObj + i} 0 R `
      + `/Resources << /Font << /F1 ${fontObj} 0 R >> >> >>`;
    const stream = `BT /F1 24 Tf 72 700 Td (${pageTexts[i]}) Tj ET`;
    objects[firstContentObj + i] = `<< /Length ${Buffer.byteLength(stream)} >>\n`
      + `stream\n${stream}\nendstream`;
  }
  objects[fontObj] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\n`
    + `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out);
}

function withTempPdf(pageTexts, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otero-pdf-test-'));
  const file = path.join(dir, 'synthetic.pdf');
  fs.writeFileSync(file, buildPdf(pageTexts));
  return Promise.resolve(fn(file)).finally(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

test('extractPdf returns Info metadata and first-page text for the sample PDF', async () => {
  const result = await extractPdf(SAMPLE_PDF);

  assert.deepEqual(Object.keys(result).sort(), ['firstPageText', 'info', 'numPages', 'pages']);
  assert.equal(result.numPages, 1);
  assert.equal(result.pages.length, 1);
  assert.deepEqual(result.pages[0], {
    page: 1,
    text: result.firstPageText,
  });
  assert.match(result.firstPageText, /Attention Is All You Need/);
  assert.match(result.firstPageText, /10\.5555\/3295222\.3295349/);

  assert.equal(result.info.title, 'Attention Is All You Need');
  // The DOI only appears in the body text; it is not present in the Info dict.
  assert.equal(result.info.doi, null);
  assert.equal(typeof result.info.raw, 'object');
});

test('extractPdf honours maxPages and clamps it to the page count', async () => {
  await withTempPdf(['Page one alpha', 'Page two beta', 'Page three gamma'], async (file) => {
    const defaulted = await extractPdf(file);
    assert.equal(defaulted.numPages, 3);
    assert.deepEqual(defaulted.pages.map(p => p.page), [1, 2, 3]);
    assert.deepEqual(defaulted.pages.map(p => p.text), [
      'Page one alpha',
      'Page two beta',
      'Page three gamma',
    ]);
    assert.equal(defaulted.firstPageText, 'Page one alpha');

    const single = await extractPdf(file, { maxPages: 1 });
    assert.equal(single.numPages, 3, 'numPages always reports the full document');
    assert.equal(single.pages.length, 1);
    assert.equal(single.pages[0].text, 'Page one alpha');
    assert.equal(single.firstPageText, 'Page one alpha');

    const clamped = await extractPdf(file, { maxPages: 99 });
    assert.equal(clamped.pages.length, 3);

    const none = await extractPdf(file, { maxPages: 0 });
    assert.equal(none.pages.length, 0);
    assert.equal(none.firstPageText, '');
  });
});

test('extractPdf rejects when the file does not exist', async () => {
  const missing = path.join(os.tmpdir(), `otero-missing-${Date.now()}.pdf`);
  await assert.rejects(extractPdf(missing), { code: 'ENOENT' });
});
