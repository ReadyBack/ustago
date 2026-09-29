import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { IS_PUBLIC_KEY } from '../common/auth/decorators.js';
import { unauthorized } from '../common/http/errors.js';
import { accountDisabledError } from './auth.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { InvalidAccessTokenError, TokenService } from './token.service.js';

/**
 * Global guard: every route needs a valid access token unless marked
 * @Public(). Besides the signature, it checks that the session is still
 * active and the user is enabled, so logout and suspension apply at once.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearer(request.headers.authorization);
    if (!token) throw unauthorized('AUTH_REQUIRED', 'Oturum açmanız gerekiyor.');

    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof InvalidAccessTokenError && error.reason === 'expired') {
        throw unauthorized('ACCESS_TOKEN_EXPIRED', 'Oturum süresi doldu, token yenileyin.');
      }
      throw unauthorized('ACCESS_TOKEN_INVALID', 'Geçersiz oturum bilgisi.');
    }

    const session = await this.sessions.findForAuth(claims.sessionId);
    if (
      !session ||
      session.userId !== claims.userId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.deletedAt
    ) {
      throw unauthorized('SESSION_REVOKED', 'Oturum sonlandırılmış. Lütfen tekrar giriş yapın.');
    }
    if (session.user.status !== 'ACTIVE') throw accountDisabledError(session.user.status);

    request.user = {
      id: session.userId,
      sessionId: session.id,
      roles: session.user.roles.map((r) => r.role),
    };
    return true;
  }
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !value || rest.length > 0) return null;
  return value;
}
