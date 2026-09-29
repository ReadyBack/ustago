import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OtpRequestResponse, OtpVerifyResponse } from '@ustago/types';
import { maskPhone, type OtpRequest, type OtpVerifyRequest } from '@ustago/validation';

import { AuditService } from '../../audit/audit.service.js';
import type { AuthUser } from '../../common/auth/auth-user.js';
import { secretFor } from '../../common/crypto/secrets.js';
import { uuidv7 } from '../../common/crypto/uuid.js';
import {
  badRequest,
  conflict,
  serviceUnavailable,
  tooManyRequests,
  unauthorized,
} from '../../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../../config/env.js';
import { Prisma, type OtpPurpose } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RateLimitService } from '../../rate-limit/rate-limit.service.js';
import { SMS_PROVIDER, type SmsProvider } from '../../sms/sms-provider.js';
import { toCurrentUser, type UserWithProfiles } from '../../users/user.mapper.js';
import { UsersRepository } from '../../users/users.repository.js';
import { accountDisabledError, AuthService, type ClientContext } from '../auth.service.js';
import {
  checkChallenge,
  generateOtpCode,
  hashOtpCode,
  type OtpCheck,
  otpCodeMatches,
} from './otp-crypto.js';

const OTP_RATE_LIMITED = 'OTP_RATE_LIMITED';

const otpInvalid = (attemptsRemaining?: number) =>
  badRequest(
    'OTP_INVALID',
    'Kod hatalı veya geçersiz.',
    attemptsRemaining === undefined ? undefined : { attemptsRemaining },
  );
const otpExpired = () =>
  badRequest('OTP_EXPIRED', 'Kodun süresi doldu. Lütfen yeni bir kod isteyin.');
const otpLocked = () =>
  tooManyRequests(
    0,
    'OTP_TOO_MANY_ATTEMPTS',
    'Çok fazla hatalı deneme yapıldı. Lütfen yeni bir kod isteyin.',
  );
const phoneInUse = () =>
  conflict('PHONE_ALREADY_IN_USE', 'Bu telefon numarası başka bir hesapta doğrulanmış.');

type ResolvedLogin = { user: UserWithProfiles; isNewUser: boolean };

