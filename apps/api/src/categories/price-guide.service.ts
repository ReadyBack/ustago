import { Inject, Injectable } from '@nestjs/common';
import type { PriceGuide } from '@ustago/types';

import { toMoney } from '../common/money.js';
import { notFound } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type PricePoint, priceStats } from './domain/price-stats.js';

export const PRICE_GUIDE_PERIOD_DAYS = 180;
/** Newest jobs read per scope; far above any threshold, bounds memory. */
const MAX_POINTS = 5000;

/**
 * "Bu işler genelde ₺X–₺Y" (Faz 7, docs/adr/0028) from REAL completed jobs
 * only: jobs of the category that reached COMPLETED in the last 180 days,
 * valued at `current_total_minor`, the final agreed total (agreed price
 * plus accepted change orders, maintained by the job/change-order flow).
 * Nothing is estimated or invented: below PRICE_GUIDE_MIN_SAMPLE jobs or
 * PRICE_GUIDE_MIN_PROVIDERS providers the answer is INSUFFICIENT_DATA.
 * The province is tried first, then the whole country. Outlier handling
 * and rounding: see domain/price-stats.ts.
 */
@Injectable()
export class PriceGuideService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async guide(categoryId: string, provinceId?: number): Promise<PriceGuide> {
    const category = await this.prisma.serviceCategory.findFirst({
      where: {
        id: categoryId,
        isActive: true,
        OR: [{ parentId: null }, { parent: { isActive: true } }],
      },
      select: { id: true },
    });
    if (!category) throw notFound('CATEGORY_NOT_FOUND', 'Kategori bulunamadı.');

    const thresholds = {
      minSample: this.env.PRICE_GUIDE_MIN_SAMPLE,
      minProviders: this.env.PRICE_GUIDE_MIN_PROVIDERS,
    };
    const scopes: { scope: 'PROVINCE' | 'COUNTRY'; provinceId?: number }[] =
      provinceId === undefined
        ? [{ scope: 'COUNTRY' }]
        : [{ scope: 'PROVINCE', provinceId }, { scope: 'COUNTRY' }];

    for (const s of scopes) {
      const stats = priceStats(await this.points(categoryId, s.provinceId), thresholds);
      if (stats.ok) {
        return {
          status: 'OK',
          scope: s.scope,
          p25: toMoney(BigInt(stats.p25Minor), 'TRY'),
          median: toMoney(BigInt(stats.medianMinor), 'TRY'),
          p75: toMoney(BigInt(stats.p75Minor), 'TRY'),
          sampleSizeFloor: stats.sampleSizeFloor,
          periodDays: PRICE_GUIDE_PERIOD_DAYS,
        };
      }
    }
    return { status: 'INSUFFICIENT_DATA', scope: 'COUNTRY', minSample: thresholds.minSample };
  }

  private async points(categoryId: string, provinceId?: number): Promise<PricePoint[]> {
    const province =
      provinceId === undefined ? Prisma.empty : Prisma.sql`AND r.province_id = ${provinceId}`;
    const rows = await this.prisma.$queryRaw<{ amount: bigint; providerId: string }[]>`
      SELECT j.current_total_minor AS amount, j.provider_id::text AS "providerId"
      FROM jobs j
      JOIN service_requests r ON r.id = j.service_request_id
      WHERE j.category_id = ${categoryId}::uuid
        AND j.status = 'COMPLETED'
        AND j.currency = 'TRY'
        AND j.completed_at >= now() - make_interval(days => ${PRICE_GUIDE_PERIOD_DAYS})
        ${province}
      ORDER BY j.completed_at DESC
      LIMIT ${MAX_POINTS}`;
    return rows.map((r) => ({ amountMinor: Number(r.amount), providerId: r.providerId }));
  }
}
