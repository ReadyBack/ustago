import { SignJWT } from 'jose';

import { testEnv } from '../testing/test-env.js';
import { InvalidAccessTokenError, TokenService } from './token.service.js';

describe('TokenService', () => {
  const env = testEnv();
  const service = new TokenService(env);
  const claims = {
    userId: '0199a0a0-0000-7000-8000-000000000001',
    sessionId: '0199a0a0-0000-7000-8000-000000000002',
  };

  it('signs and verifies an access token', async () => {
    const { token, expiresAt } = await service.signAccessToken(claims);
    await expect(service.verifyAccessToken(token)).resolves.toEqual(claims);
    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan((env.JWT_ACCESS_TTL_SECONDS - 5) * 1000);
    expect(ttlMs).toBeLessThanOrEqual(env.JWT_ACCESS_TTL_SECONDS * 1000);
  });

  it('keeps roles and personal data out of the token', async () => {
    const { token } = await service.signAccessToken(claims);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'sid',
      'sub',
      'typ',
    ]);
  });

  it('rejects expired tokens with reason "expired"', async () => {
    const past = new Date(Date.now() - (env.JWT_ACCESS_TTL_SECONDS + 60) * 1000);
    const { token } = await service.signAccessToken(claims, past);
    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({ reason: 'expired' });
  });

  it('rejects a token signed with another secret', async () => {
    const other = new TokenService(
      testEnv({ JWT_ACCESS_SECRET: 'another-secret-another-secret-12345' }),
    );
    const { token } = await other.signAccessToken(claims);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a tampered payload', async () => {
    const { token } = await service.signAccessToken(claims);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'someone-else', sid: claims.sessionId }),
    ).toString('base64url');
    await expect(
      service.verifyAccessToken(`${header}.${forged}.${signature}`),
    ).rejects.toMatchObject({
      reason: 'invalid',
    });
  });

  it('rejects "alg: none" tokens', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sub: claims.userId, sid: claims.sessionId, typ: 'access' }),
    ).toString('base64url');
    await expect(service.verifyAccessToken(`${header}.${body}.`)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a correctly signed token that is not an access token', async () => {
    const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
    const token = await new SignJWT({ sid: claims.sessionId, typ: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects a token for another audience', async () => {
    const other = new TokenService(testEnv({ JWT_AUDIENCE: 'someone-else' }));
    const { token } = await other.signAccessToken(claims);
    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('generates random refresh tokens and stores only a SHA-256 hash', () => {
    const a = service.generateRefreshToken();
    const b = service.generateRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(43);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
    expect(TokenService.hashRefreshToken(a.token)).toBe(a.hash);
  });
});
