import type { Prisma } from '../generated/prisma/client.js';
import { FeePolicyService } from './fee-policy.service.js';
import type { FinanceConfig } from './finance.config.js';

function fakeTx() {
  const calls: unknown[] = [];
  const tx = {
    platformFeePolicy: {
      findFirst: (args: unknown) => {
        calls.push(args);
        return Promise.resolve(null);
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, calls };
}

describe('FeePolicyService.activeAt', () => {
  it('only published, not retired policies apply', async () => {
    const { tx, calls } = fakeTx();
    await new FeePolicyService({ strictEnv: false } as FinanceConfig).activeAt(tx, new Date());
    expect(calls[0]).toMatchObject({
      where: { publishedAt: { not: null }, retiredAt: null },
    });
    expect((calls[0] as { where: object }).where).not.toHaveProperty('isDevelopment');
  });

  it('staging/production never use a development policy', async () => {
    const { tx, calls } = fakeTx();
    await new FeePolicyService({ strictEnv: true } as FinanceConfig).activeAt(tx, new Date());
    expect(calls[0]).toMatchObject({ where: { isDevelopment: false } });
  });
});
