import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminPayout, Payment } from '@ustago/types';
import {
  adminPayoutSchema,
  apiErrorResponseSchema,
  paymentSchema,
  type SimulatePayment,
  simulatePaymentSchema,
  uuidSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { notFound } from '../common/http/errors.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DevFinanceGuard } from './dev-finance.guard.js';
import { PaymentsService } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.js';
import { WebhooksService } from './webhooks.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const ip = (req: Request) => req.ip ?? null;

/**
 * DEVELOPMENT ONLY (mock providers). Plays the part of the payment
 * provider's test page and of the bank: the decision travels the same
 * signed-webhook path a real provider would use. Guarded fail-closed:
 * 404 unless development + mock provider.
 */
@ApiTags('dev: finance (yalnızca geliştirme)')
@ApiBearerAuth()
@UseGuards(DevFinanceGuard)
@Controller()
export class DevFinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly webhooks: WebhooksService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  @Post('dev/payments/:id/simulate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'TEST ÖDEMESİ: bekleyen denemeyi SUCCESS / CARD_DECLINED / TIMEOUT / PROVIDER_ERROR / CANCELLED ' +
      'olarak sonuçlandırır (imzalı webhook ile). Yalnızca ödeyen müşteri.',
  })
  @ApiZodBody(simulatePaymentSchema)
  @ApiZodResponse(200, paymentSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PAYMENT_NOT_FOUND / ROUTE_NOT_FOUND')
  async simulate(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(simulatePaymentSchema)) body: SimulatePayment,
  ): Promise<Payment> {
    if (!(this.provider instanceof MockPaymentProvider)) {
      throw notFound('ROUTE_NOT_FOUND', 'Kaynak bulunamadı.');
    }
    const { payment, attempt } = await this.payments.pendingAttemptForPayer(user.id, id);
    const event = this.provider.simulate(
      attempt.gatewayTransactionId ?? '',
      body.outcome,
      payment.amountMinor,
    );
    await this.webhooks.handle(this.provider.name, event.rawBody, event.headers);
    return this.payments.paymentView(id);
  }

  @Post('admin/dev/payouts/:id/mark-paid')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'TEST: işlemdeki para çekme talebini "ödendi" yapar. Gerçek transfer yoktur.',
  })
  @ApiZodResponse(200, adminPayoutSchema)
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<AdminPayout> {
    return this.payouts.markTestPaid(user.id, id, ip(req));
  }

  @Post('admin/dev/payouts/:id/mark-failed')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'TEST: işlemdeki para çekme talebini başarısız yapar; tutar bakiyeye döner.',
  })
  @ApiZodResponse(200, adminPayoutSchema)
  markFailed(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<AdminPayout> {
    return this.payouts.markTestFailed(user.id, id, ip(req));
  }
}
