import { randomBytes } from 'node:crypto';

import { signStorageToken, verifyStorageToken } from './signed-token.js';

const secret = randomBytes(32);
const claims = { key: 'verifications/a/b.pdf', op: 'get' as const, exp: 2_000_000_000 };

describe('storage URL tokens', () => {
  it('round-trips valid claims', () => {
    expect(verifyStorageToken(secret, signStorageToken(secret, claims), 0)).toEqual(claims);
  });

  it('rejects expired tokens', () => {
    const token = signStorageToken(secret, { ...claims, exp: 100 });
    expect(verifyStorageToken(secret, token, 100_000)).toBeNull();
  });

  it('rejects tampered payloads and foreign keys', () => {
    const token = signStorageToken(secret, claims);
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...claims, key: 'other' })).toString('base64url')}.${signature}`;
    expect(verifyStorageToken(secret, forged, 0)).toBeNull();
    expect(verifyStorageToken(randomBytes(32), token, 0)).toBeNull();
    expect(verifyStorageToken(secret, 'garbage', 0)).toBeNull();
    expect(verifyStorageToken(secret, `${token}.extra`, 0)).toBeNull();
  });
});
