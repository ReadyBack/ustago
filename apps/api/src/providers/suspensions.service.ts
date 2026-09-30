import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { AdminSuspension } from '@ustago/types';
import type { SuspendProviderRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, forbidden, notFound, unprocessable } from '../common/http/errors.js';
import { Prisma, type ProviderSuspension } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AlertsService } from '../ops/alerts.service.js';
import { OpsTaskRegistry } from '../ops/ops-task-registry.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderStore } from './provider.store.js';
import { VerificationCaseService } from './verification-case.service.js';

type Tx = Prisma.TransactionClient;

const OPEN = ['ACTIVE', 'EXPIRED_PENDING_REVIEW'] as const;
const actorSelect = { select: { id: true, firstName: true, lastName: true } } as const;

export interface SuspendInput {
  level: 'SUSPENDED' | 'BANNED';
  reasonCode: string;
  userVisibleReason: string;
  internalNote: string;
  expiresAt: Date | null;
  autoLift: boolean;
}

/**
 * Provider account suspensions (Faz 6, docs/adr/0023). Separate from the
 * Faz 2 application status and from Faz 4 disciplinary actions: a
 * suspension blocks new quotes, NOW jobs and payouts at once, keeps every
 * existing job, payment and review as it is, and is fully audited.
 *
 * Suspending takes FOR UPDATE on the provider row; creating a quote takes
 * FOR SHARE on the same row, so no quote can slip in after a suspension
 * commits.
 *
 * Temporary suspensions: on expiry an `autoLift` suspension ends by itself
 * (EXPIRED); otherwise it becomes EXPIRED_PENDING_REVIEW and the account
 * stays blocked until an admin lifts it (docs/adr/0023 decision).
 */
