import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../common/auth/decorators.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { type WebhookResult, WebhooksService } from './webhooks.service.js';

/**
 * Payment provider webhooks. No user token: authenticity comes from the
 * provider signature over the raw body (app is created with rawBody).
 * 200 for processed and duplicate events, 401 for a bad signature or a
 * stale timestamp, 400 for a malformed body.
 */
@ApiExcludeController()
@Controller('webhooks/payments')
export class WebhooksController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly rateLimit: RateLimitService,
  ) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  async receive(@Param('provider') provider: string, @Req() req: Request): Promise<WebhookResult> {
    await this.rateLimit.enforceWithCode('WEBHOOK_RATE_LIMITED', {
      bucket: 'payment-webhook',
      subject: req.ip ?? 'unknown',
      limit: 600,
      windowSeconds: 60,
    });
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    return this.webhooks.handle(provider.slice(0, 40), raw, req.headers);
  }
}
