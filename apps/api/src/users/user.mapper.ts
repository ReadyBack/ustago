import type { CurrentUser } from '@ustago/types';

import type { Prisma, Role } from '../generated/prisma/client.js';

/** Include used wherever a user is returned to a client. */
export const userWithProfiles = {
  include: {
    roles: { select: { role: true } },
    customerProfile: { select: { id: true } },
    providerProfile: { select: { id: true, status: true, displayName: true } },
  },
} satisfies Prisma.UserDefaultArgs;

export type UserWithProfiles = Prisma.UserGetPayload<typeof userWithProfiles>;

/** Stable role order in responses. */
const ROLE_ORDER: Role[] = ['CUSTOMER', 'PROVIDER', 'ADMIN', 'SUPER_ADMIN'];

export function sortRoles(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
}

/** Maps a database user to the public shape. Never exposes passwordHash. */
export function toCurrentUser(user: UserWithProfiles): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    locale: user.locale,
    roles: sortRoles(user.roles.map((r) => r.role)),
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    customerProfile: user.customerProfile ? { id: user.customerProfile.id } : null,
    providerProfile: user.providerProfile
      ? {
          id: user.providerProfile.id,
          status: user.providerProfile.status,
          displayName: user.providerProfile.displayName,
        }
      : null,
  };
}
