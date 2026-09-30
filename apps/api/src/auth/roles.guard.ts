import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROLES_KEY } from '../common/auth/decorators.js';
import { effectivePermissions, PERMISSIONS_KEY } from '../common/auth/permissions.js';
import { forbidden, unauthorized } from '../common/http/errors.js';
import type { AdminPermission, Role } from '../generated/prisma/client.js';

/** Roles implied by holding another role. */
const IMPLIED_ROLES: Partial<Record<Role, Role[]>> = {
  SUPER_ADMIN: ['ADMIN'],
};

export function effectiveRoles(roles: readonly Role[]): Set<Role> {
  const result = new Set<Role>(roles);
  for (const role of roles) {
    for (const implied of IMPLIED_ROLES[role] ?? []) result.add(implied);
  }
  return result;
}

/**
 * Runs after JwtAuthGuard and enforces @Roles(...) and, for admin routes,
 * @RequirePermission(...) on the route or class (docs/adr/0024).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    // The handler's permission list wins over the controller's.
    const permissions = this.reflector.getAllAndOverride<AdminPermission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if ((!required || required.length === 0) && (!permissions || permissions.length === 0)) {
      return true;
    }

    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw unauthorized('AUTH_REQUIRED', 'Oturum açmanız gerekiyor.');

    const held = effectiveRoles(user.roles);
    if (required && required.length > 0 && !required.some((role) => held.has(role))) {
      throw forbidden('FORBIDDEN', 'Bu işlem için yetkiniz yok.');
    }
    if (permissions && permissions.length > 0) {
      const granted = effectivePermissions(user.roles, user.permissions);
      if (!permissions.some((p) => granted.has(p))) {
        throw forbidden('ADMIN_PERMISSION_REQUIRED', 'Bu işlem için yönetici yetkiniz yok.', {
          required: permissions,
        });
      }
    }
    return true;
  }
}
