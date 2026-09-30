import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminDashboardStats,
  AdminServiceRequestDetail,
  AdminServiceRequestListItem,
  AdminSystemStatus,
  Paginated,
} from '@ustago/types';
import { type ListAdminServiceRequestsQuery, maskPhone } from '@ustago/validation';

import { notFound } from '../common/http/errors.js';
import { toMoney, toMoneyOrNull } from '../common/money.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { HealthService } from '../health/health.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { toQuoteRevision } from '../quotes/quote.mappers.js';
import { OPEN_STATUSES } from '../service-requests/domain/service-request-lifecycle.js';
import {
  adminListInclude,
  categoryRefSelect,
  fullName,
  toAdminListItem,
  toCategoryRef,
  toJobSummary,
  toLocation,
  toScheduleOption,
} from '../service-requests/service-request.mappers.js';

/**
 * Admin read models for the marketplace: dashboard counts straight from
 * the database, the service request list and detail, and a system status
 * page for local development. Nothing here writes.
 */
@Injectable()
export class AdminMarketplaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /**
   * "Today" starts at local midnight in `tz` (IANA, e.g. Europe/Istanbul);
   * PostgreSQL does the zone arithmetic, data stays in UTC.
   */
  async stats(tz?: string): Promise<AdminDashboardStats> {
    const timeZone = tz ?? this.env.MARKETPLACE_TIME_ZONE;
    const [dayStart] = await this.prisma.$queryRaw<{ start: Date }[]>`
      SELECT (date_trunc('day', now() AT TIME ZONE ${timeZone}) AT TIME ZONE ${timeZone}) AS start`;
    const open = { status: { in: [...OPEN_STATUSES] } };
    const [
      totalUsers,
      activeProviders,
      pendingProviders,
      openServiceRequests,
      openNowRequests,
      newServiceRequestsToday,
      jobsCreated,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.providerProfile.count({ where: { status: 'ACTIVE', deletedAt: null } }),
      this.prisma.providerProfile.count({ where: { status: 'PENDING_REVIEW', deletedAt: null } }),
      this.prisma.serviceRequest.count({ where: open }),
      this.prisma.serviceRequest.count({ where: { ...open, type: 'NOW' } }),
      this.prisma.serviceRequest.count({
        where: { createdAt: { gte: dayStart?.start ?? new Date() } },
      }),
      this.prisma.job.count(),
    ]);
    return {
      totalUsers,
      activeProviders,
      pendingProviders,
      openServiceRequests,
      openNowRequests,
      newServiceRequestsToday,
      jobsCreated,
      timeZone,
      generatedAt: new Date().toISOString(),
    };
  }

  async listRequests(
    query: ListAdminServiceRequestsQuery,
  ): Promise<Paginated<AdminServiceRequestListItem>> {
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.provinceId ? { provinceId: query.provinceId } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: adminListInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAdminListItem),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /**
   * Enough to moderate a request: masked phone, district and neighbourhood,
   * no street/building/door numbers or directions (docs/adr/0014).
   */
  async requestDetail(id: string): Promise<AdminServiceRequestDetail> {
    const r = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: {
        category: { select: categoryRefSelect },
        province: { select: { id: true, name: true } },
        district: { select: { id: true, name: true } },
        address: { select: { neighborhood: true } },
        customer: {
          select: { user: { select: { id: true, firstName: true, lastName: true, phone: true } } },
        },
        _count: { select: { photos: true } },
        quotes: {
          orderBy: { id: 'asc' },
          include: {
            revisions: { orderBy: { revisionNo: 'asc' } },
            provider: { select: { id: true, displayName: true } },
          },
        },
        job: {
          select: {
            id: true,
            status: true,
            agreedPriceMinor: true,
            currentTotalMinor: true,
            currency: true,
            createdAt: true,
            provider: { select: { id: true, displayName: true } },
          },
        },
      },
    });
    if (!r) throw notFound('SERVICE_REQUEST_NOT_FOUND', 'Talep bulunamadı.');
    const user = r.customer.user;
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      title: r.title,
      description: r.description,
      category: toCategoryRef(r.category),
      location: { ...toLocation(r), neighborhood: r.address.neighborhood },
      budget: toMoneyOrNull(r.budgetMinor, r.currency),
      budgetMax: toMoneyOrNull(r.budgetMaxMinor, r.currency),
      scheduleOption: toScheduleOption(r.scheduleOption),
      preferredStartAt: r.preferredStartAt?.toISOString() ?? null,
      preferredEndAt: r.preferredEndAt?.toISOString() ?? null,
      publishedAt: r.publishedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      photoCount: r._count.photos,
      customer: {
        id: user.id,
        name: fullName(user),
        maskedPhone: user.phone ? maskPhone(user.phone) : null,
      },
      quotes: r.quotes.map((q) => ({
        id: q.id,
        status: q.status,
        provider: { id: q.provider.id, displayName: q.provider.displayName },
        revisions: q.revisions.map(toQuoteRevision),
        acceptedRevisionId: q.acceptedRevisionId,
        createdAt: q.createdAt.toISOString(),
      })),
      job: r.job
        ? {
            ...toJobSummary(r.job),
            currentTotal: toMoney(r.job.currentTotalMinor, r.job.currency),
          }
        : null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  /** No secrets: driver names, environment and dependency state only. */
  async systemStatus(): Promise<AdminSystemStatus> {
    const health = await this.health.check();
    return {
      environment: this.env.APP_ENV,
      version: this.env.APP_VERSION,
      database: health.checks.database.status === 'up' ? 'up' : 'down',
      redis: health.checks.redis.status === 'up' ? 'up' : 'down',
      storageDriver: this.env.STORAGE_DRIVER,
      smsProvider: this.env.SMS_PROVIDER,
      swaggerEnabled: this.env.API_SWAGGER_ENABLED,
      corsOrigins: this.env.API_CORS_ORIGINS,
      checkedAt: new Date().toISOString(),
    };
  }
}
