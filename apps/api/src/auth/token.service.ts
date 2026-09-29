import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { errors, jwtVerify, SignJWT } from 'jose';

import { API_ENV, type ApiEnv } from '../config/env.js';

export interface AccessTokenClaims {
  userId: string;
  sessionId: string;
}

export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

export interface IssuedRefreshToken {
  token: string;
  hash: string;
}

export class InvalidAccessTokenError extends Error {
  constructor(readonly reason: 'expired' | 'invalid') {
    super(`Access token ${reason}`);
    this.name = 'InvalidAccessTokenError';
  }
}

const ALGORITHM = 'HS256';
const TOKEN_TYPE = 'access';

/**
 * Access tokens: short-lived HS256 JWTs holding only the user id (`sub`) and
 * session id (`sid`). Roles are read from the database on every request, so
 * role changes and revocations apply immediately.
 *
 * Refresh tokens: 256-bit random strings. Only their SHA-256 hash is stored.
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async signAccessToken(claims: AccessTokenClaims, now = new Date()): Promise<IssuedAccessToken> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAtSeconds = issuedAt + this.env.JWT_ACCESS_TTL_SECONDS;
    const token = await new SignJWT({ sid: claims.sessionId, typ: TOKEN_TYPE })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
      .setSubject(claims.userId)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience(this.env.JWT_AUDIENCE)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAtSeconds)
      .setJti(randomUUID())
      .sign(this.key);
    return { token, expiresAt: new Date(expiresAtSeconds * 1000) };
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: [ALGORITHM],
        issuer: this.env.JWT_ISSUER,
        audience: this.env.JWT_AUDIENCE,
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (
        payload['typ'] !== TOKEN_TYPE ||
        typeof payload.sub !== 'string' ||
        typeof payload['sid'] !== 'string'
      ) {
        throw new InvalidAccessTokenError('invalid');
      }
      return { userId: payload.sub, sessionId: payload['sid'] };
    } catch (error) {
      if (error instanceof InvalidAccessTokenError) throw error;
      if (error instanceof errors.JWTExpired) throw new InvalidAccessTokenError('expired');
      throw new InvalidAccessTokenError('invalid');
    }
  }

  generateRefreshToken(): IssuedRefreshToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hashRefreshToken(token) };
  }

  static hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
