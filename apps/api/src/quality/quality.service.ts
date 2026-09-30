import { Injectable } from '@nestjs/common';
import type { ProviderPenalty, ProviderQuality } from '@ustago/types';
import type { CreatePenalty, RevokePenalty } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound, unprocessable } from '../common/http/errors.js';
import type { DisciplinaryAction, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toProviderRating } from '../reviews/domain/review-policy.js';
import { severityOf } from './domain/penalty-policy.js';
import { computeUstaScore, USTA_SCORE_VERSION } from './domain/usta-score.js';
import { QualityRepository } from './quality.repository.js';

type Db = Prisma.TransactionClient | PrismaService;

const penaltyNotFound = () => notFound('PENALTY_NOT_FOUND', 'Yaptırım bulunamadı.');
const providerNotFound = () => notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');

/**
 * Provider quality (docs/adr/0016): UstaScore V1 snapshots and admin
 * sanctions. The snapshot (provider_scores) is recomputed in the same
 * transaction as every event that changes an input (review written,
 * edited, hidden or restored; job completed or cancelled; dispute decided;
 * sanction created, revoked or expired), and a periodic sweep refreshes
 * snapshots older than a day (reply times change without an event).
 */
@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: QualityRepository,
    private readonly audit: AuditService,
  ) {}

  async recalculateIn(db: Db, providerIds: readonly string[], now = new Date()): Promise<void> {
    const inputs = await this.repo.load(db, providerIds);
    for (const [providerId, input] of inputs) {
      const result = computeUstaScore(input, now);
      const data = {
        score: (result.score ?? 0).toFixed(2),
        sampleSize: result.sampleSize,
        isNewProvider: result.isNewProvider,
        components: {
          factors: result.factors.map((f) => ({
            key: f.key,
            weight: f.weight,
            effectiveWeight: f.effectiveWeight,
            score: f.score,
          })),
          penaltyPoints: result.penaltyPoints,
          available: result.score !== null,
        },
        algorithmVersion: USTA_SCORE_VERSION,
        computedAt: now,
      };
      await db.providerScore.upsert({
        where: { providerId },
        create: { providerId, ...data },
        update: data,
      });
    }
  }

  /** Recomputes every provider (seed, or after an algorithm change). */
  async recalculateAll(batch = 200): Promise<number> {
    let cursor: string | undefined;
    let total = 0;
    for (;;) {
      const page = await this.prisma.providerProfile.findMany({
        where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: batch,
      });
      if (page.length === 0) return total;
      await this.recalculateIn(
        this.prisma,
        page.map((p) => p.id),
      );
      total += page.length;
      cursor = page.at(-1)?.id;
    }
  }

  /** Snapshots older than `maxAgeHours` (or from an older algorithm) are refreshed. */
  async refreshStale(now = new Date(), maxAgeHours = 24, limit = 100): Promise<number> {
    const before = new Date(now.getTime() - maxAgeHours * 3600 * 1000);
    const stale = await this.prisma.providerProfile.findMany({
      where: {
        deletedAt: null,
        OR: [
          { score: null },
          { score: { computedAt: { lt: before } } },
          { score: { algorithmVersion: { not: USTA_SCORE_VERSION } } },
        ],
      },
      select: { id: true },
      take: limit,
    });
    if (stale.length > 0) {
      await this.recalculateIn(
        this.prisma,
        stale.map((p) => p.id),
        now,
      );
    }
    return stale.length;
  }

  // -------------------------------------------------------------------------
  // Admin view
  // -------------------------------------------------------------------------

  async quality(providerId: string, now = new Date()): Promise<ProviderQuality> {
    const exists = await this.prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { id: true, userId: true, score: true },
    });
    if (!exists) throw providerNotFound();
    const input = (await this.repo.load(this.prisma, [providerId])).get(providerId);
    if (!input) throw providerNotFound();
    const live = computeUstaScore(input, now);
    const penalties = await this.prisma.disciplinaryAction.findMany({
      where: { subjectId: exists.userId, subjectRole: 'PROVIDER' },
      include: { decidedBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const snapshot = exists.score;
    return {
      providerId,
      completedJobs: input.completedJobs,
      providerCancelledJobs: input.providerCancelledJobs,
      customerCancelledJobs: input.customerCancelledJobs,
      openDisputes: input.openDisputes,
      reviewCount: input.reviewCount,
      ratingAverage:
        toProviderRating(
          input.reviewCount,
          input.reviewCount > 0 ? input.reviewRatingSum / input.reviewCount : null,
        )?.average ?? null,
      ustaScore: live.score,
      isNewProvider: live.isNewProvider,
      algorithmVersion: snapshot?.algorithmVersion ?? null,
      computedAt: snapshot?.computedAt.toISOString() ?? null,
      factors: live.factors,
      penaltyPoints: live.penaltyPoints,
      penalties: penalties.map(toPenalty),
    };
  }

  // -------------------------------------------------------------------------
  // Sanctions (admin only, never automatic)
  // -------------------------------------------------------------------------

  async createPenalty(
    adminId: string,
    providerId: string,
    input: CreatePenalty,
    ipAddress: string | null,
  ): Promise<ProviderPenalty> {
    const now = new Date();
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    if (endsAt && endsAt <= now) {
      throw unprocessable('PENALTY_INVALID_WINDOW', 'Bitiş zamanı gelecekte olmalı.');
    }
    const id = await this.prisma.$transaction(async (tx) => {
      const provider = await tx.providerProfile.findUnique({
        where: { id: providerId },
        select: { id: true, userId: true },
      });
      if (!provider) throw providerNotFound();
      if (input.disputeId) {
        const dispute = await tx.dispute.findFirst({
          where: { id: input.disputeId, job: { providerId } },
          select: { id: true },
        });
        if (!dispute) throw notFound('DISPUTE_NOT_FOUND', 'Bu ustaya ait sorun bildirimi yok.');
      }
      const action = await tx.disciplinaryAction.create({
        data: {
          subjectId: provider.userId,
          subjectRole: 'PROVIDER',
          type: input.type,
          reasonCode: input.reasonCode,
          reason: input.reason,
          decidedById: adminId,
          disputeId: input.disputeId ?? null,
          startsAt: now,
          endsAt,
        },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.penalty.created',
        actorId: adminId,
        entityType: 'provider',
        entityId: providerId,
        ipAddress,
        metadata: {
          penaltyId: action.id,
          type: action.type,
          severity: severityOf(action.type),
          reasonCode: action.reasonCode,
          endsAt: endsAt?.toISOString() ?? null,
        },
      });
      await this.recalculateIn(tx, [providerId], now);
      return action.id;
    });
    return this.penalty(id);
  }

  async revokePenalty(
    adminId: string,
    penaltyId: string,
    input: RevokePenalty,
    ipAddress: string | null,
  ): Promise<ProviderPenalty> {
    await this.prisma.$transaction(async (tx) => {
      const action = await tx.disciplinaryAction.findUnique({ where: { id: penaltyId } });
      if (!action || action.subjectRole !== 'PROVIDER') throw penaltyNotFound();
      const moved = await tx.disciplinaryAction.updateMany({
        where: { id: penaltyId, status: { in: ['ACTIVE', 'UNDER_APPEAL'] } },
        data: { status: 'REVOKED' },
      });
      if (moved.count === 0) {
        throw conflict('PENALTY_NOT_ACTIVE', 'Bu yaptırım artık yürürlükte değil.', {
          status: action.status,
        });
      }
      const provider = await tx.providerProfile.findUniqueOrThrow({
        where: { userId: action.subjectId },
        select: { id: true },
      });
      await this.audit.recordIn(tx, {
        action: 'provider.penalty.revoked',
        actorId: adminId,
        entityType: 'provider',
        entityId: provider.id,
        ipAddress,
        metadata: { penaltyId, type: action.type, reason: input.reason },
      });
      await this.recalculateIn(tx, [provider.id]);
    });
    return this.penalty(penaltyId);
  }

  /** Marks sanctions whose end time passed as EXPIRED (audited) and rescores their providers. */
  async expireDuePenalties(now = new Date()): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string; subjectId: string; type: string }[]>`
        UPDATE disciplinary_actions SET status = 'EXPIRED', updated_at = now()
        WHERE status IN ('ACTIVE', 'UNDER_APPEAL') AND ends_at IS NOT NULL AND ends_at <= ${now}
        RETURNING id, subject_id AS "subjectId", type::text AS type`;
      if (due.length === 0) return 0;
      const providers = await tx.providerProfile.findMany({
        where: { userId: { in: due.map((d) => d.subjectId) } },
        select: { id: true, userId: true },
      });
      const byUser = new Map(providers.map((p) => [p.userId, p.id]));
      await tx.auditLog.createMany({
        data: due.map((d) => ({
          action: 'provider.penalty.expired',
          entityType: 'provider',
          entityId: byUser.get(d.subjectId) ?? d.subjectId,
          metadata: { penaltyId: d.id, type: d.type },
        })),
      });
      await this.recalculateIn(tx, providers.map((p) => p.id), now);
      return due.length;
    });
  }

  private async penalty(id: string): Promise<ProviderPenalty> {
    const row = await this.prisma.disciplinaryAction.findUniqueOrThrow({
      where: { id },
      include: { decidedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    return toPenalty(row);
  }
}

function toPenalty(
  p: DisciplinaryAction & { decidedBy: { id: string; firstName: string; lastName: string } | null },
): ProviderPenalty {
  return {
    id: p.id,
    type: p.type,
    severity: severityOf(p.type),
    status: p.status,
    reasonCode: p.reasonCode,
    reason: p.reason,
    disputeId: p.disputeId,
    startsAt: p.startsAt.toISOString(),
    endsAt: p.endsAt?.toISOString() ?? null,
    decidedBy: p.decidedBy
      ? { id: p.decidedBy.id, name: `${p.decidedBy.firstName} ${p.decidedBy.lastName}`.trim() }
      : null,
    createdAt: p.createdAt.toISOString(),
  };
}
