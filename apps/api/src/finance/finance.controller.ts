import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  JobPaymentSummary,
  MyPaymentDetail,
  MyPaymentListItem,
  Paginated,
  Payment,
  Payout,
  PayoutDestination,
  ProviderEarning,
  Wallet,
  WalletLine,
} from '@ustago/types';
import {
  apiErrorResponseSchema,
  type CashDispute,
  cashDisputeSchema,
  type ChoosePaymentMethod,
  choosePaymentMethodSchema,
  jobPaymentSummarySchema,
  type ListMyPaymentsQuery,
  listMyPaymentsQuerySchema,
  type ListWalletQuery,
  listWalletQuerySchema,
  myPaymentDetailSchema,
  myPaymentListItemSchema,
  paginatedSchema,
  paymentSchema,
  payoutDestinationSchema,
  type PayoutDestinationRequest,
  payoutDestinationRequestSchema,
  type PayoutRequest,
  payoutRequestSchema,
  payoutSchema,
  providerEarningSchema,
  uuidSchema,
  walletLineSchema,
  walletSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser } from '../common/auth/decorators.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CashService } from './cash.service.js';
import { IDEMPOTENCY_HEADER, idempotencyKeyFrom } from './idempotency.js';
import { PaymentsService } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';
import { WalletService } from './wallet.service.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const ip = (req: Request) => req.ip ?? null;

const IdempotencyHeader = () =>
  ApiHeader({
    name: IDEMPOTENCY_HEADER,
    required: true,
    description: 'İstemcinin ürettiği tekil anahtar (8-80 karakter, A-Z a-z 0-9 _ -). Tekrarı aynı sonucu döner.',
  });

/**
 * Customer payments and provider wallet (Faz 5, docs/adr/0018-0020).
 * Every amount comes from the server (job's current total); the client
 * never sends a payable amount. Other people's jobs, payments and
 * payouts answer 404.
 */
