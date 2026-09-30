import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { computeUstaScore, USTA_SCORE_VERSION } from './domain/usta-score.js';
import { QualityRepository } from './quality.repository.js';

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Recomputes UstaScore V1 for the given providers and upserts their
 * snapshots (provider_scores). Used by QualityService inside business
 * transactions and by the development seed.
 */
export async function writeQualitySnapshots(
  db: Db,
  repo: QualityRepository,
  providerIds: readonly string[],
  now = new Date(),
): Promise<void> {
  const inputs = await repo.load(db, providerIds);
  for (const [providerId, input] of inputs) {
    const result = computeUstaScore(input, now);
    const data = {
      score: (result.score ?? 0).toFixed(2),
      sampleSize: result.sampleSize,
      isNewProvider: result.isNewProvider,
      components: {
        factors: result.factors.map((f) => ({
          key: f.key,
          weight: f.weight,
          effectiveWeight: f.effectiveWeight,
          score: f.score,
        })),
        penaltyPoints: result.penaltyPoints,
        available: result.score !== null,
      },
      algorithmVersion: USTA_SCORE_VERSION,
      computedAt: now,
    };
    await db.providerScore.upsert({
      where: { providerId },
      create: { providerId, ...data },
      update: data,
    });
  }
}
