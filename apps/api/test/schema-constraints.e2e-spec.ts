import { Prisma } from '../src/generated/prisma/client.js';
import { cleanup, createTestApp, type TestContext } from './helpers.js';

/** Database-level guarantees the domain relies on. */
describe('Schema constraints (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('allows only one platform ledger account per type and currency', async () => {
    const data = { ownerKey: 'platform', type: 'PLATFORM_FEE_REVENUE', currency: 'TRY' } as const;
    // Platform accounts now carry ledger entries (Faz 5), so the row is
    // reused rather than deleted and recreated.
    const existing = await ctx.prisma.ledgerAccount.findFirst({ where: data });
    if (!existing) await ctx.prisma.ledgerAccount.create({ data });
    const duplicate = ctx.prisma.ledgerAccount.create({ data });
    await expect(duplicate).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
  });
});
