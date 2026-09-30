import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminPayout, Paginated, Payout, PayoutDestination } from '@ustago/types';
import {
  type AdminPayoutDecision,
  formatMoney,
  type ListWalletQuery,
  maskIban,
  type PayoutDestinationRequest,
  type ResolvePayoutRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, forbidden, notFound, unprocessable } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Payout as PayoutRow } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { metrics } from '../observability/metrics.js';
import { AlertsService } from '../ops/alerts.service.js';
import { RuntimeFlagsService } from '../ops/runtime-flags.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { payoutRefusal } from '../providers/domain/provider-policy.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { withdrawable } from './domain/earning.js';
import { payoutPaid, payoutReleased, payoutReserved } from './domain/ledger.js';
import { checkPayoutAmount, type PayoutEvent, payoutTransition } from './domain/payout.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import {
  destinationRequired,
  idempotencyKeyReused,
  payoutInvalidState,
  payoutNotFound,
  payoutsDisabled,
  providerOnly,
} from './finance-errors.js';
import { toDestination, toPayout } from './finance.mappers.js';
import { LedgerService } from './ledger.service.js';
import {
  PAYOUT_PROVIDER,
  type PayoutProvider,
  PayoutRejectedError,
} from './providers/payment-provider.js';

type Tx = Prisma.TransactionClient;

const RATE = { limit: 5, windowSeconds: 60 } as const;
const payoutInclude = { destination: true } as const;

