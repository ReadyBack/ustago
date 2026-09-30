import { Module } from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { AdminFeePoliciesController } from './admin-fee-policies.controller.js';
import { AdminFinanceController } from './admin-finance.controller.js';
import { AdminFinanceService } from './admin-finance.service.js';
import { CashService } from './cash.service.js';
import { DevFinanceController } from './dev-finance.controller.js';
import { DevFinanceGuard } from './dev-finance.guard.js';
import { EarningsService } from './earnings.service.js';
import { FeePoliciesAdminService } from './fee-policies-admin.service.js';
import { FeePolicyService } from './fee-policy.service.js';
import { FINANCE_CONFIG, type FinanceConfig, financeConfigFrom } from './finance.config.js';
import { FinanceController } from './finance.controller.js';
import { FinanceSweepService } from './finance-sweep.service.js';
import { JobFinanceService } from './job-finance.service.js';
import { LedgerService } from './ledger.service.js';
import { PaymentsService } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';
import {
  DisabledPaymentProvider,
  DisabledPayoutProvider,
  MockPayoutProvider,
} from './providers/disabled-payment.provider.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PAYMENT_PROVIDER, PAYOUT_PROVIDER } from './providers/payment-provider.js';
import { ReconciliationService } from './reconciliation.service.js';
import { RefundsService } from './refunds.service.js';
import { WalletService } from './wallet.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * Payments, cash settlements, ledger, earnings, refunds and payouts
 * (Faz 5). Providers are chosen from the environment; production can
 * only boot with real (or disabled) adapters, never the mock ones.
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    FinanceController,
    WebhooksController,
    DevFinanceController,
    AdminFinanceController,
    AdminFeePoliciesController,
  ],
  providers: [
    {
      provide: FINANCE_CONFIG,
      inject: [API_ENV],
      useFactory: (env: ApiEnv) => financeConfigFrom(env),
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [FINANCE_CONFIG],
      useFactory: (config: FinanceConfig) =>
        config.paymentProvider === 'mock'
          ? new MockPaymentProvider(config.mockWebhookSecret, config.webhookToleranceSeconds)
          : new DisabledPaymentProvider(),
    },
    {
      provide: PAYOUT_PROVIDER,
      inject: [FINANCE_CONFIG],
      useFactory: (config: FinanceConfig) =>
        config.payoutProvider === 'mock' ? new MockPayoutProvider() : new DisabledPayoutProvider(),
    },
    LedgerService,
    FeePolicyService,
    EarningsService,
    RefundsService,
    PaymentsService,
    CashService,
    PayoutsService,
    WalletService,
    JobFinanceService,
    WebhooksService,
    ReconciliationService,
    AdminFinanceService,
    FeePoliciesAdminService,
    FinanceSweepService,
    DevFinanceGuard,
  ],
  exports: [
    FINANCE_CONFIG,
    PAYMENT_PROVIDER,
    JobFinanceService,
    FeePolicyService,
    LedgerService,
    ReconciliationService,
    PaymentsService,
    PayoutsService,
  ],
})
export class FinanceModule {}
