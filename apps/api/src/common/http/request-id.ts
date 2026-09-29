import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

const HEADER = 'x-request-id';
const SAFE_ID = /^[\w-]{8,64}$/;

/** Accepts a sane incoming X-Request-Id or creates one, and echoes it back. */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader(HEADER, id);
  next();
}
