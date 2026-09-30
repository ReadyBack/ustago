import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';

import { API_ENV } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type AvailabilityResult, computeAvailability } from '../providers/domain/availability.js';

type Db = Prisma.TransactionClient | PrismaService;

export interface AvailabilitySubject {
  id: string;
  acceptingNewJobs: boolean;
  unavailableUntil: Date | null;
}

/**
 * Bulk availability evaluation (docs/adr/0031) shared by matching,
 * dispatch, discovery, the provider screens and the public profile: two
 * queries for any number of providers, then the pure `computeAvailability`.
 */
@Injectable()
export class AvailabilityEvaluator {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  get timeZone(): string {
    return this.env.MARKETPLACE_TIME_ZONE;
  }

  async evaluate(
    providers: readonly AvailabilitySubject[],
    now = new Date(),
    db: Db = this.prisma,
  ): Promise<Map<string, AvailabilityResult>> {
    const out = new Map<string, AvailabilityResult>();
    if (providers.length === 0) return out;
    const ids = providers.map((p) => p.id);
    const [hours, timeOff] = await Promise.all([
      db.providerWeeklyHours.findMany({
        where: { providerId: { in: ids } },
        select: { providerId: true, weekday: true, startMinute: true, endMinute: true },
      }),
      db.providerTimeOff.findMany({
        where: {
          providerId: { in: ids },
          cancelledAt: null,
          startsAt: { lte: now },
          endsAt: { gt: now },
        },
        select: { providerId: true, startsAt: true, endsAt: true },
      }),
    ]);
    const hoursBy = groupBy(hours, (h) => h.providerId);
    const offBy = groupBy(timeOff, (t) => t.providerId);
    for (const p of providers) {
      out.set(
        p.id,
        computeAvailability({
          acceptingNewJobs: p.acceptingNewJobs,
          unavailableUntil: p.unavailableUntil,
          weeklyHours: hoursBy.get(p.id) ?? [],
          timeOff: offBy.get(p.id) ?? [],
          now,
          timeZone: this.timeZone,
        }),
      );
    }
    return out;
  }
}

function groupBy<T, K>(rows: readonly T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}
