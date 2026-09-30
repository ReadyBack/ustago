import { Inject, Injectable } from '@nestjs/common';
import type { AdminFeePolicy, FeePolicyLifecycle, FeePreviewLine } from '@ustago/types';
import {
  type CreateFeePolicyRequest,
  FEE_PREVIEW_AMOUNTS_MINOR,
  type FeePreviewQuery,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, notFound, unprocessable } from '../common/http/errors.js';
import { toMoney, toMoneyOrNull } from '../common/money.js';
import { Prisma, type PlatformFeePolicy } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type FeePolicy, feeFor } from './domain/fee.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';

const actor = { select: { id: true, firstName: true, lastName: true } } as const;
type Row = Prisma.PlatformFeePolicyGetPayload<{ include: { publishedBy: typeof actor } }>;

/** Publishing needs a start at least this far ahead (no retroactive fees). */
const MIN_LEAD_MS = 60_000;

const notFoundError = () => notFound('FEE_POLICY_NOT_FOUND', 'Komisyon politikası bulunamadı.');

/**
 * Fee policy administration (Faz 6, docs/adr/0025). A policy is a DRAFT
 * until published; publishing freezes it (a database trigger refuses later
 * changes to its numbers) and it becomes SCHEDULED, then ACTIVE at its
 * start. A later published policy takes over from that instant; jobs keep
 * the policy snapshot taken when the deal was made, so a job priced at %15
 * stays at %15 when a %17 policy starts.
 *
 * Only SCHEDULED policies can be retired (cancelled before they start). An
 * ACTIVE policy is replaced by publishing a new one, never switched off, so
 * there is always exactly one answer to "which policy applies now".
 */
