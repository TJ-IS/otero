import fs from 'node:fs';
import path from 'node:path';

// Override config to be polite to APIs
import { config } from './src/config.js';
config.recognizers.timeoutMs = 10000;
config.recognizers.crossref = 'https://api.crossref.org/works/';
config.recognizers.userAgent = 'Otero/0.1 (mailto:otero@example.com)';

const { extractPdf } = await import('./src/services/pdfParser.js');
const { recognize } = await import('./src/services/recognizers/index.js');
const { mapRecognized } = await import('./src/services/metadataMapper.js');

const PDF_DIR = '/mnt/data_sda1/pdfs';
const OUT_CSV = '/mnt/data_sda1/pdfs_metadata.csv';
const CONCURRENCY = 8;

let processed = 0, ok = 0, fail = 0;
const sources = {};
const startTime = Date.now();

function escapeCsv(s) {
  if (s == null) return '';
  s = String(s).replace(/"/g, '""');
  return `"${s}"`;
}

function statusLine() {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const srcInfo = Object.entries(sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
  return `  ${processed} done (ok:${ok} fail:${fail}) elapsed:${elapsed}s ${srcInfo}`;
}

async function processOne(filePath) {
  const fileName = path.basename(filePath);
  try {
    const extraction = await extractPdf(filePath, { maxPages: 1 });
    const recognized = await recognize(extraction);
    const mapped = mapRecognized(recognized);

    const authors = mapped.creators.map(c =>
      [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || ''
    ).filter(Boolean).join('; ');

    const doi = mapped.fields.DOI || mapped.fields.ISBN || mapped.fields.arXivID || '';
    const extra = recognized.source === 'crossref' && recognized.raw?.URL ? recognized.raw.URL : '';
    const pubTitle = mapped.fields.publicationTitle || '';
    const publisher = mapped.fields.publisher || '';

    return {
      file: fileName,
      source: recognized.source,
      itemType: mapped.itemType,
      title: mapped.fields.title || '',
      authors,
      doi,
      year: mapped.fields.date || '',
      publicationTitle: pubTitle,
      publisher,
      url: extra,
    };
  } catch (err) {
    return { file: fileName, source: 'error', itemType: '', title: '', authors: '', doi: '', year: '', publicationTitle: '', publisher: '', url: '', error: err.message };
  }
}

async function main() {
  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  const total = files.length;

  // Write CSV header
  const header = 'file,source,itemType,title,authors,doi,year,publicationTitle,publisher,url,error\n';
  fs.writeFileSync(OUT_CSV, header);

  console.log(`Total PDFs: ${total}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('');

  // Process in batches
  for (let i = 0; i < total; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const promises = batch.map(f => processOne(path.join(PDF_DIR, f)));
    const results = await Promise.all(promises);

    for (const r of results) {
      processed++;
      if (r.source === 'error') {
        fail++;
      } else {
        ok++;
        sources[r.source] = (sources[r.source] || 0) + 1;
      }

      const line = [
        escapeCsv(r.file), escapeCsv(r.source), escapeCsv(r.itemType),
        escapeCsv(r.title), escapeCsv(r.authors), escapeCsv(r.doi),
        escapeCsv(r.year), escapeCsv(r.publicationTitle), escapeCsv(r.publisher),
        escapeCsv(r.url), escapeCsv(r.error || '')
      ].join(',') + '\n';
      fs.appendFileSync(OUT_CSV, line);
    }

    process.stdout.write('\r' + statusLine());
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n\n=== Done ===');
  console.log(`  Total: ${processed}`);
  console.log(`  OK:    ${ok}`);
  console.log(`  Fail:  ${fail}`);
  console.log(`  Time:  ${elapsed}s`);
  console.log(`  Avg:   ${(elapsed / processed).toFixed(2)}s/file`);
  console.log(`\nSources:`);
  for (const [src, cnt] of Object.entries(sources).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${cnt} (${(cnt / ok * 100).toFixed(1)}%)`);
  }
  console.log(`\nOutput: ${OUT_CSV}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
