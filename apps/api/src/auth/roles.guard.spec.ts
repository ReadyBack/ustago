import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AdminPermission } from '@ustago/types';

import type { AuthUser } from '../common/auth/auth-user.js';
import { ROLES_KEY } from '../common/auth/decorators.js';
import { effectivePermissions, PERMISSIONS_KEY } from '../common/auth/permissions.js';
import type { Role } from '../generated/prisma/client.js';
import { effectiveRoles, RolesGuard } from './roles.guard.js';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(required: Role[] | undefined, permissions?: AdminPermission[]): RolesGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: unknown) =>
    key === ROLES_KEY ? required : key === PERMISSIONS_KEY ? permissions : undefined,
  );
  return new RolesGuard(reflector);
}

const user = (roles: Role[], permissions: AdminPermission[] = []): AuthUser => ({
  id: 'u',
  sessionId: 's',
  roles,
  permissions,
});

describe('RolesGuard', () => {
  it('allows routes without @Roles', () => {
    expect(guardRequiring(undefined).canActivate(contextFor(user(['CUSTOMER'])))).toBe(true);
  });

  it('allows a user holding one of the roles', () => {
    const guard = guardRequiring(['PROVIDER']);
    expect(guard.canActivate(contextFor(user(['CUSTOMER', 'PROVIDER'])))).toBe(true);
  });

  it('rejects a user without the role with FORBIDDEN', () => {
    const guard = guardRequiring(['ADMIN']);
    expect(() => guard.canActivate(contextFor(user(['CUSTOMER', 'PROVIDER'])))).toThrow(
      ForbiddenException,
    );
  });

  it('lets SUPER_ADMIN pass ADMIN routes but not the reverse', () => {
    expect(guardRequiring(['ADMIN']).canActivate(contextFor(user(['SUPER_ADMIN'])))).toBe(true);
    expect(() => guardRequiring(['SUPER_ADMIN']).canActivate(contextFor(user(['ADMIN'])))).toThrow(
      ForbiddenException,
    );
  });

  it('requires authentication when roles are required', () => {
    expect(() => guardRequiring(['ADMIN']).canActivate(contextFor(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('enforces @RequirePermission as any-of on top of the role', () => {
    const guard = guardRequiring(['ADMIN'], ['ADMIN_FINANCE']);
    expect(guard.canActivate(contextFor(user(['ADMIN'], ['ADMIN_FINANCE'])))).toBe(true);
    expect(() => guard.canActivate(contextFor(user(['ADMIN'], ['ADMIN_SUPPORT'])))).toThrow(
      ForbiddenException,
    );
    const either = guardRequiring(['ADMIN'], ['ADMIN_FINANCE', 'ADMIN_SUPPORT']);
    expect(either.canActivate(contextFor(user(['ADMIN'], ['ADMIN_SUPPORT'])))).toBe(true);
  });

  it('SUPER_ADMIN role and ADMIN_SUPER grant imply every permission; non-staff get none', () => {
    expect([...effectivePermissions(['SUPER_ADMIN'], [])].sort()).toEqual([
      'ADMIN_FINANCE',
      'ADMIN_SUPER',
      'ADMIN_SUPPORT',
      'ADMIN_VERIFICATION',
    ]);
    expect(effectivePermissions(['ADMIN'], ['ADMIN_SUPER']).size).toBe(4);
    expect([...effectivePermissions(['ADMIN'], ['ADMIN_FINANCE'])]).toEqual(['ADMIN_FINANCE']);
    expect(effectivePermissions(['CUSTOMER', 'PROVIDER'], ['ADMIN_SUPER']).size).toBe(0);
  });

  it('expands implied roles', () => {
    expect([...effectiveRoles(['SUPER_ADMIN'])].sort()).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect([...effectiveRoles(['CUSTOMER'])]).toEqual(['CUSTOMER']);
  });
});
