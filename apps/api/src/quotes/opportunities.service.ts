import { Injectable } from '@nestjs/common';
import type { Opportunity, Paginated } from '@ustago/types';
import type { ListOpportunitiesQuery } from '@ustago/validation';

import type { AuthUser } from '../common/auth/auth-user.js';
import { forbidden, notFound } from '../common/http/errors.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { approxDistance } from '../geo/distance.js';
import { MatchingRepository } from '../matching/matching.repository.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ProviderStore } from '../providers/provider.store.js';
import { opportunityInclude, toOpportunity } from '../service-requests/service-request.mappers.js';

/**
 * "Sana Uygun İşler" (docs/adr/0014, 0028): requests a provider may quote
 * on. The list and every detail view run the live matching predicate;
 * guessing a request id gives the same 404 as a missing request. Distances
 * are approximate straight lines between district centres.
 */
@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderStore,
    private readonly matching: MatchingRepository,
    private readonly dispatch: DispatchService,
  ) {}

  async list(user: AuthUser, query: ListOpportunitiesQuery): Promise<Paginated<Opportunity>> {
    const provider = await this.activeProvider(user.id);
    const page = await this.matching.opportunities(provider.id, {
      limit: query.limit,
      sort: query.sort,
      ...(query.type ? { type: query.type } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.maxDistanceKm !== undefined ? { maxDistanceKm: query.maxDistanceKm } : {}),
      ...(query.dispatchedOnly ? { dispatchedOnly: true } : {}),
    });
    const ids = page.items.map((i) => i.id);
    const [rows, dispatches] = await Promise.all([
      this.prisma.serviceRequest.findMany({ where: { id: { in: ids } }, include: opportunityInclude }),
      this.prisma.requestDispatch.findMany({
        where: { providerId: provider.id, serviceRequestId: { in: ids } },
        select: { serviceRequestId: true, wave: true, dispatchedAt: true, viewedAt: true },
      }),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const dispatchBy = new Map(dispatches.map((d) => [d.serviceRequestId, d]));
    return {
      items: page.items.flatMap((item) => {
        const row = byId.get(item.id);
        return row
          ? [
              toOpportunity(row, null, {
                distance: approxDistance(item.distanceKm),
                dispatch: dispatchBy.get(item.id) ?? null,
                providerId: provider.id,
              }),
            ]
          : [];
      }),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Detail for a provider who may quote on the request now, or who already
   * has a quote on it (so "Tekliflerim" can open the job it is about).
   * Opening it marks the dispatch as viewed (first time only).
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
      await this.dispatch.markViewed(provider.id, requestId);
    }
    const [row, distanceKm, dispatch] = await Promise.all([
      this.prisma.serviceRequest.findUniqueOrThrow({
        where: { id: requestId },
        include: opportunityInclude,
      }),
      this.matching.distanceKm(this.prisma, provider.id, requestId),
      this.prisma.requestDispatch.findUnique({
        where: {
          serviceRequestId_providerId: { serviceRequestId: requestId, providerId: provider.id },
        },
        select: { wave: true, dispatchedAt: true, viewedAt: true },
      }),
    ]);
    return toOpportunity(row, myQuote?.id ?? null, {
      distance: approxDistance(distanceKm),
      dispatch,
      providerId: provider.id,
    });
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
