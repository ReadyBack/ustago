import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ROLES_KEY } from '../common/auth/decorators.js';
import { forbidden, unauthorized } from '../common/http/errors.js';
import type { Role } from '../generated/prisma/client.js';

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

/** Runs after JwtAuthGuard and enforces @Roles(...) on the route or class. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    if (!user) throw unauthorized('AUTH_REQUIRED', 'Oturum açmanız gerekiyor.');

    const held = effectiveRoles(user.roles);
    if (!required.some((role) => held.has(role))) {
      throw forbidden('FORBIDDEN', 'Bu işlem için yetkiniz yok.');
    }
    return true;
  }
}
