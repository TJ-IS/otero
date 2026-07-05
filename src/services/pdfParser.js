import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// In Node, point pdfjs at the worker entry file on disk. The legacy build is
// used because the modern build assumes browser APIs.
const require = createRequire(import.meta.url);
pdfjs.GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

/**
 * Extract embedded Info-dict metadata and the first N pages of text from a PDF.
 * @param {string} filePath absolute path to the PDF on disk
 * @param {object} opts
 * @param {number} opts.maxPages max number of pages to extract text from (default 3)
 * @returns {Promise<{info: object, firstPageText: string, pages: Array<{page:number,text:string}>, numPages: number}>}
 */
export async function extractPdf(filePath, { maxPages = 3 } = {}) {
  const buf = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data: buf,
    isFullLoaded: true,
    useSystemFonts: true,
  }).promise;

  let info = {};
  try {
    // pdfjs exposes the Info dictionary via getMetadata().
    const meta = await doc.getMetadata();
    info = {
      title: meta?.info?.Title ?? null,
      author: meta?.info?.Author ?? null,
      subject: meta?.info?.Subject ?? null,
      keywords: meta?.info?.Keywords ?? null,
      creator: meta?.info?.Creator ?? null,
      producer: meta?.info?.Producer ?? null,
      creationDate: meta?.info?.CreationDate ?? null,
      modDate: meta?.info?.ModDate ?? null,
      doi: meta?.info?.DOI ?? meta?.info?.doi ?? null,
      isbn: meta?.info?.ISBN ?? meta?.info?.isbn ?? null,
      raw: meta?.info ?? {},
    };
  } catch {
    // ignore metadata errors
  }

  const numPages = doc.numPages;
  const limit = Math.min(maxPages, numPages);
  const pages = [];
  let firstPageText = '';
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
    pages.push({ page: i, text });
    if (i === 1) firstPageText = text;
  }

  try { await doc.destroy(); } catch { /* ignore */ }

  return { info, firstPageText, pages, numPages };
}