@Injectable()
export class FeePoliciesAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
  ) {}

  async list(now = new Date()): Promise<AdminFeePolicy[]> {
    const [rows, usage] = await Promise.all([
      this.prisma.platformFeePolicy.findMany({
        where: this.config.strictEnv ? { isDevelopment: false } : {},
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        include: { publishedBy: actor },
        take: 200,
      }),
      this.prisma.job.groupBy({
        by: ['platformFeePolicyId'],
        where: { platformFeePolicyId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const jobs = new Map(usage.map((u) => [u.platformFeePolicyId, u._count._all]));
    const activeId = currentActiveId(rows, now, this.config.strictEnv);
    return rows.map((r) => toAdminFeePolicy(r, lifecycleOf(r, now, activeId), jobs.get(r.id) ?? 0));
  }

  async create(
    user: AuthUser,
    input: CreateFeePolicyRequest,
    ipAddress: string | null,
  ): Promise<AdminFeePolicy> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const created = await tx.platformFeePolicy.create({
          data: {
            code: input.code,
            name: input.name,
            bps: input.bps,
            fixedFeeMinor: BigInt(input.fixedMinor),
            minFeeMinor: input.minMinor === null ? null : BigInt(input.minMinor),
            maxFeeMinor: input.maxMinor === null ? null : BigInt(input.maxMinor),
            effectiveFrom: input.effectiveFrom,
            isDevelopment: false,
            createdById: user.id,
          },
          include: { publishedBy: actor },
        });
        await this.audit.recordIn(tx, {
          action: 'fee_policy.created',
          actorId: user.id,
          entityType: 'platform_fee_policy',
          entityId: created.id,
          ipAddress,
          metadata: {
            code: input.code,
            bps: input.bps,
            effectiveFrom: input.effectiveFrom.toISOString(),
          },
        });
        return created;
      });
      return toAdminFeePolicy(row, 'DRAFT', 0);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('FEE_POLICY_CODE_TAKEN', 'Bu kod başka bir politikada kullanılıyor.');
      }
      throw error;
    }
  }

  /**
   * DRAFT → SCHEDULED. Serialized with a transaction-scoped advisory lock;
   * the conditional update makes a double click (or two admins) publish
   * once, and the partial unique index refuses two live policies with the
   * same start.
   */
  async publish(user: AuthUser, id: string, ipAddress: string | null): Promise<AdminFeePolicy> {
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ustago:fee-policy-publish'))`;
        const current = await tx.platformFeePolicy.findUnique({ where: { id } });
        if (!current) throw notFoundError();
        if (current.publishedAt) {
          throw conflict('FEE_POLICY_ALREADY_PUBLISHED', 'Bu politika zaten yayınlandı.');
        }
        if (current.effectiveFrom.getTime() < now.getTime() + MIN_LEAD_MS) {
          throw unprocessable(
            'FEE_POLICY_START_IN_PAST',
            'Başlangıç zamanı gelecekte olmalı. Geriye dönük komisyon uygulanamaz.',
          );
        }
        const updated = await tx.platformFeePolicy.updateMany({
          where: { id, publishedAt: null },
          data: { publishedAt: now, publishedById: user.id },
        });
        if (updated.count === 0) {
          throw conflict('FEE_POLICY_ALREADY_PUBLISHED', 'Bu politika zaten yayınlandı.');
        }
        await this.audit.recordIn(tx, {
          action: 'fee_policy.published',
          actorId: user.id,
          entityType: 'platform_fee_policy',
          entityId: id,
          ipAddress,
          metadata: {
            code: current.code,
            bps: current.bps,
            effectiveFrom: current.effectiveFrom.toISOString(),
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict(
          'FEE_POLICY_START_CONFLICT',
          'Aynı anda başlayan yayınlanmış bir politika var. Başka bir başlangıç zamanı seçin.',
        );
      }
      throw error;
    }
    return this.one(id);
  }

  /** SCHEDULED → RETIRED (cancelled before it starts). */
  async retire(user: AuthUser, id: string, ipAddress: string | null): Promise<AdminFeePolicy> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('ustago:fee-policy-publish'))`;
      const current = await tx.platformFeePolicy.findUnique({ where: { id } });
      if (!current) throw notFoundError();
      const updated = await tx.platformFeePolicy.updateMany({
        where: {
          id,
          publishedAt: { not: null },
          retiredAt: null,
          effectiveFrom: { gt: now },
        },
        data: { retiredAt: now, retiredById: user.id },
      });
      if (updated.count === 0) {
        throw conflict(
          'FEE_POLICY_NOT_RETIRABLE',
          'Yalnızca henüz başlamamış (planlanmış) politikalar iptal edilebilir. Yürürlükteki politikayı değiştirmek için yeni bir politika yayınlayın.',
        );
      }
      await this.audit.recordIn(tx, {
        action: 'fee_policy.retired',
        actorId: user.id,
        entityType: 'platform_fee_policy',
        entityId: id,
        ipAddress,
        metadata: { code: current.code },
      });
    });
    return this.one(id);
  }

  /** Only a DRAFT can be deleted; published policies are financial history. */
  async deleteDraft(user: AuthUser, id: string, ipAddress: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.platformFeePolicy.findUnique({ where: { id } });
      if (!current) throw notFoundError();
      const deleted = await tx.platformFeePolicy.deleteMany({ where: { id, publishedAt: null } });
      if (deleted.count === 0) {
        throw conflict('FEE_POLICY_ALREADY_PUBLISHED', 'Yayınlanmış politika silinemez.');
      }
      await this.audit.recordIn(tx, {
        action: 'fee_policy.draft_deleted',
        actorId: user.id,
        entityType: 'platform_fee_policy',
        entityId: id,
        ipAddress,
        metadata: { code: current.code },
      });
    });
  }

  preview(query: FeePreviewQuery): FeePreviewLine[] {
    const policy: FeePolicy = {
      bps: query.bps,
      fixedFeeMinor: BigInt(query.fixedMinor),
      minFeeMinor: query.minMinor === undefined ? null : BigInt(query.minMinor),
      maxFeeMinor: query.maxMinor === undefined ? null : BigInt(query.maxMinor),
    };
    return previewLines(policy);
  }

  private async one(id: string): Promise<AdminFeePolicy> {
    const all = await this.list();
    const found = all.find((p) => p.id === id);
    if (!found) throw notFoundError();
    return found;
  }
}

export function previewLines(policy: FeePolicy): FeePreviewLine[] {
  return FEE_PREVIEW_AMOUNTS_MINOR.map((amount) => {
    const gross = BigInt(amount);
    const fee = feeFor(gross, policy);
    return {
      gross: toMoney(gross, 'TRY'),
      fee: toMoney(fee, 'TRY'),
      providerNet: toMoney(gross - fee, 'TRY'),
    };
  });
}

/** The id of the policy FeePolicyService.activeAt would pick at `now`. */
function currentActiveId(rows: PlatformFeePolicy[], now: Date, strictEnv: boolean): string | null {
  const live = rows
    .filter(
      (r) =>
        r.publishedAt && !r.retiredAt && r.effectiveFrom <= now && (!strictEnv || !r.isDevelopment),
    )
    .sort(
      (a, b) =>
        b.effectiveFrom.getTime() - a.effectiveFrom.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  return live[0]?.id ?? null;
}

export function lifecycleOf(
  r: PlatformFeePolicy,
  now: Date,
  activeId: string | null,
): FeePolicyLifecycle {
  if (!r.publishedAt) return 'DRAFT';
  if (r.retiredAt) return 'RETIRED';
  if (r.effectiveFrom > now) return 'SCHEDULED';
  // Superseded by a later published policy: no longer applies to new jobs.
  return r.id === activeId ? 'ACTIVE' : 'RETIRED';
}

function toAdminFeePolicy(
  r: Row,
  lifecycle: FeePolicyLifecycle,
  jobsUsing: number,
): AdminFeePolicy {
  return {
    id: r.id,
    code: r.code,
    name: r.name ?? r.code,
    currency: 'TRY',
    bps: r.bps,
    fixed: toMoney(r.fixedFeeMinor, r.currency),
    min: toMoneyOrNull(r.minFeeMinor, r.currency),
    max: toMoneyOrNull(r.maxFeeMinor, r.currency),
    effectiveFrom: r.effectiveFrom.toISOString(),
    lifecycle,
    scope: 'GLOBAL',
    isDevelopment: r.isDevelopment,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    publishedBy: r.publishedBy
      ? {
          id: r.publishedBy.id,
          name: `${r.publishedBy.firstName} ${r.publishedBy.lastName}`.trim(),
        }
      : null,
    retiredAt: r.retiredAt?.toISOString() ?? null,
    jobsUsing,
    createdAt: r.createdAt.toISOString(),
  };
}
