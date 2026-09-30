import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AdminCashSettlement,
  AdminFinanceSummary,
  AdminPaymentDetail,
  AdminPaymentListItem,
  AdminPayout,
  LedgerTransactionView,
  Paginated,
  PayoutDestination,
  ReconciliationReport,
} from '@ustago/types';
import {
  adminCashResolveSchema,
  adminCashSettlementSchema,
  adminFinanceSummarySchema,
  adminPaymentDetailSchema,
  adminPaymentListItemSchema,
  type AdminCashResolve,
  type AdminPayoutDecision,
  adminPayoutDecisionSchema,
  adminPayoutSchema,
  type AdminRefundRequest,
  adminRefundSchema,
  apiErrorResponseSchema,
  type FinanceSummaryQuery,
  financeSummaryQuerySchema,
  ledgerTransactionViewSchema,
  type ListAdminCashQuery,
  listAdminCashQuerySchema,
  type ListAdminLedgerQuery,
  listAdminLedgerQuerySchema,
  type ListAdminPaymentsQuery,
  listAdminPaymentsQuerySchema,
  type ListAdminPayoutsQuery,
  listAdminPayoutsQuerySchema,
  paginatedSchema,
  payoutDestinationSchema,
  reconciliationReportSchema,
  type ResolvePayoutRequest,
  resolvePayoutRequestSchema,
  uuidSchema,
  type VerifyPayoutDestinationRequest,
  verifyPayoutDestinationRequestSchema,
} from '@ustago/validation';
import type { Request } from 'express';

import { type AuthUser, CurrentUser, Roles } from '../common/auth/decorators.js';
import { RequirePermission } from '../common/auth/permissions.js';
import { ApiZodBody, ApiZodResponse } from '../common/http/openapi.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AdminFinanceService } from './admin-finance.service.js';
import { CashService } from './cash.service.js';
import { IDEMPOTENCY_HEADER, idempotencyKeyFrom } from './idempotency.js';
import { PayoutsService } from './payouts.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { clientIp } from '../common/http/client-context.js';

const idPipe = new ZodValidationPipe(uuidSchema);
const ip = (req: Request) => clientIp(req);

