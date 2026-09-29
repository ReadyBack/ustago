/**
 * Port for private object storage (docs/adr/0011). Verification documents
 * never go into PostgreSQL and are never public: clients upload with a
 * short-lived signed PUT URL and admins read with a short-lived signed GET
 * URL. An S3-compatible adapter (AWS S3, Cloudflare R2, MinIO) implements
 * the same interface with presigned URLs.
 */
export interface ObjectStorage {
  readonly driver: string;
  createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedRequest>;
  createDownloadUrl(key: string, expiresInSeconds: number): Promise<SignedRequest>;
  /** Null when the object does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** First `length` bytes of the object, for magic-byte checks. */
  readPrefix(key: string, length: number): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface UploadUrlOptions {
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}

export interface SignedRequest {
  url: string;
  method: 'PUT' | 'GET';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  contentType: string | null;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export class StorageUnavailableError extends Error {
  constructor() {
    super('Object storage is disabled.');
    this.name = 'StorageUnavailableError';
  }
}
