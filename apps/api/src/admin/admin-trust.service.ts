import { Injectable } from '@nestjs/common';
import type { AdminProvider360, CategoryRequirement, Money } from '@ustago/types';
import type { CategoryRequirementRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, notFound } from '../common/http/errors.js';
import { toMoney } from '../common/money.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { providerPolicy } from '../providers/domain/provider-policy.js';
import { WalletService } from '../finance/wallet.service.js';
import { SuspensionsService } from '../providers/suspensions.service.js';
import { AdminAuditService } from './admin-audit.service.js';

const RECENT = 10;

/**
 * Provider 360 and category document requirements (Faz 6, docs/adr/0023).
 * The 360 view runs a fixed set of queries in parallel, whatever the
 * provider's history size (no per-row lookups).
 */
@Injectable()
export class AdminTrustService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly auditLog: AdminAuditService,
    private readonly suspensions: SuspensionsService,
    private readonly wallet: WalletService,
  ) {}

  async provider360(providerId: string): Promise<AdminProvider360> {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { id: providerId },
      include: {
        user: { select: { firstName: true, lastName: true, phone: true, email: true } },
        verificationCase: { select: { status: true } },
        score: true,
      },
    });
    if (!profile) throw notFound('PROVIDER_NOT_FOUND', 'Usta bulunamadı.');

    const [
      suspensions,
      jobGroups,
      recentJobs,
      reviewGroups,
      reviewAvg,
      recentReviews,
      earningGroups,
      recentPayouts,
      destination,
      penalties,
      audit,
      balances,
    ] = await Promise.all([
      this.suspensions.list(providerId),
      this.prisma.job.groupBy({ by: ['status'], where: { providerId }, _count: { _all: true } }),
      this.prisma.job.findMany({
        where: { providerId },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
        select: {
          id: true,
          status: true,
          currentTotalMinor: true,
          currency: true,
          createdAt: true,
        },
      }),
      this.prisma.review.groupBy({
        by: ['status'],
        where: { targetId: profile.userId, direction: 'CUSTOMER_TO_PROVIDER' },
        _count: { _all: true },
      }),
      this.prisma.review.aggregate({
        where: {
          targetId: profile.userId,
          direction: 'CUSTOMER_TO_PROVIDER',
          status: 'PUBLISHED',
        },
        _avg: { rating: true },
      }),
      this.prisma.review.findMany({
        where: { targetId: profile.userId, direction: 'CUSTOMER_TO_PROVIDER' },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
        select: { id: true, rating: true, comment: true, status: true, createdAt: true },
      }),
      this.prisma.providerEarning.groupBy({
        by: ['status'],
        where: { providerId },
        _sum: { netMinor: true },
      }),
      this.prisma.payout.findMany({
        where: { providerId },
        orderBy: { createdAt: 'desc' },
        take: RECENT,
        select: { id: true, status: true, amountMinor: true, currency: true, createdAt: true },
      }),
      this.prisma.payoutDestination.findFirst({
        where: { providerId, deactivatedAt: null },
        select: { maskedIban: true, isTest: true, verificationStatus: true },
      }),
      this.prisma.disciplinaryAction.findMany({
        where: { subjectId: profile.userId, subjectRole: 'PROVIDER' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          type: true,
          status: true,
          reasonCode: true,
          startsAt: true,
          endsAt: true,
        },
      }),
      this.auditLog.list({ entityId: providerId, limit: 20 }),
      this.wallet.balancesOf(providerId),
    ]);

    const verificationStatus = profile.verificationCase?.status ?? 'NOT_STARTED';
    const policy = providerPolicy({
      applicationStatus: profile.status,
      verificationStatus,
      accountStatus: profile.accountStatus,
    });
    const byStatus: Record<string, number> = {};
    for (const g of jobGroups) byStatus[g.status] = g._count._all;
    const reviewCount = (status: string) =>
      reviewGroups.find((g) => g.status === status)?._count._all ?? 0;
    const earningsByStatus: Record<string, Money> = {};
    for (const g of earningGroups)
      earningsByStatus[g.status] = toMoney(g._sum.netMinor ?? 0n, 'TRY');

    return {
      providerId: profile.id,
      userId: profile.userId,
      displayName: profile.displayName,
      applicationStatus: profile.status,
      accountStatus: profile.accountStatus,
      verificationStatus,
      capabilities: policy,
      createdAt: profile.createdAt.toISOString(),
      contact: {
        name: `${profile.user.firstName} ${profile.user.lastName}`.trim(),
        phone: profile.user.phone,
        email: profile.user.email,
      },
      suspensions,
      jobs: {
        total: jobGroups.reduce((sum, g) => sum + g._count._all, 0),
        byStatus,
        recent: recentJobs.map((j) => ({
          id: j.id,
          status: j.status,
          currentTotal: toMoney(j.currentTotalMinor, j.currency),
          createdAt: j.createdAt.toISOString(),
        })),
      },
      reviews: {
        published: reviewCount('PUBLISHED'),
        hidden: reviewCount('HIDDEN') + reviewCount('UNDER_MODERATION'),
        average:
          reviewAvg._avg.rating === null ? null : Math.round(reviewAvg._avg.rating * 10) / 10,
        recent: recentReviews.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
        })),
      },
      quality: {
        ustaScore: profile.score ? Number(profile.score.score) : null,
        sampleSize: profile.score?.sampleSize ?? 0,
        isNewProvider: profile.score?.isNewProvider ?? true,
        computedAt: profile.score?.computedAt.toISOString() ?? null,
      },
      finance: {
        balances,
        earningsByStatus,
        recentPayouts: recentPayouts.map((p) => ({
          id: p.id,
          status: p.status,
          amount: toMoney(p.amountMinor, p.currency),
          createdAt: p.createdAt.toISOString(),
        })),
        destination,
      },
      penalties: penalties.map((p) => ({
        id: p.id,
        type: p.type,
        status: p.status,
        reasonCode: p.reasonCode,
        startsAt: p.startsAt.toISOString(),
        endsAt: p.endsAt?.toISOString() ?? null,
      })),
      audit: audit.items,
    };
  }

  // -------------------------------------------------------------------------
  // Category requirements
  // -------------------------------------------------------------------------

  async listRequirements(categoryId?: string): Promise<CategoryRequirement[]> {
    const rows = await this.prisma.categoryProviderRequirement.findMany({
      where: { deactivatedAt: null, ...(categoryId ? { categoryId } : {}) },
      orderBy: [{ categoryId: 'asc' }, { documentType: 'asc' }],
      include: { category: { select: { name: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      categoryId: r.categoryId,
      categoryName: r.category.name,
      documentType: r.documentType,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async addRequirement(
    actor: AuthUser,
    categoryId: string,
    input: CategoryRequirementRequest,
    ipAddress: string | null,
  ): Promise<CategoryRequirement> {
    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) throw notFound('CATEGORY_NOT_FOUND', 'Kategori bulunamadı.');
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const row = await tx.categoryProviderRequirement.create({
          data: {
            categoryId,
            documentType: input.documentType,
            note: input.note ?? null,
            createdById: actor.id,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'category.requirement_added',
          actorId: actor.id,
          entityType: 'service_category',
          entityId: categoryId,
          ipAddress,
          metadata: { requirementId: row.id, documentType: input.documentType },
        });
        return row.id;
      });
      const all = await this.listRequirements(categoryId);
      const created = all.find((r) => r.id === id);
      if (!created) throw notFound('CATEGORY_REQUIREMENT_NOT_FOUND', 'Kayıt bulunamadı.');
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('CATEGORY_REQUIREMENT_EXISTS', 'Bu belge bu kategori için zaten zorunlu.');
      }
      throw error;
    }
  }

  /** Soft delete: the row stays for the audit trail. */
  async removeRequirement(actor: AuthUser, id: string, ipAddress: string | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.categoryProviderRequirement.updateMany({
        where: { id, deactivatedAt: null },
        data: { deactivatedAt: new Date() },
      });
      if (updated.count === 0) {
        throw notFound('CATEGORY_REQUIREMENT_NOT_FOUND', 'Zorunlu belge kaydı bulunamadı.');
      }
      const row = await tx.categoryProviderRequirement.findUniqueOrThrow({ where: { id } });
      await this.audit.recordIn(tx, {
        action: 'category.requirement_removed',
        actorId: actor.id,
        entityType: 'service_category',
        entityId: row.categoryId,
        ipAddress,
        metadata: { requirementId: id, documentType: row.documentType },
      });
    });
  }
}
