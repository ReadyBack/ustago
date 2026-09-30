import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PenaltyWindow } from './domain/penalty-policy.js';
import type { QualityInputs } from './domain/usta-score.js';

type Db = Prisma.TransactionClient | PrismaService;

export interface ProviderQualityInputs extends QualityInputs {
  providerId: string;
  userId: string;
  customerCancelledJobs: number;
  openDisputes: number;
}

/**
 * Loads UstaScore inputs for many providers with a fixed number of
 * aggregate queries (no per-provider COUNTs, so no N+1 on lists).
 */
@Injectable()
export class QualityRepository {
  async load(db: Db, providerIds: readonly string[]): Promise<Map<string, ProviderQualityInputs>> {
    const ids = [...new Set(providerIds)];
    if (ids.length === 0) return new Map();
    const providers = await db.providerProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, userId: true, yearsOfExperience: true },
    });
    const userIds = providers.map((p) => p.userId);

    const [reviews, jobs, disputes, verifications, responses, penalties] = await Promise.all([
      db.review.groupBy({
        by: ['targetId'],
        where: { targetId: { in: userIds }, direction: 'CUSTOMER_TO_PROVIDER', status: 'PUBLISHED' },
        _count: { _all: true },
        _sum: { rating: true },
      }),
      db.job.groupBy({
        by: ['providerId', 'status', 'cancellationActor'],
        where: { providerId: { in: ids } },
        _count: { _all: true },
      }),
      db.$queryRaw<{ providerId: string; status: string; jobs: number }[]>`
        SELECT j.provider_id AS "providerId", d.status::text AS status,
               COUNT(DISTINCT d.job_id)::int AS jobs
        FROM disputes d JOIN jobs j ON j.id = d.job_id
        WHERE j.provider_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        GROUP BY j.provider_id, d.status`,
      db.providerVerification.findMany({
        where: {
          providerId: { in: ids },
          status: 'APPROVED',
          type: { in: ['IDENTITY', 'PROFESSIONAL_CERTIFICATE'] },
        },
        select: { providerId: true, type: true },
      }),
      // Real replies only: the provider's next move after a customer's
      // counter offer, either a counter of their own or accepting it.
      db.$queryRaw<{ providerId: string; median: number | null; samples: number }[]>`
        WITH replies AS (
          SELECT q.provider_id, EXTRACT(EPOCH FROM (nxt.created_at - cur.created_at)) AS seconds
          FROM quote_revisions cur
          JOIN quotes q ON q.id = cur.quote_id
          JOIN quote_revisions nxt
            ON nxt.quote_id = cur.quote_id AND nxt.revision_no = cur.revision_no + 1
          WHERE cur.kind = 'CUSTOMER_COUNTER' AND nxt.kind = 'PROVIDER_COUNTER'
          UNION ALL
          SELECT q.provider_id, EXTRACT(EPOCH FROM (q.accepted_at - cur.created_at))
          FROM quotes q
          JOIN quote_revisions cur ON cur.id = q.accepted_revision_id
          WHERE cur.kind = 'CUSTOMER_COUNTER' AND q.accepted_at IS NOT NULL
        )
        SELECT provider_id AS "providerId",
               percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds)::float8 AS median,
               COUNT(*)::int AS samples
        FROM replies
        WHERE provider_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        GROUP BY provider_id`,
      db.disciplinaryAction.findMany({
        where: { subjectId: { in: userIds }, subjectRole: 'PROVIDER' },
        select: { subjectId: true, type: true, status: true, startsAt: true, endsAt: true },
      }),
    ]);

    const reviewsBy = new Map(reviews.map((r) => [r.targetId, r]));
    const responsesBy = new Map(responses.map((r) => [r.providerId, r]));
    const out = new Map<string, ProviderQualityInputs>();
    for (const p of providers) {
      const jobRows = jobs.filter((j) => j.providerId === p.id);
      const count = (pred: (j: (typeof jobRows)[number]) => boolean) =>
        jobRows.filter(pred).reduce((s, j) => s + j._count._all, 0);
      const disputeRows = disputes.filter((d) => d.providerId === p.id);
      const disputeCount = (statuses: readonly string[]) =>
        disputeRows.filter((d) => statuses.includes(d.status)).reduce((s, d) => s + d.jobs, 0);
      const review = reviewsBy.get(p.userId);
      const response = responsesBy.get(p.id);
      const penaltyRows: PenaltyWindow[] = penalties
        .filter((x) => x.subjectId === p.userId)
        .map((x) => ({ type: x.type, status: x.status, startsAt: x.startsAt, endsAt: x.endsAt }));

      out.set(p.id, {
        providerId: p.id,
        userId: p.userId,
        reviewCount: review?._count._all ?? 0,
        reviewRatingSum: review?._sum.rating ?? 0,
        completedJobs: count((j) => j.status === 'COMPLETED'),
        providerCancelledJobs: count(
          (j) => j.status === 'CANCELLED' && j.cancellationActor === 'PROVIDER',
        ),
        customerCancelledJobs: count(
          (j) => j.status === 'CANCELLED' && j.cancellationActor === 'CUSTOMER',
        ),
        attributableJobs: count(
          (j) => j.status !== 'CANCELLED' || j.cancellationActor === 'PROVIDER',
        ),
        decidedDisputedJobs: disputeCount([
          'RESOLVED_FOR_CUSTOMER',
          'RESOLVED_FOR_PROVIDER',
          'RESOLVED_PARTIAL',
          'CLOSED',
        ]),
        disputesForCustomer: disputeCount(['RESOLVED_FOR_CUSTOMER']),
        disputesPartial: disputeCount(['RESOLVED_PARTIAL']),
        openDisputes: disputeCount(['OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW']),
        responseMedianSeconds: response?.median ?? null,
        responseSamples: response?.samples ?? 0,
        identityVerified: verifications.some((v) => v.providerId === p.id && v.type === 'IDENTITY'),
        certificateVerified: verifications.some(
          (v) => v.providerId === p.id && v.type === 'PROFESSIONAL_CERTIFICATE',
        ),
        yearsOfExperience: p.yearsOfExperience,
        penalties: penaltyRows,
      });
    }
    return out;
  }
}
