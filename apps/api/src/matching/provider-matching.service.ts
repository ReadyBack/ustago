import { Inject, Injectable } from '@nestjs/common';
import type { ApiEnv } from '@ustago/config';

import { AvailabilityEvaluator } from '../availability/availability-evaluator.js';
import { API_ENV } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MATCH_ALGORITHM_VERSION,
  type MatchScore,
  type MatchSignals,
  rankProviders,
} from './domain/match-score.js';
import { type CandidateRow, MatchingRepository } from './matching.repository.js';
import { ResponseStatsService } from './response-stats.service.js';

type Db = Prisma.TransactionClient | PrismaService;

export interface RankedCandidate extends MatchScore {
  userId: string;
  workingNow: boolean;
  areaFit: 'DISTRICT' | 'REGION';
}

/** Beyond this many km the distance line gives no points. */
const DISTANCE_HORIZON_KM = 50;
/** Safety bound on one candidate query (a province has far fewer active providers). */
const MAX_CANDIDATES = 5000;

/**
 * ProviderMatchingService (docs/adr/0028): eligible candidates from SQL
 * (who MAY take the request), then MATCH_V1 in TypeScript (who hears first).
 * Deterministic for the same data and time.
 */
@Injectable()
export class ProviderMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: MatchingRepository,
    private readonly responses: ResponseStatsService,
    private readonly availability: AvailabilityEvaluator,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  readonly algorithmVersion = MATCH_ALGORITHM_VERSION;

  async rank(
    requestId: string,
    opts: { excludeDispatched?: boolean; db?: Db; now?: Date } = {},
  ): Promise<RankedCandidate[]> {
    const started = process.hrtime.bigint();
    const db = opts.db ?? this.prisma;
    const now = opts.now ?? new Date();
    const rows = await this.repo.candidates(db, requestId, {
      limit: MAX_CANDIDATES,
      excludeDispatched: opts.excludeDispatched ?? false,
    });
    const [responses, availability] = await Promise.all([
      this.responses.rawFor(rows.map((r) => r.id)),
      this.availability.evaluate(rows, now, db),
    ]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const signals = rows.map((r) =>
      toSignals(r, responses.get(r.id) ?? null, availability.get(r.id)?.workingNow ?? false),
    );
    const ranked = rankProviders(signals, {
      now,
      coldStartDays: this.env.MATCH_COLD_START_DAYS,
      responseMinSample: this.env.RESPONSE_STATS_MIN_SAMPLE,
      distanceHorizonKm: DISTANCE_HORIZON_KM,
    });
    metrics.matchingDuration.observe(Number(process.hrtime.bigint() - started) / 1e9, {
      operation: 'rank',
    });
    return ranked.map((m) => {
      const row = byId.get(m.providerId);
      return {
        ...m,
        userId: row?.userId ?? '',
        areaFit: row?.areaFit ?? 'REGION',
        workingNow: availability.get(m.providerId)?.workingNow ?? false,
      };
    });
  }
}

function toSignals(
  r: CandidateRow,
  response: MatchSignals['response'],
  workingNow: boolean,
): MatchSignals {
  return {
    providerId: r.id,
    areaFit: r.areaFit,
    distanceKm: r.distanceKm,
    workingNow,
    ustaScore:
      r.score === null ? null : { score: r.score, isNewProvider: r.isNewProvider ?? true },
    response,
    completedJobs: r.completedJobs,
    providerCancelledJobs: r.providerCancelledJobs,
    attributableJobs: r.attributableJobs,
    lastActiveAt: r.lastActiveAt,
    approvedAt: r.approvedAt,
    verified: r.verified,
    accountLimited: r.accountLimited,
    visibilityReduced: r.visibilityReduced,
    activeWarnings: r.activeWarnings,
  };
}
