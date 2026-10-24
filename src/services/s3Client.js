import { Client } from 'minio';
import { config } from '../config.js';

let _client = null;
let _bucketReady = false;

/**
 * S3-compatible client (Cloudflare R2, AWS S3, local MinIO, etc.).
 * R2 requires region "auto"; buckets are usually pre-created in the dashboard.
 */
export function getS3Client() {
  if (!_client) {
    const { endpoint, port, useSSL, accessKey, secretKey, region } = config.storage.s3;
    _client = new Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
      // Cloudflare R2 signing expects "auto"; harmless for other S3 APIs.
      region: region || 'auto',
    });
  }
  return _client;
}

/**
 * Ensure the configured bucket is usable.
 * On R2 (and most hosted S3), do not auto-create — only verify access.
 */
export async function ensureBucket() {
  if (_bucketReady) return;
  const client = getS3Client();
  const { bucket, createBucket } = config.storage.s3;
  const exists = await client.bucketExists(bucket);
  if (!exists) {
    if (!createBucket) {
      throw new Error(
        `S3 bucket "${bucket}" not found at ${config.storage.s3.endpoint}. ` +
          `Create it in the provider console, or set S3_CREATE_BUCKET=true for local bootstrap.`,
      );
    }
    await client.makeBucket(bucket, config.storage.s3.region || 'auto');
  }
  _bucketReady = true;
}

/** Upload a local file. Returns the object etag. */
export async function uploadFile(localPath, objectName) {
  await ensureBucket();
  const client = getS3Client();
  const result = await client.fPutObject(config.storage.s3.bucket, objectName, localPath, {});
  return result.etag;
}

/** Get a readable stream for an object. Throws if not found. */
export async function getObjectStream(objectName) {
  await ensureBucket();
  const client = getS3Client();
  return client.getObject(config.storage.s3.bucket, objectName);
}

/** Check if an object exists. */
export async function objectExists(objectName) {
  try {
    const client = getS3Client();
    await client.statObject(config.storage.s3.bucket, objectName);
    return true;
  } catch {
    return false;
  }
}

/** Delete an object (no-op if missing). */
export async function deleteObject(objectName) {
  try {
    const client = getS3Client();
    await client.removeObject(config.storage.s3.bucket, objectName);
  } catch {
    /* ignore */
  }
}

/**
 * List all object names under a prefix (recursive).
 * Returns an array of object name strings.
 */
export async function listObjectNames(prefix) {
  const client = getS3Client();
  const bucket = config.storage.s3.bucket;
  return new Promise((resolve, reject) => {
    const names = [];
    const stream = client.listObjectsV2(bucket, prefix, true);
    stream.on('data', (obj) => names.push(obj.name));
    stream.on('end', () => resolve(names));
    stream.on('error', reject);
  });
}

/**
 * Delete all objects whose name starts with prefix.
 */
export async function deleteObjectsWithPrefix(prefix) {
  const client = getS3Client();
  const bucket = config.storage.s3.bucket;
  const names = await listObjectNames(prefix);
  if (names.length === 0) return;
  const objectsList = names.map((name) => ({ name }));
  await client.removeObjects(bucket, objectsList);
}
