import type { PrismaClient } from '../generated/prisma/client.js';

/** Development / demo fee policy: 15 %. NOT a commercial decision. */
export const DEV_FEE_POLICY = {
  code: 'DEV-DEFAULT-1500',
  bps: 1500,
  effectiveFrom: new Date('2020-01-01T00:00:00Z'),
  note: 'Geliştirme/demo varsayılanı (%15). Nihai ticari oran değildir; üretimde admin belirler.',
} as const;

/**
 * Idempotent. Only for development, demo and tests: production gets no
 * fee policy from the seed, so online payments stay closed
 * (FEE_POLICY_MISSING) until one is configured on purpose.
 */
export async function ensureDevFeePolicy(prisma: PrismaClient): Promise<boolean> {
  const existing = await prisma.platformFeePolicy.findUnique({
    where: { code: DEV_FEE_POLICY.code },
  });
  if (existing) return false;
  // Published at once (Faz 6 lifecycle): development only. Staging and
  // production never use development policies (FeePolicyService).
  await prisma.platformFeePolicy.create({
    data: {
      code: DEV_FEE_POLICY.code,
      name: 'Geliştirme varsayılanı %15 (DEMO)',
      bps: DEV_FEE_POLICY.bps,
      effectiveFrom: DEV_FEE_POLICY.effectiveFrom,
      isDevelopment: true,
      note: DEV_FEE_POLICY.note,
      publishedAt: DEV_FEE_POLICY.effectiveFrom,
    },
  });
  return true;
}