/**
 * "Para Çek" (docs/adr/0020). No real bank payout happens in Faz 5: the
 * mock payout provider accepts the request and an admin marks it paid or
 * failed through development-only endpoints.
 *
 * Requesting locks the provider's ledger accounts, checks the withdrawable
 * amount (available − platform debt) and reserves it in the same
 * transaction, so two concurrent requests can never use the same money.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly rateLimit: RateLimitService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProvider,
    private readonly flags: RuntimeFlagsService,
    private readonly alerts: AlertsService,
  ) {}

  private get enabled(): boolean {
    return this.config.payoutsEnabled && this.config.payoutProvider !== 'disabled';
  }

  /** Env switch, payout provider and the admin kill switch (docs/adr/0025). */
  private async assertEnabled(): Promise<void> {
    if (!this.enabled) throw payoutsDisabled();
    await this.flags.assertEnabled('payouts');
  }

  /**
   * Central payout eligibility (docs/adr/0023): account not suspended,
   * verification case VERIFIED and a verified destination. Runs at request
   * time and again at approval, inside the transaction that holds the
   * provider's ledger lock.
   */
  private async assertEligible(tx: Tx, providerId: string, destinationVerified: boolean) {
    const profile = await tx.providerProfile.findUniqueOrThrow({
      where: { id: providerId },
      select: { status: true, accountStatus: true, verificationCase: { select: { status: true } } },
    });
    const refusal = payoutRefusal({
      applicationStatus: profile.status,
      accountStatus: profile.accountStatus,
      verificationStatus: profile.verificationCase?.status ?? 'NOT_STARTED',
      destinationVerified,
    });
    if (refusal) throw forbidden(refusal.code, refusal.message);
  }

  /** The caller's provider profile id; customers and admins get 403. */
  async providerIdOf(userId: string): Promise<string> {
    const profile = await this.prisma.providerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw providerOnly();
    return profile.id;
  }

  async destination(userId: string): Promise<PayoutDestination | null> {
    const providerId = await this.providerIdOf(userId);
    const d = await this.prisma.payoutDestination.findFirst({
      where: { providerId, deactivatedAt: null },
    });
    return d ? toDestination(d) : null;
  }

  /**
   * Saves a TEST bank destination. The IBAN is validated (format and
   * checksum) and then thrown away: only the masked form and last four
   * digits are stored.
   */
  async setDestination(
    user: AuthUser,
    input: PayoutDestinationRequest,
    ipAddress: string | null,
  ): Promise<PayoutDestination> {
    const providerId = await this.providerIdOf(user.id);
    if (this.config.strictEnv) {
      // Only TEST bank destinations exist until a real payout provider is
      // chosen (docs/decisions/payment-provider-selection.md).
      throw conflict('PAYOUT_DESTINATION_UNAVAILABLE', 'Banka hesabı ekleme henüz kullanılamıyor.');
    }
    const created = await this.prisma.$transaction(async (tx) => {
      await tx.payoutDestination.updateMany({
        where: { providerId, deactivatedAt: null },
        data: { deactivatedAt: new Date() },
      });
      const row = await tx.payoutDestination.create({
        data: {
          providerId,
          type: 'TEST_BANK_ACCOUNT',
          holderName: input.holderName,
          maskedIban: maskIban(input.iban),
          last4: input.iban.slice(-4),
          isTest: true,
          // A finance admin verifies every new destination (docs/adr/0023).
          verificationStatus: 'PENDING_VERIFICATION',
        },
      });
      await this.audit.recordIn(tx, {
        action: 'payout.destination_set',
        actorId: user.id,
        entityType: 'payout_destination',
        entityId: row.id,
        ipAddress,
        metadata: { last4: row.last4 },
      });
      return row;
    });
    return toDestination(created);
  }

  async request(
    user: AuthUser,
    amountMinor: number,
    idempotencyKey: string,
    ipAddress: string | null,
  ): Promise<Payout> {
    await this.assertEnabled();
    const providerId = await this.providerIdOf(user.id);
    const replay = await this.replayed(providerId, idempotencyKey);
    if (replay) return replay;
    await this.rateLimit.enforceWithCode('FINANCE_RATE_LIMITED', {
      bucket: 'payout-request',
      subject: user.id,
      ...RATE,
    });
    const amount = BigInt(amountMinor);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await this.ledger.lockProvider(tx, providerId);
        const again = await tx.payout.findUnique({ where: { idempotencyKey } });
        if (again) return again;
        const destination = await tx.payoutDestination.findFirst({
          where: { providerId, deactivatedAt: null },
        });
        if (!destination) throw destinationRequired();
        await this.assertEligible(tx, providerId, destination.verificationStatus === 'VERIFIED');
        const balances = await this.ledger.providerBalances(tx, providerId);
        const canWithdraw = withdrawable(balances.available, balances.platformDebt);
        const check = checkPayoutAmount({
          amount,
          withdrawable: canWithdraw,
          minimum: this.config.minPayoutMinor,
        });
        if (!check.ok) {
          throw check.code === 'PAYOUT_BELOW_MINIMUM'
            ? unprocessable(
                'PAYOUT_BELOW_MINIMUM',
                `En az ${formatMoney(Number(this.config.minPayoutMinor))} çekebilirsiniz.`,
                { minimumMinor: Number(this.config.minPayoutMinor) },
              )
            : unprocessable(
                'INSUFFICIENT_AVAILABLE_BALANCE',
                'Kullanılabilir bakiyeniz bu tutar için yeterli değil.',
                { withdrawableMinor: Number(canWithdraw) },
              );
        }
        const payout = await tx.payout.create({
          data: {
            providerId,
            destinationId: destination.id,
            amountMinor: amount,
            idempotencyKey,
            gateway: this.provider.name,
            requestedById: user.id,
          },
        });
        await this.ledger.post(tx, {
          built: payoutReserved({ providerId, amount }),
          sourceKey: `payout:${payout.id}:reserved`,
          refs: { payoutId: payout.id, providerId },
          description: 'Para çekme talebi: tutar ayrıldı',
          createdById: user.id,
        });
        await this.audit.recordIn(tx, {
          action: 'payout.requested',
          actorId: user.id,
          entityType: 'payout',
          entityId: payout.id,
          ipAddress,
          metadata: { amountMinor: amountMinor, providerId },
        });
        await this.notifications.enqueueIn(tx, [
          {
            userId: user.id,
            type: NotificationEvent.PAYOUT_REQUESTED,
            title: `${formatMoney(amountMinor)} para çekme talebiniz alındı.`,
            body: 'Talebiniz incelendikten sonra işleme alınacak.',
            data: { payoutId: payout.id },
          },
        ]);
        return payout;
      });
      return this.view(created.id);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.replayed(providerId, idempotencyKey);
        if (again) return again;
      }
      throw error;
    }
  }

  private async replayed(providerId: string, key: string): Promise<Payout | null> {
    const existing = await this.prisma.payout.findUnique({ where: { idempotencyKey: key } });
    if (!existing) return null;
    if (existing.providerId !== providerId) throw idempotencyKeyReused();
    return this.view(existing.id);
  }

  async list(userId: string, query: ListWalletQuery): Promise<Paginated<Payout>> {
    const providerId = await this.providerIdOf(userId);
    const rows = await this.prisma.payout.findMany({
      where: { providerId, ...(query.cursor ? { id: { lt: query.cursor } } : {}) },
      include: payoutInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toPayout),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Provider withdraws a request an admin has not approved yet. */
  async cancelOwn(user: AuthUser, payoutId: string, ipAddress: string | null): Promise<Payout> {
    const providerId = await this.providerIdOf(user.id);
    const owned = await this.prisma.payout.findUnique({
      where: { id: payoutId },
      select: { providerId: true, status: true },
    });
    if (!owned || owned.providerId !== providerId) throw payoutNotFound();
    if (owned.status !== 'REQUESTED') throw payoutInvalidState(owned.status);
    await this.prisma.$transaction((tx) =>
      this.transition(tx, payoutId, 'CANCEL', user.id, ipAddress, 'Usta talebi geri çekti.'),
    );
    return this.view(payoutId);
  }

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------

  /**
   * Approves the payout and hands it to the payout provider (mock: nothing
   * is sent). The provider call happens after the approval commits.
   */
  async approve(adminId: string, id: string, ipAddress: string | null): Promise<AdminPayout> {
    await this.assertEnabled();
    await this.prisma.$transaction(async (tx) => {
      const target = await tx.payout.findUnique({
        where: { id },
        select: { providerId: true, destination: { select: { verificationStatus: true } } },
      });
      if (!target) throw payoutNotFound();
      await this.ledger.lockProvider(tx, target.providerId);
      // The provider may have been suspended since the request.
      await this.assertEligible(
        tx,
        target.providerId,
        target.destination.verificationStatus === 'VERIFIED',
      );
      await this.transition(tx, id, 'APPROVE', adminId, ipAddress);
    });
    try {
      const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id } });
      const result = await this.provider.createPayout({
        payoutId: id,
        amountMinor: payout.amountMinor,
        currency: 'TRY',
        idempotencyKey: id,
      });
      await this.prisma.$transaction((tx) =>
        this.transition(
          tx,
          id,
          'START_PROCESSING',
          adminId,
          ipAddress,
          null,
          result.providerPayoutId,
        ),
      );
    } catch (error) {
      if (error instanceof PayoutRejectedError) {
        // A definite "no": nothing was sent, the money goes back.
        this.logger.warn(`Payout ${id} rejected by the payout provider: ${error.code}`);
        await this.prisma.$transaction((tx) =>
          this.transition(tx, id, 'MARK_FAILED', adminId, ipAddress, error.code),
        );
      } else {
        // Unknown outcome (timeout, 5xx, lost answer): the bank may have
        // sent the money. Keep it reserved and let a finance admin decide
        // after checking with the provider; never retry automatically.
        this.logger.error(
          `Payout ${id} outcome unknown after the payout provider call`,
          error instanceof Error ? error.stack : String(error),
        );
        await this.prisma.$transaction((tx) =>
          this.transition(tx, id, 'MARK_UNKNOWN', adminId, ipAddress, 'PROVIDER_OUTCOME_UNKNOWN'),
        );
        await this.alerts.raise({
          type: 'finance.payout_outcome_unknown',
          severity: 'CRITICAL',
          title: 'Para çekme sonucu bilinmiyor: sağlayıcı ile kontrol edilmeli',
          details: { payoutId: id },
          source: 'payouts',
          dedupeKey: `finance.payout_outcome_unknown:${id}`,
        });
      }
    }
    return this.adminView(id);
  }

  /**
   * NEEDS_RECONCILIATION → PAID or FAILED, after a finance admin checked
   * the outcome with the payout provider. The note is kept on the payout
   * and in the audit log.
   */
  async resolveUnknown(
    adminId: string,
    id: string,
    input: ResolvePayoutRequest,
    ipAddress: string | null,
  ): Promise<AdminPayout> {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.payout.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw payoutNotFound();
      if (current.status !== 'NEEDS_RECONCILIATION') throw payoutInvalidState(current.status);
      await this.transition(
        tx,
        id,
        input.outcome === 'PAID' ? 'MARK_PAID' : 'MARK_FAILED',
        adminId,
        ipAddress,
        input.outcome === 'PAID' ? input.note : 'RESOLVED_FAILED',
      );
      if (input.outcome === 'FAILED') {
        await tx.payout.update({ where: { id }, data: { statusNote: input.note } });
      }
    });
    await this.alerts.autoResolve(
      `finance.payout_outcome_unknown:${id}`,
      `Yönetici sonucu kaydetti: ${input.outcome}`,
    );
    return this.adminView(id);
  }

  /** A finance admin confirms a (TEST) payout destination. */
  async verifyDestination(
    adminId: string,
    destinationId: string,
    note: string,
    ipAddress: string | null,
  ): Promise<PayoutDestination> {
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.payoutDestination.findUnique({ where: { id: destinationId } });
      if (!current || current.deactivatedAt) {
        throw notFound('PAYOUT_DESTINATION_NOT_FOUND', 'Banka hesabı bulunamadı.');
      }
      if (current.verificationStatus === 'VERIFIED') return current;
      const updated = await tx.payoutDestination.update({
        where: { id: destinationId },
        data: { verificationStatus: 'VERIFIED', verifiedAt: new Date(), verifiedById: adminId },
      });
      await this.audit.recordIn(tx, {
        action: 'payout.destination_verified',
        actorId: adminId,
        entityType: 'payout_destination',
        entityId: destinationId,
        ipAddress,
        metadata: { providerId: current.providerId, last4: current.last4, note },
      });
      return updated;
    });
    return toDestination(row);
  }

  async adminCancel(
    adminId: string,
    id: string,
    input: AdminPayoutDecision,
    ipAddress: string | null,
  ): Promise<AdminPayout> {
    await this.prisma.$transaction((tx) =>
      this.transition(tx, id, 'CANCEL', adminId, ipAddress, input.note ?? 'Admin iptal etti.'),
    );
    return this.adminView(id);
  }

  /** Development only (mock payout provider): money "arrived". */
  async markTestPaid(adminId: string, id: string, ipAddress: string | null): Promise<AdminPayout> {
    await this.prisma.$transaction((tx) =>
      this.transition(tx, id, 'MARK_PAID', adminId, ipAddress, 'TEST: ödendi olarak işaretlendi.'),
    );
    return this.adminView(id);
  }

  /** Development only (mock payout provider): payout failed. */
  async markTestFailed(
    adminId: string,
    id: string,
    ipAddress: string | null,
  ): Promise<AdminPayout> {
    await this.prisma.$transaction((tx) =>
      this.transition(tx, id, 'MARK_FAILED', adminId, ipAddress, 'TEST_FAILURE'),
    );
    return this.adminView(id);
  }

  /**
   * One payout state change: lock the payout row, check the state machine,
   * conditional update, and the ledger effect (paid: reserved → clearing;
   * failed/cancelled: reserved → available).
   */
  private async transition(
    tx: Tx,
    id: string,
    event: PayoutEvent,
    actorId: string,
    ipAddress: string | null,
    note: string | null = null,
    gatewayReference?: string,
  ): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM payouts WHERE id = ${id}::uuid FOR UPDATE`;
    if (locked.length === 0) throw payoutNotFound();
    const payout = await tx.payout.findUniqueOrThrow({
      where: { id },
      include: { provider: { select: { userId: true } } },
    });
    const to = payoutTransition(payout.status, event);
    if (!to) throw payoutInvalidState(payout.status);
    const now = new Date();
    const failed = event === 'MARK_FAILED';
    await tx.payout.update({
      where: { id },
      data: {
        status: to,
        decidedById: event === 'APPROVE' || event === 'CANCEL' ? actorId : payout.decidedById,
        ...(event === 'APPROVE' ? { approvedAt: now } : {}),
        ...(event === 'START_PROCESSING'
          ? { processingAt: now, gatewayReference: gatewayReference ?? null }
          : {}),
        ...(event === 'MARK_PAID' ? { paidAt: now } : {}),
        ...(failed ? { failedAt: now, failureCode: note ?? 'FAILED' } : {}),
        ...(event === 'CANCEL' ? { cancelledAt: now } : {}),
        ...(note && !failed ? { statusNote: note } : {}),
        version: { increment: 1 },
      },
    });
    const refs = { payoutId: id, providerId: payout.providerId };
    if (event === 'MARK_PAID') {
      await this.ledger.post(tx, {
        built: payoutPaid({ providerId: payout.providerId, amount: payout.amountMinor }),
        sourceKey: `payout:${id}:paid`,
        refs,
        description: this.provider.isTestMode
          ? 'TEST para çekme ödendi (gerçek transfer yok)'
          : 'Para çekme ödendi',
        createdById: actorId,
      });
    }
    if (event === 'MARK_FAILED' || event === 'CANCEL') {
      await this.ledger.post(tx, {
        built: payoutReleased({ providerId: payout.providerId, amount: payout.amountMinor }),
        sourceKey: `payout:${id}:released`,
        refs,
        description: failed
          ? 'Para çekme başarısız; tutar bakiyeye döndü'
          : 'Para çekme iptal; tutar bakiyeye döndü',
        createdById: actorId,
      });
    }
    const action: Record<PayoutEvent, string> = {
      APPROVE: 'payout.approved',
      START_PROCESSING: 'payout.processing',
      MARK_PAID: 'payout.completed',
      MARK_FAILED: 'payout.failed',
      MARK_UNKNOWN: 'payout.needs_reconciliation',
      CANCEL: 'payout.cancelled',
    };
    metrics.domainEvents.inc({ event: action[event] });
    await this.audit.recordIn(tx, {
      action: action[event],
      actorId,
      entityType: 'payout',
      entityId: id,
      ipAddress,
      metadata: { amountMinor: Number(payout.amountMinor), from: payout.status, to },
    });
    const amountText = formatMoney(Number(payout.amountMinor));
    const extra: Partial<Record<PayoutEvent, { type: string; title: string; body: string }>> = {
      APPROVE: {
        type: NotificationEvent.PAYOUT_APPROVED,
        title: `${amountText} para çekme talebiniz onaylandı.`,
        body: 'Ödeme işleme alındı.',
      },
      MARK_UNKNOWN: {
        type: NotificationEvent.PAYOUT_NEEDS_RECONCILIATION,
        title: `${amountText} para çekme talebiniz kontrol ediliyor.`,
        body: 'Banka yanıtı bekleniyor. Tutar ayrılmış olarak kalır; sonuç netleşince bildireceğiz.',
      },
    };
    const notice = extra[event];
    if (notice) {
      await this.notifications.enqueueIn(tx, [
        { userId: payout.provider.userId, ...notice, data: { payoutId: id } },
      ]);
    }
    if (event === 'MARK_PAID' || event === 'MARK_FAILED') {
      await this.notifications.enqueueIn(tx, [
        {
          userId: payout.provider.userId,
          type:
            event === 'MARK_PAID' ? NotificationEvent.PAYOUT_PAID : NotificationEvent.PAYOUT_FAILED,
          title:
            event === 'MARK_PAID'
              ? `${formatMoney(Number(payout.amountMinor))} para çekme talebiniz ödendi.`
              : `${formatMoney(Number(payout.amountMinor))} para çekme talebiniz gerçekleşmedi.`,
          body:
            event === 'MARK_PAID'
              ? this.provider.isTestMode
                ? 'TEST ortamı: gerçek banka transferi yapılmadı.'
                : 'Tutar hesabınıza gönderildi.'
              : 'Tutar kullanılabilir bakiyenize geri döndü.',
          data: { payoutId: id },
        },
      ]);
    }
  }

  async view(id: string): Promise<Payout> {
    const row = await this.prisma.payout.findUniqueOrThrow({
      where: { id },
      include: payoutInclude,
    });
    return toPayout(row);
  }

  async adminView(id: string): Promise<AdminPayout> {
    const row = await this.prisma.payout.findUnique({
      where: { id },
      include: { ...payoutInclude, provider: { select: { displayName: true } } },
    });
    if (!row) throw payoutNotFound();
    return toAdminPayout(row);
  }
}

export function toAdminPayout(
  row: PayoutRow & {
    destination: Parameters<typeof toDestination>[0];
    provider: { displayName: string };
  },
): AdminPayout {
  return {
    ...toPayout(row),
    providerId: row.providerId,
    providerName: row.provider.displayName,
    statusNote: row.statusNote,
  };
}
