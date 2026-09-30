import { createHmac } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import type { ClientContext } from '../../auth/auth.service.js';

/**
 * Faz 6 (docs/adr/0026): raw client IPs are personal data and are never
 * stored. A keyed HMAC of the address is enough for rate limits, abuse
 * signals and audit correlation, and cannot be reversed without the key.
 */
export function ipHashMiddleware(key: Buffer) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = req.ip;
    req.ipHash = ip ? hashIp(key, ip) : undefined;
    next();
  };
}

export function hashIp(key: Buffer, ip: string): string {
  return createHmac('sha256', key).update(ip.trim().toLowerCase()).digest('hex');
}

/** The caller's IP hash (64 hex chars), or null when unknown. */
export function clientIp(req: Request): string | null {
  return req.ipHash ?? null;
}

export function clientContext(req: Request): ClientContext {
  const userAgent = req.header('user-agent');
  return {
    ipAddress: clientIp(req),
    userAgent: userAgent ? userAgent.slice(0, 512) : null,
  };
}
