import {
  providerStatusSchema,
  providerTypeSchema,
  roleSchema,
  userStatusSchema,
} from '@ustago/validation';

import { ProviderStatus, ProviderType, Role, UserStatus } from '../generated/prisma/client.js';

/** Shared client schemas must stay in sync with the database enums. */
describe('enum parity between Prisma and @ustago/validation', () => {
  it.each([
    ['Role', Role, roleSchema.options],
    ['UserStatus', UserStatus, userStatusSchema.options],
    ['ProviderStatus', ProviderStatus, providerStatusSchema.options],
    ['ProviderType', ProviderType, providerTypeSchema.options],
  ])('%s', (_name, prismaEnum, shared) => {
    expect([...shared].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});