/**
 * Phone one-time codes (docs/adr/0009). Sign-in reuses AuthService's
 * sessions, refresh rotation and revocation; there is no separate phone
 * session system.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly secret: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly rateLimit: RateLimitService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    this.secret = secretFor(env, 'otp', env.OTP_HASH_SECRET);
  }

  async request(
    input: OtpRequest,
    client: ClientContext,
    actor: AuthUser | undefined,
  ): Promise<OtpRequestResponse> {
    const userId = this.requireActorFor(input.purpose, actor);

    await this.rateLimit.enforceWithCode(
      OTP_RATE_LIMITED,
      { bucket: 'otp:request:ip', subject: client.ipAddress ?? '' },
      {
        bucket: 'otp:request:phone',
        subject: input.phone,
        limit: this.env.OTP_MAX_REQUESTS_PER_WINDOW,
        windowSeconds: this.env.OTP_REQUEST_WINDOW_SECONDS,
      },
    );
    if (this.env.OTP_RESEND_COOLDOWN_SECONDS > 0) {
      await this.rateLimit.enforceWithCode(OTP_RATE_LIMITED, {
        bucket: `otp:cooldown:${input.purpose}`,
        subject: input.phone,
        limit: 1,
        windowSeconds: this.env.OTP_RESEND_COOLDOWN_SECONDS,
      });
    }

    if (input.purpose === 'VERIFY_PHONE') {
      const owner = await this.users.findPhoneOwner(input.phone);
      if (owner && owner.id !== userId && this.ownsPhone(owner)) throw phoneInUse();
    }

    const now = new Date();
    const code = generateOtpCode(this.env.OTP_CODE_LENGTH);
    const expiresAt = new Date(now.getTime() + this.env.OTP_TTL_SECONDS * 1000);

    let challengeId: string;
    try {
      challengeId = await this.prisma.$transaction(async (tx) => {
        // A new code replaces the previous one (resend).
        await tx.otpChallenge.updateMany({
          where: {
            phone: input.phone,
            purpose: input.purpose,
            consumedAt: null,
            invalidatedAt: null,
          },
          data: { invalidatedAt: now },
        });
        const id = uuidv7();
        await tx.otpChallenge.create({
          data: {
            id,
            phone: input.phone,
            purpose: input.purpose,
            userId,
            codeHash: hashOtpCode(this.secret, id, code),
            maxAttempts: this.env.OTP_MAX_ATTEMPTS,
            expiresAt,
            ipAddress: client.ipAddress,
          },
        });
        return id;
      });
    } catch (error) {
      // Two requests for the same number raced; the partial unique index
      // let only one open challenge through.
      if (isUniqueViolation(error)) throw tooManyRequests(1, OTP_RATE_LIMITED);
      throw error;
    }

    try {
      await this.sms.sendOtp(input.phone, code, this.env.OTP_TTL_SECONDS);
    } catch (error) {
      await this.prisma.otpChallenge.update({
        where: { id: challengeId },
        data: { invalidatedAt: new Date() },
      });
      this.logger.error(
        `SMS delivery failed via ${this.sms.name} to ${maskPhone(input.phone)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw serviceUnavailable(
        'SMS_UNAVAILABLE',
        'SMS şu anda gönderilemiyor. Lütfen daha sonra tekrar deneyin.',
      );
    }

    await this.audit.record({
      action: 'auth.otp_requested',
      actorId: userId,
      entityType: 'otp_challenge',
      entityId: challengeId,
      ipAddress: client.ipAddress,
      metadata: { phone: maskPhone(input.phone), purpose: input.purpose, via: this.sms.name },
    });

    return {
      phone: input.phone,
      purpose: input.purpose,
      codeLength: this.env.OTP_CODE_LENGTH,
      expiresAt: expiresAt.toISOString(),
      resendAvailableAt: new Date(
        now.getTime() + this.env.OTP_RESEND_COOLDOWN_SECONDS * 1000,
      ).toISOString(),
    };
  }

  async verify(
    input: OtpVerifyRequest,
    client: ClientContext,
    actor: AuthUser | undefined,
  ): Promise<OtpVerifyResponse> {
    const actorId = this.requireActorFor(input.purpose, actor);

    await this.rateLimit.enforceWithCode(
      OTP_RATE_LIMITED,
      { bucket: 'otp:verify:ip', subject: client.ipAddress ?? '' },
      {
        bucket: 'otp:verify:phone',
        subject: input.phone,
        limit: this.env.OTP_MAX_ATTEMPTS * this.env.OTP_MAX_REQUESTS_PER_WINDOW,
        windowSeconds: this.env.OTP_REQUEST_WINDOW_SECONDS,
      },
    );

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: {
        phone: input.phone,
        purpose: input.purpose,
        invalidatedAt: null,
        consumedAt: null,
        ...(actorId ? { userId: actorId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const now = new Date();
    this.throwIfUnusable(checkChallenge(challenge, now));
    if (!challenge) throw otpInvalid();

    // Count the attempt before comparing, atomically, so parallel guesses
    // cannot exceed maxAttempts.
    const counted = await this.prisma.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        consumedAt: null,
        invalidatedAt: null,
        attempts: { lt: challenge.maxAttempts },
      },
      data: { attempts: { increment: 1 } },
    });
    if (counted.count === 0) {
      const fresh = await this.prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
      this.throwIfUnusable(checkChallenge(fresh, now));
      throw otpInvalid();
    }
    const attemptsUsed = challenge.attempts + 1;

    const matches =
      input.code.length === this.env.OTP_CODE_LENGTH &&
      otpCodeMatches(this.secret, challenge.id, input.code, challenge.codeHash);
    if (!matches) {
      const remaining = Math.max(0, challenge.maxAttempts - attemptsUsed);
      if (remaining === 0) {
        await this.prisma.otpChallenge.updateMany({
          where: { id: challenge.id, invalidatedAt: null },
          data: { invalidatedAt: new Date() },
        });
      }
      await this.audit.record({
        action: remaining === 0 ? 'auth.otp_locked' : 'auth.otp_failed',
        actorId: actorId,
        entityType: 'otp_challenge',
        entityId: challenge.id,
        ipAddress: client.ipAddress,
        metadata: { phone: maskPhone(input.phone), purpose: input.purpose, remaining },
      });
      if (remaining === 0) throw otpLocked();
      throw otpInvalid(remaining);
    }

    if (input.purpose === 'VERIFY_PHONE' && actorId) {
      const user = await this.verifyPhoneOf(actorId, challenge.id, input.phone, client);
      return { user: toCurrentUser(user), tokens: null, isNewUser: false };
    }

    const { user, isNewUser } = await this.loginWithPhone(challenge.id, input, client);
    if (user.status !== 'ACTIVE') throw accountDisabledError(user.status);
    const tokens = await this.auth.startSession(user.id, client);
    await this.audit.record({
      action: isNewUser ? 'auth.otp_register' : 'auth.otp_login',
      actorId: user.id,
      entityType: 'user',
      entityId: user.id,
      ipAddress: client.ipAddress,
      metadata: { phone: maskPhone(input.phone) },
    });
    const fresh = await this.users.findById(user.id);
    return { user: toCurrentUser(fresh ?? user), tokens, isNewUser };
  }

  /**
   * Consumes the challenge and finds or creates the account in one
   * transaction. A concurrent sign-up for the same number loses on the
   * unique phone index and is retried once, which then finds the account.
   */
  private async loginWithPhone(
    challengeId: string,
    input: OtpVerifyRequest,
    client: ClientContext,
  ): Promise<ResolvedLogin> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          await this.consume(challengeId, tx);
          const owner = await this.users.findPhoneOwner(input.phone, tx);
          if (owner && this.ownsPhone(owner)) {
            const user = await this.users.findById(owner.id, tx);
            if (user) return { user, isNewUser: false };
          }
          if (owner) await this.releasePhoneClaim(owner.id, input.phone, client, tx);
          const user = await this.users.createWithVerifiedPhone(
            {
              phone: input.phone,
              firstName: input.firstName ?? '',
              lastName: input.lastName ?? '',
            },
            tx,
          );
          return { user, isNewUser: true };
        });
      } catch (error) {
        if (attempt === 0 && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  private async verifyPhoneOf(
    userId: string,
    challengeId: string,
    phone: string,
    client: ClientContext,
  ): Promise<UserWithProfiles> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.consume(challengeId, tx);
        const owner = await this.users.findPhoneOwner(phone, tx);
        if (owner && owner.id !== userId) {
          if (this.ownsPhone(owner)) throw phoneInUse();
          await this.releasePhoneClaim(owner.id, phone, client, tx);
        }
        const user = await this.users.update(userId, { phone, phoneVerifiedAt: new Date() }, tx);
        await this.audit.recordIn(tx, {
          action: 'user.phone_verified',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          ipAddress: client.ipAddress,
          metadata: { phone: maskPhone(phone) },
        });
        return user;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw phoneInUse();
      throw error;
    }
  }

  /** Marks the challenge used; a second verify of the same code loses here. */
  private async consume(challengeId: string, tx: Prisma.TransactionClient): Promise<void> {
    const { count } = await tx.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, invalidatedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count === 0) throw otpInvalid();
  }

  /**
   * An account only owns a number once it proved it with an OTP. An
   * unverified claim (typed at e-mail sign-up) or a deleted account must not
   * capture the real owner of the number, so the claim is released.
   */
  private async releasePhoneClaim(
    ownerId: string,
    phone: string,
    client: ClientContext,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.user.update({ where: { id: ownerId }, data: { phone: null, phoneVerifiedAt: null } });
    await this.audit.recordIn(tx, {
      action: 'user.phone_claim_released',
      entityType: 'user',
      entityId: ownerId,
      ipAddress: client.ipAddress,
      metadata: { phone: maskPhone(phone) },
    });
  }

  private ownsPhone(owner: { deletedAt: Date | null; phoneVerifiedAt: Date | null }): boolean {
    return owner.deletedAt === null && owner.phoneVerifiedAt !== null;
  }

  private requireActorFor(purpose: OtpPurpose, actor: AuthUser | undefined): string | null {
    if (purpose === 'VERIFY_PHONE') {
      if (!actor) throw unauthorized('AUTH_REQUIRED', 'Telefon doğrulamak için oturum açın.');
      return actor.id;
    }
    return null;
  }

  private throwIfUnusable(check: OtpCheck): void {
    if (check.ok) return;
    switch (check.reason) {
      case 'EXPIRED':
        throw otpExpired();
      case 'LOCKED':
        throw otpLocked();
      case 'NOT_FOUND':
      case 'CONSUMED':
        throw otpInvalid();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
