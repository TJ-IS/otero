import { Client } from 'minio';
import { config } from '../config.js';

let _client = null;
let _bucketReady = false;

export function getMinioClient() {
  if (!_client) {
    const { endpoint, port, useSSL, accessKey, secretKey } = config.storage.minio;
    _client = new Client({ endPoint: endpoint, port, useSSL, accessKey, secretKey });
  }
  return _client;
}

export async function ensureBucket() {
  if (_bucketReady) return;
  const client = getMinioClient();
  const bucket = config.storage.minio.bucket;
  const exists = await client.bucketExists(bucket);
  if (!exists) await client.makeBucket(bucket);
  _bucketReady = true;
}

/** Upload a local file to MinIO. Returns the object etag. */
export async function uploadFile(localPath, objectName) {
  await ensureBucket();
  const client = getMinioClient();
  const result = await client.fPutObject(config.storage.minio.bucket, objectName, localPath, {});
  return result.etag;
}

/** Get a readable stream for an object. Throws if not found. */
export async function getObjectStream(objectName) {
  await ensureBucket();
  const client = getMinioClient();
  return client.getObject(config.storage.minio.bucket, objectName);
}

/** Check if an object exists. */
export async function objectExists(objectName) {
  try {
    const client = getMinioClient();
    await client.statObject(config.storage.minio.bucket, objectName);
    return true;
  } catch {
    return false;
  }
}

/** Delete an object (no-op if missing). */
export async function deleteObject(objectName) {
  try {
    const client = getMinioClient();
    await client.removeObject(config.storage.minio.bucket, objectName);
  } catch { /* ignore */ }
}

/**
 * List all object names under a prefix (non-recursive prefix scan).
 * Returns an array of object name strings.
 */
export async function listObjectNames(prefix) {
  const client = getMinioClient();
  const bucket = config.storage.minio.bucket;
  return new Promise((resolve, reject) => {
    const names = [];
    const stream = client.listObjectsV2(bucket, prefix, true);
    stream.on('data', obj => names.push(obj.name));
    stream.on('end', () => resolve(names));
    stream.on('error', reject);
  });
}

/**
 * Delete all objects whose name starts with prefix.
 */
export async function deleteObjectsWithPrefix(prefix) {
  const client = getMinioClient();
  const bucket = config.storage.minio.bucket;
  const names = await listObjectNames(prefix);
  if (names.length === 0) return;
  const objectsList = names.map(name => ({ name }));
  await client.removeObjects(bucket, objectsList);
}
