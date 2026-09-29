import { Prisma } from '../src/generated/prisma/client.js';
import { cleanup, createTestApp, type TestContext } from './helpers.js';

/** Database-level guarantees the domain relies on. */
describe('Schema constraints (e2e, real PostgreSQL)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.prisma.ledgerAccount.deleteMany({ where: { ownerKey: 'platform', currency: 'TRY' } });
    await cleanup(ctx);
    await ctx.app.close();
  });

  it('allows only one platform ledger account per type and currency', async () => {
    const data = { ownerKey: 'platform', type: 'PLATFORM_FEE_REVENUE', currency: 'TRY' } as const;
    await ctx.prisma.ledgerAccount.deleteMany({ where: data });
    await ctx.prisma.ledgerAccount.create({ data });
    const duplicate = ctx.prisma.ledgerAccount.create({ data });
    await expect(duplicate).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    await expect(duplicate).rejects.toMatchObject({ code: 'P2002' });
  });
});
