import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, type ReadStream } from 'node:fs';
import { link, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isValidStorageKey } from './file-signature.js';
import type {
  ObjectInfo,
  ObjectStorage,
  SignedRequest,
  UploadUrlOptions,
} from './object-storage.js';
import { signStorageToken, type StorageTokenClaims, verifyStorageToken } from './signed-token.js';

export class UploadTooLargeError extends Error {
  constructor() {
    super('Upload exceeds the allowed size.');
    this.name = 'UploadTooLargeError';
  }
}

/** The key already holds an object; uploads never overwrite. */
export class ObjectAlreadyExistsError extends Error {
  constructor() {
    super('Object already exists');
  }
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * Development/test adapter: objects live on local disk and are reachable
 * only through HMAC-signed, expiring URLs served by LocalStorageController.
 * It mirrors how a presigned S3 URL behaves (fixed Content-Type, size cap,
 * expiry) so the client flow is the same in every environment. Refused in
 * production by the env schema.
 */
export class LocalObjectStorage implements ObjectStorage {
  readonly driver = 'local';
  private readonly root: string;

  constructor(
    rootDir: string,
    private readonly publicBaseUrl: string,
    private readonly secret: Buffer,
  ) {
    this.root = resolve(rootDir);
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedRequest> {
    this.pathFor(key);
    const expiresAt = new Date(Date.now() + options.expiresInSeconds * 1000);
    const token = signStorageToken(this.secret, {
      key,
      op: 'put',
      exp: Math.floor(expiresAt.getTime() / 1000),
      ct: options.contentType,
      max: options.maxBytes,
    });
    return {
      url: this.urlFor(token),
      method: 'PUT',
      headers: { 'Content-Type': options.contentType },
      expiresAt,
    };
  }

  async createDownloadUrl(key: string, expiresInSeconds: number): Promise<SignedRequest> {
    this.pathFor(key);
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const token = signStorageToken(this.secret, {
      key,
      op: 'get',
      exp: Math.floor(expiresAt.getTime() / 1000),
    });
    return { url: this.urlFor(token), method: 'GET', headers: {}, expiresAt };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const path = this.pathFor(key);
    try {
      const info = await stat(path);
      const meta = await readFile(`${path}.meta.json`, 'utf8').catch(() => null);
      const contentType = meta ? (JSON.parse(meta) as { contentType?: string }).contentType : null;
      return { size: info.size, contentType: contentType ?? null };
    } catch {
      return null;
    }
  }

  async readPrefix(key: string, length: number): Promise<Buffer> {
    const handle = await open(this.pathFor(key), 'r');
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async sha256(key: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(this.pathFor(key)), hash);
    return hash.digest('hex');
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(`${path}.meta.json`, { force: true });
  }

  /** Claims of a URL this adapter signed, or null if forged or expired. */
  verifyToken(token: string): StorageTokenClaims | null {
    return verifyStorageToken(this.secret, token);
  }

  /** Streams an upload to disk, enforcing the size cap while reading. */
  async write(key: string, body: Readable, contentType: string, maxBytes: number): Promise<number> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${Date.now()}.part`;
    let size = 0;
    try {
      await pipeline(
        body,
        async function* (source: AsyncIterable<Buffer>) {
          for await (const chunk of source) {
            size += chunk.length;
            if (size > maxBytes) throw new UploadTooLargeError();
            yield chunk;
          }
        },
        createWriteStream(temp, { flags: 'wx' }),
      );
      // Write-once: link() fails if the object exists, so a still-valid
      // upload URL cannot swap a file after the server has inspected it.
      try {
        await link(temp, path);
      } catch (error) {
        if (isErrno(error, 'EEXIST')) throw new ObjectAlreadyExistsError();
        throw error;
      }
      await writeFile(`${path}.meta.json`, JSON.stringify({ contentType }));
      return size;
    } finally {
      await rm(temp, { force: true });
    }
  }

  read(key: string): ReadStream {
    return createReadStream(this.pathFor(key));
  }

  /** Resolves a key under the root; anything that escapes it is refused. */
  private pathFor(key: string): string {
    if (!isValidStorageKey(key)) throw new Error('Invalid storage key');
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return path;
  }

  private urlFor(token: string): string {
    return `${this.publicBaseUrl.replace(/\/+$/, '')}/api/v1/storage/local/${token}`;
  }
}
