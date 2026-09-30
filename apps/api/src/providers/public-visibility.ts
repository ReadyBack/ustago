import type { Prisma } from '../generated/prisma/client.js';

/**
 * A provider customers may see (Faz 6/7): approved (ACTIVE), account open
 * (ACTIVE or LIMITED, never SUSPENDED/BANNED), not deleted, and the user
 * account itself active. Everything else is a 404 on public endpoints.
 */
export const publiclyListedProviderWhere = {
  status: 'ACTIVE',
  accountStatus: { in: ['ACTIVE', 'LIMITED'] },
  deletedAt: null,
  user: { status: 'ACTIVE', deletedAt: null },
} satisfies Prisma.ProviderProfileWhereInput;
