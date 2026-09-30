import type { AdminPermission, Role } from '../../generated/prisma/client.js';

/** The authenticated caller, attached to the request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  sessionId: string;
  roles: Role[];
  /**
   * Admin permission grants (Faz 6, docs/adr/0024). Empty for non-admins.
   * A SUPER_ADMIN role or an ADMIN_SUPER grant implies every permission.
   */
  permissions: AdminPermission[];
}

declare global {
  // Express exposes request augmentation only through this global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
      /** HMAC of the client IP (common/http/client-context.ts). */
      ipHash?: string;
      /** Set by the access log once the route is known. */
      startedAt?: bigint;
    }
  }
}
