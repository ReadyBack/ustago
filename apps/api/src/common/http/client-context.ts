import type { Request } from 'express';

import type { ClientContext } from '../../auth/auth.service.js';

export function clientContext(req: Request): ClientContext {
  const userAgent = req.header('user-agent');
  return {
    ipAddress: req.ip ?? null,
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
