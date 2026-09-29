import { Inject, Injectable } from '@nestjs/common';
import type { AuthResponse, AuthTokens } from '@ustago/types';
import type { LoginRequest, RegisterRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, forbidden, unauthorized } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { Prisma, type Role, type UserStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toCurrentUser } from '../users/user.mapper.js';
import { UsersRepository } from '../users/users.repository.js';
import { PasswordService } from './password.service.js';
import { SessionsRepository } from './sessions.repository.js';
import { TokenService } from './token.service.js';

export interface ClientContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const INVALID_CREDENTIALS = () => unauthorized('INVALID_CREDENTIALS', 'E-posta veya şifre hatalı.');
const INVALID_REFRESH = () =>
  unauthorized('REFRESH_TOKEN_INVALID', 'Oturumun süresi doldu. Lütfen tekrar giriş yapın.');

export function accountDisabledError(status: UserStatus) {
  return forbidden(
    status === 'BANNED' ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED',
    'Hesabınız şu anda kullanılamıyor. Destek ekibiyle iletişime geçin.',
  );
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async register(input: RegisterRequest, client: ClientContext): Promise<AuthResponse> {
    const phone = input.phone ?? null;
    const taken = await this.users.existsWithEmailOrPhone(input.email, phone);
    if (taken.email) throw conflict('EMAIL_TAKEN', 'Bu e-posta adresiyle kayıtlı bir hesap var.');
    if (taken.phone) throw conflict('PHONE_TAKEN', 'Bu telefon numarasıyla kayıtlı bir hesap var.');

    const isProvider = input.accountType === 'PROVIDER';
    const roles: Role[] = isProvider ? ['CUSTOMER', 'PROVIDER'] : ['CUSTOMER'];
    const passwordHash = await this.passwords.hash(input.password);
    const refresh = this.tokens.generateRefreshToken();
    const { refreshExpiresAt, sessionExpiresAt } = this.lifetimes();

    try {
      const { user, session } = await this.prisma.$transaction(async (tx) => {
        const user = await this.users.create(
          {
            email: input.email,
            phone,
            passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            roles,
            providerDisplayName: isProvider
              ? (input.providerDisplayName ?? `${input.firstName} ${input.lastName}`)
              : null,
          },
          tx,
        );
        const session = await this.sessions.create(
          {
            userId: user.id,
            ...client,
            expiresAt: sessionExpiresAt,
            refreshTokenHash: refresh.hash,
            refreshTokenExpiresAt: refreshExpiresAt,
          },
          tx,
        );
        await this.audit.recordIn(tx, {
          action: 'auth.register',
          actorId: user.id,
          entityType: 'user',
          entityId: user.id,
          ipAddress: client.ipAddress,
          metadata: { accountType: input.accountType },
        });
        return { user, session };
      });

      await this.users.touchLastLogin(user.id);
      return {
        user: toCurrentUser(user),
        tokens: await this.buildTokens(user.id, session.id, refresh.token, refreshExpiresAt),
      };
    } catch (error) {
      // Lost a race with a concurrent sign-up for the same e-mail or phone.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('ACCOUNT_EXISTS', 'Bu bilgilerle kayıtlı bir hesap var.');
      }
      throw error;
    }
  }

  async login(input: LoginRequest, client: ClientContext): Promise<AuthResponse> {
    const candidate = await this.users.findByEmailForLogin(input.email);
    if (!candidate?.passwordHash) {
      await this.passwords.verifyAgainstDummy(input.password);
      throw INVALID_CREDENTIALS();
    }
    if (!(await this.passwords.verify(candidate.passwordHash, input.password))) {
      await this.audit.record({
        action: 'auth.login_failed',
        actorId: candidate.id,
        entityType: 'user',
        entityId: candidate.id,
        ipAddress: client.ipAddress,
      });
      throw INVALID_CREDENTIALS();
    }
    // Only revealed after a correct password, so it leaks nothing.
    if (candidate.status !== 'ACTIVE') throw accountDisabledError(candidate.status);

    const refresh = this.tokens.generateRefreshToken();
    const { refreshExpiresAt, sessionExpiresAt } = this.lifetimes();
    const session = await this.sessions.create({
      userId: candidate.id,
      ...client,
      expiresAt: sessionExpiresAt,
      refreshTokenHash: refresh.hash,
      refreshTokenExpiresAt: refreshExpiresAt,
    });
    await this.users.touchLastLogin(candidate.id);
    await this.audit.record({
      action: 'auth.login',
      actorId: candidate.id,
      entityType: 'session',
      entityId: session.id,
      ipAddress: client.ipAddress,
    });

    const user = await this.users.findById(candidate.id);
    if (!user) throw INVALID_CREDENTIALS();
    return {
      user: toCurrentUser(user),
      tokens: await this.buildTokens(user.id, session.id, refresh.token, refreshExpiresAt),
    };
  }

  /**
   * Rotates a refresh token. A token can be used once; presenting a used
   * token means it was copied, so the whole session is revoked.
   */
  async refresh(refreshToken: string, client: ClientContext): Promise<AuthTokens> {
    const hash = TokenService.hashRefreshToken(refreshToken);
    const now = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      const stored = await this.sessions.findRefreshToken(hash, tx);
      if (!stored) return { kind: 'invalid' } as const;
      const { session } = stored;

      if (stored.consumedAt || !(await this.sessions.consumeRefreshToken(stored.id, tx))) {
        await this.sessions.revoke(session.id, 'TOKEN_REUSE', tx);
        return { kind: 'reused', userId: session.userId, sessionId: session.id } as const;
      }
      if (
        stored.expiresAt <= now ||
        session.revokedAt ||
        session.expiresAt <= now ||
        session.user.deletedAt
      ) {
        return { kind: 'invalid' } as const;
      }
      if (session.user.status !== 'ACTIVE') {
        return { kind: 'disabled', status: session.user.status } as const;
      }

      const next = this.tokens.generateRefreshToken();
      const refreshExpiresAt = new Date(
        Math.min(
          now.getTime() + this.env.AUTH_REFRESH_TTL_DAYS * DAY_MS,
          session.expiresAt.getTime(),
        ),
      );
      await this.sessions.addRefreshToken(session.id, next.hash, refreshExpiresAt, tx);
      return {
        kind: 'rotated',
        userId: session.userId,
        sessionId: session.id,
        token: next.token,
        refreshExpiresAt,
      } as const;
    });

    switch (outcome.kind) {
      case 'rotated':
        return this.buildTokens(
          outcome.userId,
          outcome.sessionId,
          outcome.token,
          outcome.refreshExpiresAt,
        );
      case 'reused':
        await this.audit.record({
          action: 'auth.refresh_token_reuse',
          actorId: outcome.userId,
          entityType: 'session',
          entityId: outcome.sessionId,
          ipAddress: client.ipAddress,
        });
        throw unauthorized(
          'REFRESH_TOKEN_REUSED',
          'Güvenlik nedeniyle oturum kapatıldı. Lütfen tekrar giriş yapın.',
        );
      case 'disabled':
        throw accountDisabledError(outcome.status);
      case 'invalid':
        throw INVALID_REFRESH();
    }
  }

  /**
   * Opens a new session for an already authenticated user (used by phone
   * OTP sign-in) with the same refresh-rotation rules as password login.
   */
  async startSession(userId: string, client: ClientContext): Promise<AuthTokens> {
    const refresh = this.tokens.generateRefreshToken();
    const { refreshExpiresAt, sessionExpiresAt } = this.lifetimes();
    const session = await this.sessions.create({
      userId,
      ...client,
      expiresAt: sessionExpiresAt,
      refreshTokenHash: refresh.hash,
      refreshTokenExpiresAt: refreshExpiresAt,
    });
    await this.users.touchLastLogin(userId);
    return this.buildTokens(userId, session.id, refresh.token, refreshExpiresAt);
  }

  async logout(userId: string, sessionId: string, client: ClientContext): Promise<void> {
    await this.sessions.revoke(sessionId, 'LOGOUT');
    // A signed-out install must stop receiving pushes for this account.
    await this.sessions.releaseDeviceOf(sessionId);
    await this.audit.record({
      action: 'auth.logout',
      actorId: userId,
      entityType: 'session',
      entityId: sessionId,
      ipAddress: client.ipAddress,
    });
  }

  async logoutAll(userId: string, client: ClientContext): Promise<void> {
    const count = await this.sessions.revokeAllForUser(userId, 'LOGOUT_ALL');
    await this.sessions.releaseAllDevicesOf(userId);
    await this.audit.record({
      action: 'auth.logout_all',
      actorId: userId,
      entityType: 'user',
      entityId: userId,
      ipAddress: client.ipAddress,
      metadata: { revokedSessions: count },
    });
  }

  private lifetimes(now = Date.now()) {
    return {
      refreshExpiresAt: new Date(now + this.env.AUTH_REFRESH_TTL_DAYS * DAY_MS),
      sessionExpiresAt: new Date(now + this.env.AUTH_SESSION_MAX_DAYS * DAY_MS),
    };
  }

  private async buildTokens(
    userId: string,
    sessionId: string,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): Promise<AuthTokens> {
    const access = await this.tokens.signAccessToken({ userId, sessionId });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    };
  }
}
