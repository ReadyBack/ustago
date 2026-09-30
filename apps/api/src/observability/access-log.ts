import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { metrics } from './metrics.js';

const logger = new Logger('HTTP');

/**
 * One structured line per request: requestId, route template, method,
 * status, duration and actor type. No query strings, bodies, IPs or user
 * ids (docs/adr/0026).
 */
export function accessLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const route = routeTemplate(req);
    const actorType = actorTypeOf(req);
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    metrics.httpRequests.inc({ route, method: req.method, status: statusClass });
    metrics.httpDuration.observe(durationMs / 1000, { route, method: req.method });
    if (route === '/api/v1/health/live' || route === '/api/v1/metrics') return;
    logger.log({
      msg: 'request',
      requestId: req.requestId,
      route,
      method: req.method,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      actorType,
    });
  });
  next();
}

function routeTemplate(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath === 'string') {
    const template = `${req.baseUrl}${routePath}`.slice(0, 120);
    // Wildcards and regex routes (e.g. the 404 catch-all) are not labels.
    return /^[\w:/{}.-]+$/.test(template) ? template : 'unmatched';
  }
  // Unmatched routes (404s) are collapsed so URLs never become labels.
  return 'unmatched';
}

function actorTypeOf(req: Request): string {
  const roles = req.user?.roles;
  if (!roles) return 'anonymous';
  if (roles.includes('SUPER_ADMIN') || roles.includes('ADMIN')) return 'admin';
  if (roles.includes('PROVIDER')) return 'provider';
  return 'customer';
}
