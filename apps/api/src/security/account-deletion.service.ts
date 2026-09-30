import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { AccountDeletionRequestView } from '@ustago/types';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { type AccountDeletionRequest, Prisma } from '../generated/prisma/client.js';
import { OpsTaskRegistry } from '../ops/ops-task-registry.js';
import { PrismaService } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

const DEV_GRACE_HOURS = 24;

const OPEN_JOB_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
  'PROVIDER_ARRIVED',
  'IN_PROGRESS',
  'AWAITING_COMPLETION_CONFIRMATION',
  'DISPUTED',
] as const;
const OPEN_DISPUTE_STATUSES = ['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW'] as const;
const OPEN_PAYOUT_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'PROCESSING',
  'NEEDS_RECONCILIATION',
] as const;
const OPEN_REQUEST_STATUSES: readonly ('REQUESTED' | 'BLOCKED_BY_ACTIVE_JOB' | 'PROCESSING')[] = [
  'REQUESTED',
  'BLOCKED_BY_ACTIVE_JOB',
  'PROCESSING',
];

/**
 * Account deletion workflow (Faz 6, docs/adr/0027). Nothing is deleted on
 * request: the account is pseudonymised after a grace period, and only
 * when no job, dispute or payout is still open. Financial and legal
 * records (payments, ledger, invoices-to-be, reviews, audit logs) are kept
 * and keep pointing at the pseudonymised user; how long they must be kept
 * is "Legal review required" (docs/security/data-retention.md).
 */
