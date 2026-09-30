import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';
import type { ResponseStats } from '@ustago/types';

import { API_ENV } from '../config/env.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Dispatches younger than this are still "in flight" and not counted as missed. */
const SETTLE_HOURS = 24;
const WINDOW_DAYS = 90;

export interface RawResponseStats {
  dispatched: number;
  responded: number;
  medianMinutes: number | null;
}

/**
 * Real response data from request_dispatches (docs/adr/0028): how often and
 * how fast a provider quotes on requests sent to them. Shown to customers
 * ("Genellikle 12 dk içinde yanıt verir") only above RESPONSE_STATS_MIN_SAMPLE;
 * below it the answer is null and nothing is claimed.
 */
@Injectable()
export class ResponseStatsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async rawFor(providerIds: string[]): Promise<Map<string, RawResponseStats>> {
    const out = new Map<string, RawResponseStats>();
    if (providerIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<
      { providerId: string; dispatched: number; responded: number; median: number | null }[]
    >`
      SELECT provider_id AS "providerId",
             count(*)::int AS dispatched,
             count(responded_at)::int AS responded,
             (percentile_cont(0.5) WITHIN GROUP (
                ORDER BY extract(epoch FROM responded_at - dispatched_at) / 60.0)
              FILTER (WHERE responded_at IS NOT NULL))::float AS median
      FROM request_dispatches
      WHERE provider_id IN (${Prisma.join(providerIds.map((id) => Prisma.sql`${id}::uuid`))})
        AND dispatched_at > now() - make_interval(days => ${WINDOW_DAYS})
        AND (responded_at IS NOT NULL OR dispatched_at < now() - make_interval(hours => ${SETTLE_HOURS}))
      GROUP BY provider_id`;
    for (const r of rows) {
      out.set(r.providerId, {
        dispatched: r.dispatched,
        responded: r.responded,
        medianMinutes: r.median,
      });
    }
    return out;
  }

  /** Public stats, or null below the minimum sample. */
  toPublic(raw: RawResponseStats | undefined): ResponseStats | null {
    return publicResponseStats(raw, this.env.RESPONSE_STATS_MIN_SAMPLE);
  }

  async forProviders(providerIds: string[]): Promise<Map<string, ResponseStats | null>> {
    const raw = await this.rawFor(providerIds);
    return new Map(providerIds.map((id) => [id, this.toPublic(raw.get(id))]));
  }
}

export function publicResponseStats(
  raw: RawResponseStats | undefined,
  minSample: number,
): ResponseStats | null {
  if (!raw || raw.dispatched < minSample || raw.responded === 0 || raw.medianMinutes === null) {
    return null;
  }
  return {
    medianMinutes: Math.max(1, Math.round(raw.medianMinutes)),
    responseRatePercent: Math.round((raw.responded / raw.dispatched) * 100),
    sampleSize: raw.dispatched,
  };
}
