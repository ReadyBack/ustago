import { Injectable } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const sessionWithUser = {
  include: {
    user: {
      select: { id: true, status: true, deletedAt: true, roles: { select: { role: true } } },
    },
  },
} satisfies Prisma.AuthSessionDefaultArgs;

export type SessionWithUser = Prisma.AuthSessionGetPayload<typeof sessionWithUser>;

export interface NewSession {
  userId: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  refreshTokenHash: string;
  refreshTokenExpiresAt: Date;
}

/** Persistence for sign-in sessions and their refresh tokens. */
@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: NewSession, tx: Prisma.TransactionClient = this.prisma) {
    return tx.authSession.create({
      data: {
        userId: input.userId,
        userAgent: input.userAgent,
        ipAddress: input.ipAddress,
        expiresAt: input.expiresAt,
        refreshTokens: {
          create: { tokenHash: input.refreshTokenHash, expiresAt: input.refreshTokenExpiresAt },
        },
      },
    });
  }

  findForAuth(sessionId: string): Promise<SessionWithUser | null> {
    return this.prisma.authSession.findUnique({ where: { id: sessionId }, ...sessionWithUser });
  }

  findRefreshToken(tokenHash: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: sessionWithUser },
    });
  }

  /** Marks the token used. Returns false if another request consumed it first. */
  async consumeRefreshToken(id: string, tx: Prisma.TransactionClient): Promise<boolean> {
    const { count } = await tx.refreshToken.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return count === 1;
  }

  async addRefreshToken(
    sessionId: string,
    tokenHash: string,
    expiresAt: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.refreshToken.create({ data: { sessionId, tokenHash, expiresAt } });
    await tx.authSession.update({ where: { id: sessionId }, data: { lastUsedAt: new Date() } });
  }

  async revoke(
    sessionId: string,
    reason: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await tx.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const { count } = await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Revokes the device linked to a session and drops its push token. */
  async releaseDeviceOf(sessionId: string): Promise<void> {
    const session = await this.prisma.authSession.findUnique({
      where: { id: sessionId },
      select: { deviceId: true },
    });
    if (!session?.deviceId) return;
    await this.prisma.device.updateMany({
      where: { id: session.deviceId, revokedAt: null },
      data: { revokedAt: new Date(), pushToken: null },
    });
  }

  async releaseAllDevicesOf(userId: string): Promise<void> {
    await this.prisma.device.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), pushToken: null },
    });
  }

  async attachDevice(sessionId: string, deviceId: string): Promise<void> {
    await this.prisma.authSession.update({ where: { id: sessionId }, data: { deviceId } });
  }
}
