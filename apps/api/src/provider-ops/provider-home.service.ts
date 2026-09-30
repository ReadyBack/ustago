import { Injectable } from '@nestjs/common';
import type { ProviderHome } from '@ustago/types';

import { startOfLocalDay } from '../common/utils/local-time.js';
import { WalletService } from '../finance/wallet.service.js';
import { MatchingRepository } from '../matching/matching.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderStore } from '../providers/provider.store.js';
import { ProviderAvailabilityService } from './availability.service.js';
import { profileCompleteness } from './profile-completeness.js';

const ACTIVE_JOB_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'PROVIDER_PREPARING',
  'PROVIDER_EN_ROUTE',
  'PROVIDER_ARRIVED',
  'IN_PROGRESS',
  'AWAITING_COMPLETION_CONFIRMATION',
  'DISPUTED',
] as const;

/** Upper bound for the "açık fırsatlar" count query. */
const OPPORTUNITY_COUNT_CAP = 100;

/**
 * GET /providers/me/home: live counts only (docs/adr/0028). Money comes
 * from the ledger (Faz 5); nothing here is estimated.
 */
@Injectable()
export class ProviderHomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: ProviderStore,
    private readonly availability: ProviderAvailabilityService,
    private readonly matching: MatchingRepository,
    private readonly wallet: WalletService,
  ) {}

  async home(userId: string, now = new Date()): Promise<ProviderHome> {
    const profile = await this.store.findByUserId(userId);
    const id = profile.id;
    const todayStart = startOfLocalDay(now, this.availability.timeZone);
    const [
      availability,
      newMatchingJobs,
      opportunities,
      activeJobs,
      pendingQuotes,
      unread,
      today,
      balances,
      verification,
      counts,
    ] = await Promise.all([
      this.availability.view(id, now),
      this.prisma.requestDispatch.count({
        where: {
          providerId: id,
          viewedAt: null,
          result: 'PENDING',
          serviceRequest: {
            status: { in: ['PUBLISHED', 'MATCHING', 'QUOTED'] },
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        },
      }),
      profile.status === 'ACTIVE'
        ? this.matching.opportunities(id, { limit: OPPORTUNITY_COUNT_CAP })
        : Promise.resolve({ items: [], nextCursor: null }),
      this.prisma.job.count({ where: { providerId: id, status: { in: [...ACTIVE_JOB_STATUSES] } } }),
      this.prisma.quote.count({
        where: { providerId: id, status: { in: ['PENDING_CUSTOMER', 'PENDING_PROVIDER'] } },
      }),
      this.unreadMessages(userId),
      this.prisma.providerEarning.aggregate({
        where: { providerId: id, createdAt: { gte: todayStart } },
        _sum: { netMinor: true },
      }),
      this.wallet.balancesOf(id),
      this.prisma.providerVerificationCase.findUnique({
        where: { providerId: id },
        select: { status: true },
      }),
      this.prisma.providerProfile.findUniqueOrThrow({
        where: { id },
        select: {
          photoStorageKey: true,
          bio: true,
          serviceCenterDistrictId: true,
          _count: {
            select: {
              services: true,
              serviceAreas: true,
              serviceRegions: { where: { active: true } },
              portfolioItems: { where: { deletedAt: null } },
              weeklyHours: true,
            },
          },
        },
      }),
    ]);
    return {
      availability,
      newMatchingJobs,
      openOpportunities: opportunities.items.length,
      activeJobs,
      pendingQuotes,
      unreadMessages: unread,
      todayEarningsMinor: Number(today._sum.netMinor ?? 0n),
      availableBalanceMinor: balances.withdrawable.amountMinor,
      verificationStatus: verification?.status ?? 'NOT_STARTED',
      profileCompleteness: profileCompleteness({
        hasPhoto: counts.photoStorageKey !== null,
        bioLength: counts.bio?.trim().length ?? 0,
        serviceCount: counts._count.services,
        areaCount: counts._count.serviceAreas + counts._count.serviceRegions,
        portfolioCount: counts._count.portfolioItems,
        weeklyHoursCount: counts._count.weeklyHours,
        hasServiceCenter: counts.serviceCenterDistrictId !== null,
        verified: verification?.status === 'VERIFIED',
      }),
    };
  }

  /** Messages from the other side after my read marker (docs/adr/0030). */
  private async unreadMessages(userId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM conversation_participants cp
      JOIN messages m ON m.conversation_id = cp.conversation_id
      WHERE cp.user_id = ${userId}::uuid
        AND m.type <> 'SYSTEM' AND m.deleted_at IS NULL
        AND m.sender_id IS DISTINCT FROM cp.user_id
        AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)`;
    return rows[0]?.n ?? 0;
  }
}
