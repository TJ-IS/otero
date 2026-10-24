import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { importPdf } from '../../services/importService.js';

export const importRouter = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(os.tmpdir(), 'otero-uploads');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const suffix = path.extname(file.originalname) || '.pdf';
      cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${suffix}`);
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
});

// POST /api/import/pdf  (multipart: field "pdf" = file)
importRouter.post('/pdf', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'pdf file required (field name: "pdf")' });
  try {
    const r = await importPdf(req.file.path, { skipRecognize: false });
    res.status(201).json({
      attachment: r.attachment.toJSON(),
      parent: r.parent?.toJSON() ?? null,
      recognizedSource: r.recognized?.source ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    // Clean up the multer temp file; the file has been copied into our storage.
    try {
      fs.unlinkSync(req.file.path);
    } catch {
      /* ignore */
    }
  }
});
