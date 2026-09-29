import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

import type { Role } from '../../generated/prisma/client.js';
import type { AuthUser } from './auth-user.js';
import { unauthorized } from '../http/errors.js';

export const IS_PUBLIC_KEY = 'ustago:isPublic';
export const ROLES_KEY = 'ustago:roles';
export const OPTIONAL_AUTH_KEY = 'ustago:optionalAuth';

/** Opts a route out of the global JWT guard. Everything else needs a token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Route works without a token, but a token that is sent must be valid and
 * then identifies the caller (e.g. OTP: VERIFY_PHONE needs a signed-in user,
 * REGISTER_OR_LOGIN does not).
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);

/** Caller needs at least one of the roles. SUPER_ADMIN satisfies ADMIN. */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw unauthorized('AUTH_REQUIRED', 'Oturum açmanız gerekiyor.');
  return user;
});

/** The caller when the route is @OptionalAuth(), or undefined. */
export const MaybeCurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined =>
    ctx.switchToHttp().getRequest<Request>().user,
);

export type { AuthUser };