@Injectable()
export class AccountDeletionService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: OpsTaskRegistry,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onModuleInit(): void {
    this.registry.register('account-deletion', (now) => this.processDue(now));
  }

  /**
   * Staging/production refuse to boot without ACCOUNT_DELETION_GRACE_HOURS
   * (a business/legal decision); development falls back to one day.
   */
  private get graceMs(): number {
    return (this.env.ACCOUNT_DELETION_GRACE_HOURS ?? DEV_GRACE_HOURS) * 3_600_000;
  }

  async current(userId: string): Promise<AccountDeletionRequestView | null> {
    const row = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
    });
    return row ? this.toView(row) : null;
  }

  async request(userId: string, ipAddress: string | null): Promise<AccountDeletionRequestView> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const blockers = await this.blockersOf(tx, userId);
        const created = await tx.accountDeletionRequest.create({
          data: {
            userId,
            status: blockers.length > 0 ? 'BLOCKED_BY_ACTIVE_JOB' : 'REQUESTED',
            blockers,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'account.deletion_requested',
          actorId: userId,
          entityType: 'user',
          entityId: userId,
          ipAddress,
          metadata: { requestId: created.id, status: created.status, blockers },
        });
        return created;
      });
      return this.toView(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('ACCOUNT_DELETION_ALREADY_REQUESTED', 'Hesap silme talebiniz zaten alındı.');
      }
      throw error;
    }
  }

  async cancel(userId: string, ipAddress: string | null): Promise<AccountDeletionRequestView> {
    const row = await this.prisma.$transaction(async (tx) => {
      const open = await tx.accountDeletionRequest.findFirst({
        where: { userId, status: { in: ['REQUESTED', 'BLOCKED_BY_ACTIVE_JOB'] } },
      });
      if (!open) {
        throw notFound('ACCOUNT_DELETION_NOT_FOUND', 'İptal edilebilecek bir silme talebi yok.');
      }
      const updated = await tx.accountDeletionRequest.update({
        where: { id: open.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      await this.audit.recordIn(tx, {
        action: 'account.deletion_cancelled',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        ipAddress,
        metadata: { requestId: open.id },
      });
      return updated;
    });
    return this.toView(row);
  }

  /** Ops task: re-checks blocked requests and pseudonymises due ones. */
  async processDue(now = new Date()): Promise<Record<string, number>> {
    const due = await this.prisma.accountDeletionRequest.findMany({
      where: {
        status: { in: ['REQUESTED', 'BLOCKED_BY_ACTIVE_JOB'] },
        requestedAt: { lte: new Date(now.getTime() - this.graceMs) },
      },
      select: { id: true },
      take: 50,
    });
    let completed = 0;
    let blocked = 0;
    for (const { id } of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM account_deletion_requests
           WHERE id = ${id}::uuid AND status IN ('REQUESTED', 'BLOCKED_BY_ACTIVE_JOB')
           FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return null;
        const req = await tx.accountDeletionRequest.findUniqueOrThrow({ where: { id } });
        const blockers = await this.blockersOf(tx, req.userId);
        if (blockers.length > 0) {
          await tx.accountDeletionRequest.update({
            where: { id },
            data: { status: 'BLOCKED_BY_ACTIVE_JOB', blockers },
          });
          return false;
        }
        await tx.accountDeletionRequest.update({
          where: { id },
          data: { status: 'PROCESSING', processedAt: now, blockers: [] },
        });
        await this.pseudonymise(tx, req.userId, now);
        await tx.accountDeletionRequest.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await this.audit.recordIn(tx, {
          action: 'account.deletion_completed',
          actorId: null,
          entityType: 'user',
          entityId: req.userId,
          metadata: { requestId: id },
        });
        return true;
      });
      if (done === true) completed += 1;
      if (done === false) blocked += 1;
    }
    return { completed, blocked };
  }

  /** What must be finished before the account can be pseudonymised. */
  async blockersOf(tx: Tx, userId: string): Promise<string[]> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        customerProfile: { select: { id: true } },
        providerProfile: { select: { id: true } },
      },
    });
    const customerId = user.customerProfile?.id;
    const providerId = user.providerProfile?.id;
    const jobScope = [
      ...(customerId ? [{ customerId }] : []),
      ...(providerId ? [{ providerId }] : []),
    ];
    const [openJobs, openDisputes, openPayouts] = await Promise.all([
      jobScope.length > 0
        ? tx.job.count({ where: { OR: jobScope, status: { in: [...OPEN_JOB_STATUSES] } } })
        : Promise.resolve(0),
      tx.dispute.count({
        where: {
          OR: [{ openedById: userId }, { againstId: userId }],
          status: { in: [...OPEN_DISPUTE_STATUSES] },
        },
      }),
      providerId
        ? tx.payout.count({ where: { providerId, status: { in: [...OPEN_PAYOUT_STATUSES] } } })
        : Promise.resolve(0),
    ]);
    return [
      ...(openJobs > 0 ? ['ACTIVE_JOB'] : []),
      ...(openDisputes > 0 ? ['OPEN_DISPUTE'] : []),
      ...(openPayouts > 0 ? ['OPEN_PAYOUT'] : []),
    ];
  }

  /**
   * Removes what identifies the person and keeps the records the platform
   * must keep. Row ids stay, so jobs, payments and the ledger still add up.
   */
  private async pseudonymise(tx: Tx, userId: string, now: Date): Promise<void> {
    await tx.user.update({
      where: { id: userId },
      data: {
        email: null,
        phone: null,
        passwordHash: null,
        firstName: 'Silinmiş',
        lastName: 'Kullanıcı',
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        deletedAt: now,
      },
    });
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now, revokedReason: 'ACCOUNT_DELETED' },
    });
    await tx.device.updateMany({
      where: { userId },
      data: { pushToken: null, revokedAt: now },
    });
    await tx.providerProfile.updateMany({
      where: { userId },
      data: {
        displayName: 'Silinmiş usta',
        bio: null,
        isAvailableNow: false,
        lastLatitude: null,
        lastLongitude: null,
        lastLocationAt: null,
        deletedAt: now,
      },
    });
  }

  private toView(row: AccountDeletionRequest): AccountDeletionRequestView {
    const open = OPEN_REQUEST_STATUSES.includes(
      row.status as (typeof OPEN_REQUEST_STATUSES)[number],
    );
    return {
      id: row.id,
      status: row.status,
      blockers: Array.isArray(row.blockers) ? row.blockers.map(String) : [],
      requestedAt: row.requestedAt.toISOString(),
      scheduledFor: open ? new Date(row.requestedAt.getTime() + this.graceMs).toISOString() : null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
