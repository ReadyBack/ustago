import { SetMetadata } from '@nestjs/common';

import type { AdminPermission, Role } from '../../generated/prisma/client.js';

export const PERMISSIONS_KEY = 'ustago:permissions';

export const ALL_ADMIN_PERMISSIONS: readonly AdminPermission[] = [
  'ADMIN_SUPPORT',
  'ADMIN_VERIFICATION',
  'ADMIN_FINANCE',
  'ADMIN_SUPER',
];

/**
 * Caller needs at least one of the permissions (docs/adr/0024). Implies an
 * admin role: routes using it also carry @Roles('ADMIN'). SUPER_ADMIN (role)
 * and ADMIN_SUPER (grant) satisfy every permission.
 */
export const RequirePermission = (...permissions: [AdminPermission, ...AdminPermission[]]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** The permissions a caller effectively holds. */
export function effectivePermissions(
  roles: readonly Role[],
  grants: readonly AdminPermission[],
): Set<AdminPermission> {
  const isAdmin = roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
  if (!isAdmin) return new Set();
  if (roles.includes('SUPER_ADMIN') || grants.includes('ADMIN_SUPER')) {
    return new Set(ALL_ADMIN_PERMISSIONS);
  }
  return new Set(grants);
}

export function hasPermission(
  user: { roles: readonly Role[]; permissions: readonly AdminPermission[] },
  permission: AdminPermission,
): boolean {
  return effectivePermissions(user.roles, user.permissions).has(permission);
}