@Injectable()
export class SuspensionsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly cases: VerificationCaseService,
    private readonly alerts: AlertsService,
    private readonly registry: OpsTaskRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register('suspension-expiry', (now) => this.expireDue(now));
  }

  async list(providerId: string): Promise<AdminSuspension[]> {
    const rows = await this.prisma.providerSuspension.findMany({
      where: { providerId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { createdBy: actorSelect, liftedBy: actorSelect },
    });
    return rows.map(toAdminSuspension);
  }

  async suspend(
    actor: AuthUser,
    providerId: string,
    input: SuspendProviderRequest,
    ipAddress: string | null,
  ): Promise<AdminSuspension> {
    if (input.expiresAt && input.expiresAt <= new Date()) {
      throw unprocessable('SUSPENSION_EXPIRY_IN_PAST', 'Bitiş zamanı gelecekte olmalı.');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockById(tx, providerId);
      if (profile.userId === actor.id) {
        throw forbidden('CANNOT_REVIEW_SELF', 'Kendi hesabınızı askıya alamazsınız.');
      }
      const row = await this.suspendInTx(
        tx,
        profile.id,
        profile.userId,
        actor.id,
        {
          level: input.level,
          reasonCode: input.reasonCode,
          userVisibleReason: input.userVisibleReason,
          internalNote: input.internalNote ?? '',
          expiresAt: input.expiresAt ?? null,
          autoLift: input.autoLift,
        },
        ipAddress,
      );
      return row.id;
    });
    return this.one(id);
  }

  /** Used by this service and by the Faz 2 "askıya al" endpoint. */
  async suspendInTx(
    tx: Tx,
    providerId: string,
    providerUserId: string,
    adminId: string,
    input: SuspendInput,
    ipAddress: string | null,
  ): Promise<ProviderSuspension> {
    const now = new Date();
    let row: ProviderSuspension;
    try {
      row = await tx.providerSuspension.create({
        data: {
          providerId,
          status: 'ACTIVE',
          level: input.level,
          reasonCode: input.reasonCode,
          internalNote: input.internalNote,
          userVisibleReason: input.userVisibleReason,
          startsAt: now,
          expiresAt: input.expiresAt,
          autoLift: input.autoLift,
          createdById: adminId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('PROVIDER_ALREADY_SUSPENDED', 'Bu usta zaten askıda.');
      }
      throw error;
    }
    await tx.providerProfile.update({
      where: { id: providerId },
      data: { accountStatus: input.level, accountStatusChangedAt: now, isAvailableNow: false },
    });
    await this.cases.suspendCase(tx, providerId, providerUserId, adminId);
    await this.audit.recordIn(tx, {
      action: 'provider.suspended',
      actorId: adminId,
      entityType: 'provider_profile',
      entityId: providerId,
      ipAddress,
      metadata: {
        suspensionId: row.id,
        level: input.level,
        reasonCode: input.reasonCode,
        expiresAt: input.expiresAt?.toISOString() ?? null,
        autoLift: input.autoLift,
      },
    });
    await this.notifications.enqueueIn(tx, [
      {
        userId: providerUserId,
        type: NotificationEvent.ACCOUNT_SUSPENDED,
        title: input.level === 'BANNED' ? 'Hesabınız kapatıldı' : 'Hesabınız askıya alındı',
        body: input.userVisibleReason,
        data: { providerId },
      },
    ]);
    return row;
  }

  async lift(
    actor: AuthUser,
    providerId: string,
    note: string,
    ipAddress: string | null,
  ): Promise<AdminSuspension> {
    const id = await this.prisma.$transaction(async (tx) => {
      const profile = await this.store.lockById(tx, providerId);
      if (profile.userId === actor.id) {
        throw forbidden('CANNOT_REVIEW_SELF', 'Kendi hesabınızda işlem yapamazsınız.');
      }
      const row = await this.liftInTx(tx, profile.id, profile.userId, actor.id, note, ipAddress);
      if (!row) throw notFound('SUSPENSION_NOT_FOUND', 'Bu ustanın açık bir askısı yok.');
      return row.id;
    });
    return this.one(id);
  }

  async liftInTx(
    tx: Tx,
    providerId: string,
    providerUserId: string,
    adminId: string | null,
    note: string,
    ipAddress: string | null,
    endStatus: 'LIFTED' | 'EXPIRED' = 'LIFTED',
  ): Promise<ProviderSuspension | null> {
    const open = await tx.providerSuspension.findFirst({
      where: { providerId, status: { in: [...OPEN] } },
    });
    if (!open) return null;
    const now = new Date();
    await tx.providerSuspension.update({
      where: { id: open.id },
      data: { status: endStatus, liftedAt: now, liftedById: adminId, liftNote: note },
    });
    await tx.providerProfile.update({
      where: { id: providerId },
      data: { accountStatus: 'ACTIVE', accountStatusChangedAt: now },
    });
    await this.cases.reinstateCase(tx, providerId, providerUserId, adminId);
    await this.audit.recordIn(tx, {
      action: 'provider.unsuspended',
      actorId: adminId,
      entityType: 'provider_profile',
      entityId: providerId,
      ipAddress,
      metadata: { suspensionId: open.id, endStatus },
    });
    await this.notifications.enqueueIn(tx, [
      {
        userId: providerUserId,
        type: NotificationEvent.ACCOUNT_REINSTATED,
        title: 'Hesabınız yeniden aktif',
        body: 'Yeni teklif verebilir ve iş alabilirsiniz.',
        data: { providerId },
      },
    ]);
    return tx.providerSuspension.findUniqueOrThrow({ where: { id: open.id } });
  }

  /** Ops monitor task: ends or flags suspensions whose time is up. */
  async expireDue(now = new Date()): Promise<Record<string, number>> {
    const due = await this.prisma.providerSuspension.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: now } },
      select: { id: true, providerId: true, autoLift: true },
      take: 100,
    });
    let lifted = 0;
    let pendingReview = 0;
    for (const s of due) {
      await this.prisma.$transaction(async (tx) => {
        const profile = await this.store.lockById(tx, s.providerId);
        const fresh = await tx.providerSuspension.findUnique({ where: { id: s.id } });
        if (fresh?.status !== 'ACTIVE') return;
        if (s.autoLift) {
          await this.liftInTx(
            tx,
            profile.id,
            profile.userId,
            null,
            'Süre doldu (otomatik kaldırıldı).',
            null,
            'EXPIRED',
          );
          lifted += 1;
        } else {
          await tx.providerSuspension.update({
            where: { id: s.id },
            data: { status: 'EXPIRED_PENDING_REVIEW' },
          });
          await this.audit.recordIn(tx, {
            action: 'provider.suspension_expired_pending_review',
            actorId: null,
            entityType: 'provider_profile',
            entityId: profile.id,
            metadata: { suspensionId: s.id },
          });
          pendingReview += 1;
        }
      });
    }
    if (pendingReview > 0) {
      await this.alerts.raise({
        type: 'provider.suspension_review_due',
        severity: 'INFO',
        title: `${pendingReview} askının süresi doldu, yönetici incelemesi bekliyor`,
        details: { count: pendingReview },
        source: 'suspensions',
        dedupeKey: 'provider.suspension_review_due',
      });
    }
    return { lifted, pendingReview };
  }

  private async one(id: string): Promise<AdminSuspension> {
    const row = await this.prisma.providerSuspension.findUniqueOrThrow({
      where: { id },
      include: { createdBy: actorSelect, liftedBy: actorSelect },
    });
    return toAdminSuspension(row);
  }
}

type Row = Prisma.ProviderSuspensionGetPayload<{
  include: { createdBy: typeof actorSelect; liftedBy: typeof actorSelect };
}>;

const ref = (u: { id: string; firstName: string; lastName: string } | null) =>
  u ? { id: u.id, name: `${u.firstName} ${u.lastName}`.trim() } : null;

export function toAdminSuspension(s: Row): AdminSuspension {
  return {
    id: s.id,
    providerId: s.providerId,
    level: s.level === 'BANNED' ? 'BANNED' : s.level === 'LIMITED' ? 'LIMITED' : 'SUSPENDED',
    status: s.status,
    reasonCode: s.reasonCode,
    userVisibleReason: s.userVisibleReason,
    internalNote: s.internalNote,
    startsAt: s.startsAt.toISOString(),
    expiresAt: s.expiresAt?.toISOString() ?? null,
    autoLift: s.autoLift,
    createdAt: s.createdAt.toISOString(),
    createdBy: ref(s.createdBy),
    liftedBy: ref(s.liftedBy),
    liftedAt: s.liftedAt?.toISOString() ?? null,
    liftNote: s.liftNote,
  };
}
