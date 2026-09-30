import { Injectable } from '@nestjs/common';
import type { Opportunity, Paginated } from '@ustago/types';
import type { ListOpportunitiesQuery } from '@ustago/validation';

import type { AuthUser } from '../common/auth/auth-user.js';
import { forbidden, notFound } from '../common/http/errors.js';
import { MatchingRepository } from '../matching/matching.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderStore } from '../providers/provider.store.js';
import { opportunityInclude, toOpportunity } from '../service-requests/service-request.mappers.js';

/**
 * "Yeni İşler": requests a provider may quote on (docs/adr/0014). The list
 * and every detail view run the live matching predicate; guessing a
 * request id gives the same 404 as a missing request.
 */
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderStore,
    private readonly matching: MatchingRepository,
  ) {}

  async list(user: AuthUser, query: ListOpportunitiesQuery): Promise<Paginated<Opportunity>> {
    const provider = await this.activeProvider(user.id);
    const ids = await this.matching.opportunityIds(provider.id, {
      limit: query.limit + 1,
      ...(query.type ? { type: query.type } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    const pageIds = ids.slice(0, query.limit);
    const rows = await this.prisma.serviceRequest.findMany({
      where: { id: { in: pageIds } },
      include: opportunityInclude,
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return {
      items: pageIds.flatMap((id) => {
        const row = byId.get(id);
        return row ? [toOpportunity(row, null)] : [];
      }),
      nextCursor: ids.length > query.limit ? (pageIds.at(-1) ?? null) : null,
    };
  }

  /**
   * Detail for a provider who may quote on the request now, or who already
   * has a quote on it (so "Tekliflerim" can open the job it is about).
   */
  async get(user: AuthUser, requestId: string): Promise<Opportunity> {
    const provider = await this.providers.findByUserId(user.id);
    const myQuote = await this.prisma.quote.findUnique({
      where: {
        serviceRequestId_providerId: { serviceRequestId: requestId, providerId: provider.id },
      },
      select: { id: true },
    });
    if (!myQuote) {
      if (provider.status !== 'ACTIVE') throw notActive();
      if (!(await this.matching.isEligible(this.prisma, provider.id, requestId))) {
        throw notFound('OPPORTUNITY_NOT_FOUND', 'Bu iş size uygun değil veya artık açık değil.');
      }
    }
    const row = await this.prisma.serviceRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: opportunityInclude,
    });
    return toOpportunity(row, myQuote?.id ?? null);
  }

  private async activeProvider(userId: string) {
    const provider = await this.providers.findByUserId(userId);
    if (provider.status !== 'ACTIVE') throw notActive();
    return provider;
  }
}

const notActive = () =>
  forbidden(
    'PROVIDER_NOT_ACTIVE',
    'Bu özelliği kullanabilmek için usta hesabınızın onaylanması gerekiyor.',
  );
