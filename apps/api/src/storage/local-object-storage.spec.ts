import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import {
  LocalObjectStorage,
  ObjectAlreadyExistsError,
  UploadTooLargeError,
} from './local-object-storage.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const KEY =
  'verifications/0190a000-0000-7000-8000-000000000001/0190a000-0000-7000-8000-000000000002.png';

function storage() {
  const dir = mkdtempSync(join(tmpdir(), 'ustago-storage-spec-'));
  return new LocalObjectStorage(dir, 'http://localhost:3000', Buffer.alloc(32, 7));
}

describe('LocalObjectStorage', () => {
  it('stores, describes and reads back an object', async () => {
    const s = storage();
    expect(await s.head(KEY)).toBeNull();
    await s.write(KEY, Readable.from([PNG]), 'image/png', 1024);
    expect(await s.head(KEY)).toEqual({ size: PNG.length, contentType: 'image/png' });
    expect(await s.readPrefix(KEY, 8)).toEqual(PNG.subarray(0, 8));
    await s.delete(KEY);
    expect(await s.head(KEY)).toBeNull();
  });

  it('never overwrites an object (a reused upload URL cannot swap the file)', async () => {
    const s = storage();
    await s.write(KEY, Readable.from([PNG]), 'image/png', 1024);
    await expect(
      s.write(KEY, Readable.from([Buffer.from('<html>')]), 'image/png', 1024),
    ).rejects.toBeInstanceOf(ObjectAlreadyExistsError);
    expect(await s.readPrefix(KEY, 8)).toEqual(PNG.subarray(0, 8));
  });

  it('stops streaming past the size cap and keeps nothing', async () => {
    const s = storage();
    await expect(
      s.write(KEY, Readable.from([Buffer.alloc(600), Buffer.alloc(600)]), 'image/png', 1000),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(await s.head(KEY)).toBeNull();
  });

  it.each([
    '../../etc/passwd',
    'verifications/../../secret.png',
    'verifications/x/y.png',
    '/abs/path.png',
    `${KEY}.svg`,
  ])('refuses the key %s', async (key) => {
    const s = storage();
    await expect(
      s.createUploadUrl(key, { contentType: 'image/png', maxBytes: 10, expiresInSeconds: 60 }),
    ).rejects.toThrow();
  });

  it('signs links that name one object and operation and expire', async () => {
    const s = storage();
    const upload = await s.createUploadUrl(KEY, {
      contentType: 'image/png',
      maxBytes: 1000,
      expiresInSeconds: 60,
    });
    const token = upload.url.split('/').at(-1) ?? '';
    expect(s.verifyToken(token)).toMatchObject({ key: KEY, op: 'put', ct: 'image/png', max: 1000 });
    expect(upload.url).not.toContain('verifications');

    const tampered = `${token.slice(0, -2)}${token.endsWith('A') ? 'B' : 'A'}A`;
    expect(s.verifyToken(tampered)).toBeNull();

    const other = new LocalObjectStorage(tmpdir(), 'http://x', Buffer.alloc(32, 9));
    expect(other.verifyToken(token)).toBeNull();

    const expired = await s.createDownloadUrl(KEY, -1);
    expect(s.verifyToken(expired.url.split('/').at(-1) ?? '')).toBeNull();
  });
});