/** Admin "Finans" (ADMIN and SUPER_ADMIN). Test money only in this phase. */
@ApiTags('admin: finance')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly finance: AdminFinanceService,
    private readonly payouts: PayoutsService,
    private readonly cash: CashService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get('finance/summary')
  @ApiOperation({ summary: 'Finans özeti (bugün / 7 gün / 30 gün), gerçek veritabanı toplamları.' })
  @ApiZodResponse(200, adminFinanceSummarySchema)
  summary(
    @Query(new ZodValidationPipe(financeSummaryQuerySchema)) query: FinanceSummaryQuery,
  ): Promise<AdminFinanceSummary> {
    return this.finance.summary(query);
  }

  @Get('finance/payments')
  @ApiOperation({ summary: 'Ödemeler: durum, yöntem, sağlayıcı ve tarih filtreleri.' })
  @ApiZodResponse(200, paginatedSchema(adminPaymentListItemSchema))
  payments(
    @Query(new ZodValidationPipe(listAdminPaymentsQuerySchema)) query: ListAdminPaymentsQuery,
  ): Promise<Paginated<AdminPaymentListItem>> {
    return this.finance.listPayments(query);
  }

  @Get('finance/payments/:id')
  @ApiOperation({
    summary: 'Ödeme detayı: denemeler, iadeler, kazanç, defter kayıtları, denetim izi.',
  })
  @ApiZodResponse(200, adminPaymentDetailSchema)
  @ApiZodResponse(404, apiErrorResponseSchema, 'PAYMENT_NOT_FOUND')
  payment(@Param('id', idPipe) id: string): Promise<AdminPaymentDetail> {
    return this.finance.payment(id);
  }

  @Post('finance/payments/:id/refunds')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({ name: IDEMPOTENCY_HEADER, required: true })
  @ApiOperation({
    summary:
      'Tam veya kısmi iade. Tutar sunucuda iade edilebilir tutara karşı kontrol edilir; ' +
      'expectedRefundableMinor ekrandaki değerle eşleşmezse REFUND_STALE.',
  })
  @ApiZodBody(adminRefundSchema)
  @ApiZodResponse(200, adminPaymentDetailSchema)
  @ApiZodResponse(
    409,
    apiErrorResponseSchema,
    'REFUND_STALE / REFUND_NOT_ALLOWED / IDEMPOTENCY_KEY_REUSED',
  )
  @ApiZodResponse(422, apiErrorResponseSchema, 'REFUND_EXCEEDS_REFUNDABLE')
  refund(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(adminRefundSchema)) body: AdminRefundRequest,
    @Req() req: Request,
  ): Promise<AdminPaymentDetail> {
    return this.finance.refund(user.id, id, body, idempotencyKeyFrom(req), ip(req));
  }

  @Get('finance/ledger')
  @ApiOperation({ summary: 'Defter kayıtları (salt okunur, çift taraflı).' })
  @ApiZodResponse(200, paginatedSchema(ledgerTransactionViewSchema))
  ledger(
    @Query(new ZodValidationPipe(listAdminLedgerQuerySchema)) query: ListAdminLedgerQuery,
  ): Promise<Paginated<LedgerTransactionView>> {
    return this.finance.listLedger(query);
  }

  @Get('finance/ledger/:id')
  @ApiOperation({ summary: 'Tek defter kaydı ve satırları.' })
  @ApiZodResponse(200, ledgerTransactionViewSchema)
  ledgerTransaction(@Param('id', idPipe) id: string): Promise<LedgerTransactionView> {
    return this.finance.ledgerTransaction(id);
  }

  @Get('finance/payouts')
  @ApiOperation({ summary: 'Para çekme talepleri.' })
  @ApiZodResponse(200, paginatedSchema(adminPayoutSchema))
  listPayouts(
    @Query(new ZodValidationPipe(listAdminPayoutsQuerySchema)) query: ListAdminPayoutsQuery,
  ): Promise<Paginated<AdminPayout>> {
    return this.finance.listPayouts(query);
  }

  @Post('finance/payouts/:id/approve')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Talebi onaylar ve (test) ödeme sağlayıcısına iletir.' })
  @ApiZodResponse(200, adminPayoutSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PAYOUT_INVALID_STATE')
  approvePayout(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Req() req: Request,
  ): Promise<AdminPayout> {
    return this.payouts.approve(user.id, id, ip(req));
  }

  @Post('finance/payouts/:id/cancel')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Talebi iptal eder; ayrılan tutar çekilebilir bakiyeye döner.' })
  @ApiZodBody(adminPayoutDecisionSchema)
  @ApiZodResponse(200, adminPayoutSchema)
  cancelPayout(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(adminPayoutDecisionSchema)) body: AdminPayoutDecision,
    @Req() req: Request,
  ): Promise<AdminPayout> {
    return this.payouts.adminCancel(user.id, id, body, ip(req));
  }

  @Post('finance/payouts/:id/resolve')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Sonucu bilinmeyen (NEEDS_RECONCILIATION) talebi, sağlayıcı ile kontrol edildikten sonra PAID veya FAILED olarak kapatır.',
  })
  @ApiZodBody(resolvePayoutRequestSchema)
  @ApiZodResponse(200, adminPayoutSchema)
  @ApiZodResponse(409, apiErrorResponseSchema, 'PAYOUT_INVALID_STATE')
  resolvePayout(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(resolvePayoutRequestSchema)) body: ResolvePayoutRequest,
    @Req() req: Request,
  ): Promise<AdminPayout> {
    return this.payouts.resolveUnknown(user.id, id, body, ip(req));
  }

  @Post('finance/payout-destinations/:id/verify')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Banka hesabını (TEST) doğrulanmış olarak işaretler.' })
  @ApiZodBody(verifyPayoutDestinationRequestSchema)
  @ApiZodResponse(200, payoutDestinationSchema)
  verifyDestination(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(verifyPayoutDestinationRequestSchema))
    body: VerifyPayoutDestinationRequest,
    @Req() req: Request,
  ): Promise<PayoutDestination> {
    return this.payouts.verifyDestination(user.id, id, body.note, ip(req));
  }

  @Get('finance/cash-settlements')
  @ApiOperation({ summary: 'Nakit ödeme kayıtları (anlaşmazlıklar dahil).' })
  @ApiZodResponse(200, paginatedSchema(adminCashSettlementSchema))
  listCash(
    @Query(new ZodValidationPipe(listAdminCashQuerySchema)) query: ListAdminCashQuery,
  ): Promise<Paginated<AdminCashSettlement>> {
    return this.finance.listCash(query);
  }

  @Post('finance/cash-settlements/:id/resolve')
  @RequirePermission('ADMIN_FINANCE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Nakit anlaşmazlığının sonucunu kaydeder (ödendi / ödenmedi). UstaGO nakde dokunmadığı için iade yoktur.',
  })
  @ApiZodBody(adminCashResolveSchema)
  @ApiZodResponse(200, adminCashSettlementSchema)
  resolveCash(
    @CurrentUser() user: AuthUser,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(adminCashResolveSchema)) body: AdminCashResolve,
    @Req() req: Request,
  ): Promise<AdminCashSettlement> {
    return this.cash.adminResolve(user.id, id, body, ip(req));
  }

  @Get('finance/reconciliation')
  @ApiOperation({ summary: 'Mutabakat raporu (salt okunur; hiçbir şeyi otomatik düzeltmez).' })
  @ApiZodResponse(200, reconciliationReportSchema)
  reconcile(): Promise<ReconciliationReport> {
    return this.reconciliation.run();
  }
}
