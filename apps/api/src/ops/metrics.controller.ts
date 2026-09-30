import { timingSafeEqual } from 'node:crypto';

import { Controller, Get, Header, Inject, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../common/auth/decorators.js';
import { notFound, unauthorized } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { metrics } from '../observability/metrics.js';

/**
 * Prometheus text metrics (docs/adr/0025). Production requires
 * METRICS_TOKEN (packages/config); labels never carry personal data.
 */
@ApiExcludeController()
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  scrape(@Req() req: Request): string {
    if (!this.env.METRICS_ENABLED) throw notFound('NOT_FOUND', 'Bulunamadı.');
    const token = this.env.METRICS_TOKEN;
    if (token) {
      const given = Buffer.from(req.header('authorization') ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
        throw unauthorized('METRICS_TOKEN_REQUIRED', 'Yetkisiz.');
      }
    }
    return metrics.render();
  }
}
