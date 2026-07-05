import fs from 'node:fs';
import path from 'node:path';
import { extractPdf } from './src/services/pdfParser.js';
import { recognize } from './src/services/recognizers/index.js';
import { mapRecognized } from './src/services/metadataMapper.js';

const PDF_DIR = '/mnt/data_sda1/pdfs';

async function previewOne(filePath) {
  const fileName = path.basename(filePath);
  try {
    const extraction = await extractPdf(filePath, { maxPages: 1 });
    const recognized = await recognize(extraction);
    const mapped = mapRecognized(recognized);
    return {
      file: fileName,
      ok: true,
      source: recognized.source,
      itemType: mapped.itemType,
      title: mapped.fields.title || '(no title)',
      creators: mapped.creators.map(c => [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '').filter(Boolean).join('; ') || '(no authors)',
      doi: mapped.fields.DOI || mapped.fields.ISBN || mapped.fields.arXivID || '',
      year: mapped.fields.date || '',
    };
  } catch (err) {
    return { file: fileName, ok: false, error: err.message };
  }
}

async function main() {
  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  console.log(`Total PDFs: ${files.length}\n`);

  // Preview first N files
  const N = Math.min(100, files.length);
  const batch = files.slice(0, N);

  console.log('Processing...');
  const results = [];
  for (let i = 0; i < batch.length; i++) {
    const f = batch[i];
    process.stdout.write(`\r  [${i + 1}/${batch.length}] ${f.substring(0, 36)}`);
    const r = await previewOne(path.join(PDF_DIR, f));
    results.push(r);
  }
  console.log('\n');

  // Summary stats
  const ok = results.filter(r => r.ok);
  const fail = results.filter(r => !r.ok);
  const sources = {};
  for (const r of ok) {
    sources[r.source] = (sources[r.source] || 0) + 1;
  }

  console.log('=== Summary ===');
  console.log(`  Total: ${results.length}`);
  console.log(`  OK:    ${ok.length}`);
  console.log(`  Fail:  ${fail.length}`);
  console.log(`\nRecognition sources:`);
  for (const [src, cnt] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${cnt}`);
  }

  console.log(`\n=== Sample Results (${ok.length} OK) ===`);
  console.log('File\tSource\tType\tTitle\tAuthors\tDOI/ISBN\tYear');
  for (const r of ok.slice(0, 50)) {
    const title = r.title.length > 60 ? r.title.substring(0, 57) + '...' : r.title;
    const authors = r.creators.length > 40 ? r.creators.substring(0, 37) + '...' : r.creators;
    console.log(`${r.file}\t${r.source}\t${r.itemType}\t${title}\t${authors}\t${r.doi}\t${r.year}`);
  }

  if (fail.length > 0) {
    console.log(`\n=== Failures (${fail.length}) ===`);
    for (const r of fail) {
      console.log(`${r.file}\t${r.error}`);
    }
  }
}

main().catch(console.error);
