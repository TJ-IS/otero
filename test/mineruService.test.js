import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import {
  submitLocalPdf,
  submitLocalPdfs,
  rewriteAssetPaths,
} from '../src/services/mineruService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_PDF = path.join(__dirname, 'fixtures', 'sample.pdf');

const originalFetch = globalThis.fetch;
const originalTokens = config.mineru.tokens;
const originalToken = config.mineru.token;

before(() => {
  // A token is required by withTokenRotation; no request leaves the machine.
  config.mineru.tokens = ['test-token'];
  config.mineru.token = 'test-token';
});

after(() => {
  config.mineru.tokens = originalTokens;
  config.mineru.token = originalToken;
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function textResponse(status, body = '') {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

/** Drain a web ReadableStream request body so no file handle stays open. */
async function drainBody(init) {
  const body = init?.body;
  if (!body || typeof body.getReader !== 'function') return;
  const reader = body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(calls, url, init);
  };
  return calls;
}

test('submitLocalPdf submits, uploads to the signed URL, and returns the batch id', async () => {
  const calls = mockFetch(async (all, url, init) => {
    await drainBody(init);
    if (all.length === 1) {
      return jsonResponse({
        code: 0,
        data: {
          batch_id: 'batch-123',
          file_urls: ['https://oss.example.test/upload/abc?sig=xyz'],
        },
      });
    }
    return textResponse(200, '');
  });

  const result = await submitLocalPdf({ filePath: SAMPLE_PDF, fileName: 'ITEMKEY.pdf' });
  assert.deepEqual(result, { batchId: 'batch-123' });

  assert.equal(calls.length, 2);
  const [submit, upload] = calls;

  assert.equal(submit.url, 'https://mineru.net/api/v4/file-urls/batch');
  assert.equal(submit.init.method, 'POST');
  assert.equal(submit.init.headers.Authorization, 'Bearer test-token');
  assert.equal(submit.init.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(submit.init.body);
  assert.deepEqual(sent.files, [{ name: 'ITEMKEY.pdf' }]);

  assert.equal(upload.url, 'https://oss.example.test/upload/abc?sig=xyz');
  assert.equal(upload.init.method, 'PUT');
  assert.equal(upload.init.headers['Content-Length'], String(fs.statSync(SAMPLE_PDF).size));
});

test('submitLocalPdf throws with status and mineruCode when the API rejects the batch', async () => {
  let callCount = 0;
  mockFetch(async () => {
    callCount++;
    return jsonResponse({ code: -60012, msg: 'task not found' });
  });

  await assert.rejects(
    submitLocalPdf({ filePath: SAMPLE_PDF, fileName: 'ITEMKEY.pdf' }),
    (err) => {
      assert.match(err.message, /MinerU submit failed/);
      assert.equal(err.status, 200);
      assert.equal(err.mineruCode, -60012);
      return true;
    },
  );
  assert.equal(callCount, 1, 'a rejected batch must not attempt the upload');
});

test('submitLocalPdf propagates a non-2xx HTTP status', async () => {
  mockFetch(async () => jsonResponse({}, 429));

  await assert.rejects(
    submitLocalPdf({ filePath: SAMPLE_PDF, fileName: 'ITEMKEY.pdf' }),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.mineruCode, null);
      return true;
    },
  );
});

test('submitLocalPdf throws when the signed-URL upload fails', async () => {
  const calls = mockFetch(async (all, _url, init) => {
    await drainBody(init);
    if (all.length === 1) {
      return jsonResponse({
        code: 0,
        data: { batch_id: 'batch-fail', file_urls: ['https://oss.example.test/denied'] },
      });
    }
    return textResponse(403, 'access denied');
  });

  await assert.rejects(
    submitLocalPdf({ filePath: SAMPLE_PDF, fileName: 'ITEMKEY.pdf' }),
    /MinerU OSS upload failed: HTTP 403 access denied/,
  );
  assert.equal(calls.length, 2);
});

test('submitLocalPdf throws when the API returns no upload URL', async () => {
  mockFetch(async () => jsonResponse({ code: 0, data: { batch_id: 'batch-empty', file_urls: [] } }));

  await assert.rejects(
    submitLocalPdf({ filePath: SAMPLE_PDF, fileName: 'ITEMKEY.pdf' }),
    /MinerU returned no upload url/,
  );
});

test('submitLocalPdfs validates batch size before touching the network', async () => {
  const calls = mockFetch(async () => {
    throw new Error('fetch must not be called');
  });

  await assert.rejects(submitLocalPdfs([]), /no files/);
  const tooMany = Array.from({ length: 201 }, (_, i) => ({
    filePath: SAMPLE_PDF,
    fileName: `f${i}.pdf`,
  }));
  await assert.rejects(submitLocalPdfs(tooMany), /exceeds the 200-file batch limit/);
  assert.equal(calls.length, 0);
});

test('rewriteAssetPaths rewrites markdown and HTML image references', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'otero-rewrite-'));
  const file = path.join(dir, 'full.md');
  fs.writeFileSync(file, [
    '![figure](images/fig1.png)',
    '![spaced](images/sub dir/fig 2.png)',
    '<img class="x" src="images/fig3.png">',
    '![remote](https://example.test/fig4.png)',
  ].join('\n'));

  try {
    await rewriteAssetPaths(file, 'ITEM123');
    const md = fs.readFileSync(file, 'utf8');

    assert.match(md, /!\[figure\]\(\/api\/attachments\/ITEM123\/fulltext\/images\/fig1\.png\)/);
    assert.match(md, /!\[spaced\]\(\/api\/attachments\/ITEM123\/fulltext\/images\/sub%20dir\/fig%202\.png\)/);
    assert.match(md, /<img class="x" src="\/api\/attachments\/ITEM123\/fulltext\/images\/fig3\.png">/);
    assert.match(md, /!\[remote\]\(https:\/\/example\.test\/fig4\.png\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
