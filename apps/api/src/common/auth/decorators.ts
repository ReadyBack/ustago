import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

import type { Role } from '../../generated/prisma/client.js';
import type { AuthUser } from './auth-user.js';
import { unauthorized } from '../http/errors.js';

export const IS_PUBLIC_KEY = 'ustago:isPublic';
export const ROLES_KEY = 'ustago:roles';

/** Opts a route out of the global JWT guard. Everything else needs a token. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Caller needs at least one of the roles. SUPER_ADMIN satisfies ADMIN. */
export const Roles = (...roles: [Role, ...Role[]]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw unauthorized('AUTH_REQUIRED', 'Oturum açmanız gerekiyor.');
  return user;
});

export type { AuthUser };
