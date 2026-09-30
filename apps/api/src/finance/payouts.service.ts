import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AdminPayout, Paginated, Payout, PayoutDestination } from '@ustago/types';
import {
  type AdminPayoutDecision,
  formatMoney,
  type ListWalletQuery,
  maskIban,
  type PayoutDestinationRequest,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { unprocessable } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Payout as PayoutRow } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
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
import { PAYOUT_PROVIDER, type PayoutProvider } from './providers/payment-provider.js';

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
  ) {}

  private get enabled(): boolean {
    return this.config.payoutsEnabled && this.config.payoutProvider !== 'disabled';
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
    if (!this.enabled) throw payoutsDisabled();
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
    await this.prisma.$transaction((tx) => this.transition(tx, id, 'APPROVE', adminId, ipAddress));
    try {
      const payout = await this.prisma.payout.findUniqueOrThrow({ where: { id } });
      const result = await this.provider.createPayout({
        payoutId: id,
        amountMinor: payout.amountMinor,
        currency: 'TRY',
        idempotencyKey: id,
      });
      await this.prisma.$transaction((tx) =>
        this.transition(tx, id, 'START_PROCESSING', adminId, ipAddress, null, result.providerPayoutId),
      );
    } catch (error) {
      this.logger.error(
        `Payout ${id} could not be handed to the payout provider`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.prisma.$transaction((tx) =>
        this.transition(tx, id, 'MARK_FAILED', adminId, ipAddress, 'PROVIDER_ERROR'),
      );
    }
    return this.adminView(id);
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
  async markTestFailed(adminId: string, id: string, ipAddress: string | null): Promise<AdminPayout> {
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
        description: this.provider.isTestMode ? 'TEST para çekme ödendi (gerçek transfer yok)' : 'Para çekme ödendi',
        createdById: actorId,
      });
    }
    if (event === 'MARK_FAILED' || event === 'CANCEL') {
      await this.ledger.post(tx, {
        built: payoutReleased({ providerId: payout.providerId, amount: payout.amountMinor }),
        sourceKey: `payout:${id}:released`,
        refs,
        description: failed ? 'Para çekme başarısız; tutar bakiyeye döndü' : 'Para çekme iptal; tutar bakiyeye döndü',
        createdById: actorId,
      });
    }
    const action: Record<PayoutEvent, string> = {
      APPROVE: 'payout.approved',
      START_PROCESSING: 'payout.processing',
      MARK_PAID: 'payout.completed',
      MARK_FAILED: 'payout.failed',
      CANCEL: 'payout.cancelled',
    };
    await this.audit.recordIn(tx, {
      action: action[event],
      actorId,
      entityType: 'payout',
      entityId: id,
      ipAddress,
      metadata: { amountMinor: Number(payout.amountMinor), from: payout.status, to },
    });
    if (event === 'MARK_PAID' || event === 'MARK_FAILED') {
      await this.notifications.enqueueIn(tx, [
        {
          userId: payout.provider.userId,
          type: event === 'MARK_PAID' ? NotificationEvent.PAYOUT_PAID : NotificationEvent.PAYOUT_FAILED,
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
    const row = await this.prisma.payout.findUniqueOrThrow({ where: { id }, include: payoutInclude });
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

