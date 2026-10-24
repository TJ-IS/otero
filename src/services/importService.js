import path from 'node:path';
import fs from 'node:fs';
import { Item } from '../models/Item.js';
import { Attachment } from '../models/Attachment.js';
import { generateKey } from '../utils/key.js';
import { storeFile, downloadToTemp } from './storageService.js';
import { extractPdf } from './pdfParser.js';
import { recognize } from './recognizers/index.js';
import { mapRecognized } from './metadataMapper.js';
import { execute } from '../db/connection.js';

/**
 * Import a PDF file:
 *   1. Store the file under a fresh key.
 *   2. Create an attachment Item referring to the stored file.
 *   3. Extract PDF Info + first-page text from the stored file.
 *   4. Run recognizers (arXiv → DOI → ISBN → fallback).
 *   5. Map the recognizer output to Item fields.
 *   6. Create a parent Item (the actual paper) and link the attachment to it.
 *
 * @param {string} pdfPath absolute or relative path to PDF on disk
 * @param {object} opts
 * @param {boolean} opts.skipRecognize if true, only create the attachment (no parent)
 * @returns {Promise<{attachment: Attachment, parent: Item|null, recognized: object|null, mapped: object|null}>}
 */
export async function importPdf(pdfPath, opts = {}) {
  const absSource = path.isAbsolute(pdfPath) ? pdfPath : path.resolve(pdfPath);

  // 1. Store the file under a freshly generated key.
  const fileKey = generateKey();
  const stored = await storeFile(absSource, fileKey, { ext: 'pdf' });

  // 2. Create the attachment Item (no parent yet).
  const attachment = new Attachment({
    linkMode: 0,
    contentType: 'application/pdf',
    path: stored.path,
    md5: stored.md5,
    mtime: stored.mtime,
  });
  await attachment.save();

  if (opts.skipRecognize) {
    return { attachment, parent: null, recognized: null, mapped: null };
  }

  // 3. Extract text/metadata. In MinIO mode, the source file may be gone after
  //    storeFile, so we extract from the original source path instead.
  const extractPath = fs.existsSync(absSource) ? absSource : await downloadToTemp(stored.path);
  const needsCleanup = extractPath !== absSource;
  let extraction;
  try {
    extraction = await extractPdf(extractPath, { maxPages: 3 });
  } finally {
    if (needsCleanup)
      try {
        fs.unlinkSync(extractPath);
      } catch {
        /* ignore */
      }
  }

  // 4. Recognize.
  const recognized = await recognize(extraction);

  // 5. Map to Item fields.
  const mapped = mapRecognized(recognized);

  // 6. Create the parent Item and link the attachment to it.
  const parent = new Item();
  await parent.setItemType(mapped.itemType);
  for (const [name, value] of Object.entries(mapped.fields)) {
    if (value === null || value === undefined || value === '') continue;
    try {
      parent.setField(name, value);
    } catch {
      /* field not in schema or not allowed for this type — skip */
    }
  }
  for (const c of mapped.creators) parent.addCreator(c);
  await parent.save();

  await execute('UPDATE items SET "parentItemID"=$1 WHERE "itemID"=$2', [parent.id, attachment.id]);
  await execute('UPDATE "itemAttachments" SET "parentItemID"=$1 WHERE "itemID"=$2', [
    parent.id,
    attachment.id,
  ]);

  return { attachment, parent, recognized, mapped };
}