@ApiTags('finance')
@ApiBearerAuth()
@Controller()
export class FinanceController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly cash: CashService,
    private readonly wallet: WalletService,
    private readonly payouts: PayoutsService,
  ) {}

  // -------------------------------------------------------------------------
  // Customer: paying a job
  // -------------------------------------------------------------------------

  @Get('jobs/:id/payment-summary')
  @ApiOperation({
    summary:
      'İşin ödeme kartı: güncel toplam, ödenen, kalan, yöntem, nakit onay durumu ve yapılabilecek işlemler. ' +
      'Ustaya platform ücreti ve net kazanç kırılımı da döner.',
  })
  @ApiZodResponse(200, jobPaymentSummarySchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND')
  summary(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<JobPaymentSummary> {
    return this.payments.summary(user.id, id);
  }

  @Put('jobs/:id/payment-method')
  @ApiOperation({ summary: 'Müşteri ödeme yöntemini seçer: IN_APP (Uygulamadan öde) veya CASH.' })
  @ApiZodBody(choosePaymentMethodSchema)
  @ApiZodResponse(200, jobPaymentSummarySchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'PAYMENT_WRONG_PARTY')
  @ApiZodResponse(409, apiErrorResponseSchema, 'PAYMENT_METHOD_LOCKED')
  @ApiZodResponse(503, apiErrorResponseSchema, 'PAYMENTS_DISABLED / CASH_DISABLED')
  chooseMethod(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(choosePaymentMethodSchema)) body: ChoosePaymentMethod,
    @Req() req: Request,
  ): Promise<JobPaymentSummary> {
    return this.payments.chooseMethod(user, id, body.method, ip(req));
  }

  @Post('jobs/:id/payments')
  @HttpCode(HttpStatus.OK)
  @IdempotencyHeader()
  @ApiOperation({
    summary:
      'Uygulamadan ödeme başlatır. Tutar sunucuda hesaplanır (güncel toplam − ödenen). ' +
      'Aynı Idempotency-Key aynı ödemeyi döner; sonuç sağlayıcı webhook’u ile kesinleşir.',
  })
  @ApiZodResponse(200, paymentSchema)
  @ApiZodResponse(400, apiErrorResponseSchema, 'IDEMPOTENCY_KEY_REQUIRED')
  @ApiZodResponse(403, apiErrorResponseSchema, 'PAYMENT_WRONG_PARTY')
  @ApiZodResponse(404, apiErrorResponseSchema, 'JOB_NOT_FOUND')
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'PAYMENT_NOT_ALLOWED / PAYMENT_NOTHING_DUE / PAYMENT_METHOD_IS_CASH / IDEMPOTENCY_KEY_REUSED',
  )
  @ApiZodResponse(429, apiErrorResponseSchema, 'FINANCE_RATE_LIMITED')
  createPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<Payment> {
    return this.payments.create(user, id, idempotencyKeyFrom(req), ip(req));
  }

  @Post('jobs/:id/cash/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Nakit ödeme onayı: müşteri "ödedim", usta "aldım". İki taraf onaylayınca CONFIRMED olur; ' +
      'açıksa usta için platform ücreti borcu yazılır.',
  })
  @ApiZodResponse(200, jobPaymentSummarySchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'CASH_NOT_SELECTED / CASH_NOT_ALLOWED / CASH_INVALID_STATE')
  confirmCash(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<JobPaymentSummary> {
    return this.cash.confirm(user, id, ip(req));
  }

  @Post('jobs/:id/cash/dispute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Nakit ödeme için anlaşmazlık bildirir; admin inceler.' })
  @ApiZodBody(cashDisputeSchema)
  @ApiZodResponse(200, jobPaymentSummarySchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'CASH_INVALID_STATE')
  disputeCash(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(cashDisputeSchema)) body: CashDispute,
    @Req() req: Request,
  ): Promise<JobPaymentSummary> {
    return this.cash.dispute(user, id, body, ip(req));
  }

  @Get('me/payments')
  @ApiOperation({ summary: 'Ödemelerim: müşterinin çevrim içi ve nakit ödemeleri (yeniden eskiye).' })
  @ApiZodResponse(200, paginatedSchema(myPaymentListItemSchema))
  myPayments(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listMyPaymentsQuerySchema)) query: ListMyPaymentsQuery,
  ): Promise<Paginated<MyPaymentListItem>> {
    return this.payments.myPayments(user.id, query);
  }

  @Get('me/payments/:id')
  @ApiOperation({ summary: 'Ödeme Özeti (fatura değildir).' })
  @ApiZodResponse(200, myPaymentDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PAYMENT_NOT_FOUND')
  myPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
  ): Promise<MyPaymentDetail> {
    return this.payments.myPayment(user.id, id);
  }

  // -------------------------------------------------------------------------
  // Provider: wallet and payouts
  // -------------------------------------------------------------------------

  @Get('me/wallet')
  @ApiOperation({
    summary:
      'Kazançlarım: bekleyen, çekilebilir, ayrılmış bakiye ve platform borcu (defterden hesaplanır), ' +
      'bu ay ve son 30 gün özeti.',
  })
  @ApiZodResponse(200, walletSchema)
  @ApiZodResponse(403, apiErrorResponseSchema, 'PROVIDER_ONLY')
  getWallet(@CurrentUser() user: AuthUser): Promise<Wallet> {
    return this.wallet.wallet(user.id);
  }

  @Get('me/wallet/transactions')
  @ApiOperation({ summary: 'Cüzdan hareketleri (defter satırları, yeniden eskiye).' })
  @ApiZodResponse(200, paginatedSchema(walletLineSchema))
  walletTransactions(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listWalletQuerySchema)) query: ListWalletQuery,
  ): Promise<Paginated<WalletLine>> {
    return this.wallet.transactions(user.id, query);
  }

  @Get('me/earnings')
  @ApiOperation({ summary: 'İş başına kazançlar: brüt, platform ücreti, net, durum.' })
  @ApiZodResponse(200, paginatedSchema(providerEarningSchema))
  earnings(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listWalletQuerySchema)) query: ListWalletQuery,
  ): Promise<Paginated<ProviderEarning>> {
    return this.wallet.earnings(user.id, query);
  }

  @Get('me/earnings/:id')
  @ApiOperation({ summary: 'Kazanç detayı.' })
  @ApiZodResponse(200, providerEarningSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'EARNING_NOT_FOUND')
  earning(@CurrentUser() user: AuthUser, @Param('id', idPipe) id: string): Promise<ProviderEarning> {
    return this.wallet.earning(user.id, id);
  }

  @Get('me/payout-destination')
  @ApiOperation({ summary: 'Kayıtlı ödeme hesabı (yalnızca maskeli IBAN).' })
  @ApiZodResponse(200, payoutDestinationSchema.nullable())
  destination(@CurrentUser() user: AuthUser): Promise<PayoutDestination | null> {
    return this.payouts.destination(user.id);
  }

  @Put('me/payout-destination')
  @ApiOperation({
    summary:
      'TEST banka hesabı kaydeder. IBAN doğrulanır, yalnızca maskeli hali ve son 4 hanesi saklanır.',
  })
  @ApiZodBody(payoutDestinationRequestSchema)
  @ApiZodResponse(200, payoutDestinationSchema)
  setDestination(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(payoutDestinationRequestSchema)) body: PayoutDestinationRequest,
    @Req() req: Request,
  ): Promise<PayoutDestination> {
    return this.payouts.setDestination(user, body, ip(req));
  }

  @Get('me/payouts')
  @ApiOperation({ summary: 'Para çekme talepleri.' })
  @ApiZodResponse(200, paginatedSchema(payoutSchema))
  listPayouts(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listWalletQuerySchema)) query: ListWalletQuery,
  ): Promise<Paginated<Payout>> {
    return this.payouts.list(user.id, query);
  }

  @Post('me/payouts')
  @IdempotencyHeader()
  @ApiOperation({
    summary:
      'Para Çek: çekilebilir bakiyeden (borç düşülerek) tutar ayrılır. Aynı anda iki talep bakiyeyi aşamaz.',
  })
  @ApiZodBody(payoutRequestSchema)
  @ApiZodResponse(201, payoutSchema)
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'PAYOUT_DESTINATION_REQUIRED / IDEMPOTENCY_KEY_REUSED',
  )
  @ApiZodResponse(
    422,
    apiErrorResponseSchema,
    'INSUFFICIENT_AVAILABLE_BALANCE / PAYOUT_BELOW_MINIMUM',
  )
  requestPayout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(payoutRequestSchema)) body: PayoutRequest,
    @Req() req: Request,
  ): Promise<Payout> {
    return this.payouts.request(user, body.amountMinor, idempotencyKeyFrom(req), ip(req));
  }

  @Post('me/payouts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Usta henüz onaylanmamış talebini iptal eder; tutar çekilebilir bakiyeye döner.' })
  @ApiZodResponse(200, payoutSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PAYOUT_INVALID_STATE')
  cancelPayout(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<Payout> {
    return this.payouts.cancelOwn(user, id, ip(req));
  }
}
