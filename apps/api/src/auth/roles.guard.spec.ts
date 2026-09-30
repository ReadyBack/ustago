import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthUser } from '../common/auth/auth-user.js';
import type { Role } from '../generated/prisma/client.js';
import { effectiveRoles, RolesGuard } from './roles.guard.js';

function contextFor(user: AuthUser | undefined): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(required: Role[] | undefined): RolesGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(required);
  return new RolesGuard(reflector);
}

const user = (roles: Role[]): AuthUser => ({ id: 'u', sessionId: 's', roles, permissions: [] });

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

  it('expands implied roles', () => {
    expect([...effectiveRoles(['SUPER_ADMIN'])].sort()).toEqual(['ADMIN', 'SUPER_ADMIN']);
    expect([...effectiveRoles(['CUSTOMER'])]).toEqual(['CUSTOMER']);
  });
});
