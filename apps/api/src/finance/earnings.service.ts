import { Inject, Injectable } from '@nestjs/common';
import { formatMoney } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { canRelease, debtToSettle, holdUntil } from './domain/earning.js';
import { earningReleased } from './domain/ledger.js';
import { FINANCE_CONFIG, type FinanceConfig } from './finance.config.js';
import { LedgerService } from './ledger.service.js';

type Tx = Prisma.TransactionClient;

/**
 * Provider earnings (docs/adr/0020): PENDING until the job is COMPLETED and
 * the hold period passed, HELD while a dispute is open, AVAILABLE once
 * released (with platform debt offset first when the policy says so).
 *
 * Lock order everywhere: job → payment → earning → provider ledger accounts.
 */
@Injectable()
export class EarningsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(FINANCE_CONFIG) private readonly config: FinanceConfig,
  ) {}

  /** Job COMPLETED: start the hold clock and release what is due. */
  async onJobCompleted(tx: Tx, jobId: string, completedAt: Date): Promise<void> {
    const earnings = await tx.providerEarning.findMany({
      where: { jobId, status: 'PENDING', holdUntil: null },
      select: { id: true, createdAt: true },
    });
    for (const e of earnings) {
      await tx.providerEarning.updateMany({
        where: { id: e.id, holdUntil: null },
        data: {
          holdUntil: holdUntil(completedAt, e.createdAt, this.config.earningHoldHours),
          version: { increment: 1 },
        },
      });
      await this.releaseIfDue(tx, e.id, completedAt);
    }
  }

  /** Job DISPUTED: nothing of this job can be released or paid out. */
  async onJobDisputed(tx: Tx, jobId: string, now: Date): Promise<void> {
    const held = await tx.providerEarning.updateManyAndReturn({
      where: { jobId, status: 'PENDING' },
      data: { status: 'HELD', heldAt: now, version: { increment: 1 } },
      select: { id: true },
    });
    for (const e of held) {
      await this.audit.recordIn(tx, {
        action: 'provider_earning.held',
        entityType: 'provider_earning',
        entityId: e.id,
        metadata: { jobId },
      });
    }
  }

  /** Releases one earning if the job is completed and the hold passed. */
  async releaseIfDue(tx: Tx, earningId: string, now: Date): Promise<boolean> {
    const earning = await this.lock(tx, earningId);
    const job = await tx.job.findUniqueOrThrow({
      where: { id: earning.jobId },
      select: { status: true },
    });
    if (
      !canRelease({
        status: earning.status,
        jobStatus: job.status,
        holdUntil: earning.holdUntil,
        now,
      })
    ) {
      return false;
    }
    await this.release(tx, earning, now, null);
    return true;
  }

  /**
   * Admin decision (dispute resolution): release a HELD or PENDING earning
   * regardless of the job state and hold period.
   */
  async releaseByAdmin(tx: Tx, earningId: string, adminId: string, now: Date): Promise<void> {
    const earning = await this.lock(tx, earningId);
    if (earning.status !== 'HELD' && earning.status !== 'PENDING') return;
    await this.release(tx, earning, now, adminId);
  }

  private async lock(tx: Tx, earningId: string) {
    await tx.$queryRaw`SELECT id FROM provider_earnings WHERE id = ${earningId}::uuid FOR UPDATE`;
    return tx.providerEarning.findUniqueOrThrow({ where: { id: earningId } });
  }

  private async release(
    tx: Tx,
    earning: { id: string; providerId: string; jobId: string; paymentId: string; version: number },
    now: Date,
    adminId: string | null,
  ): Promise<void> {
    await this.ledger.lockProvider(tx, earning.providerId);
    const amount = await this.ledger.earningPendingBalance(tx, earning.id);
    const balances = await this.ledger.providerBalances(tx, earning.providerId);
    const settle = debtToSettle({
      releaseAmount: amount,
      platformDebt: balances.platformDebt,
      offsetEnabled: this.config.debtOffsetEnabled,
    });
    if (amount > 0n) {
      await this.ledger.post(tx, {
        built: earningReleased({ providerId: earning.providerId, amount, debtToSettle: settle }),
        sourceKey: `earning:${earning.id}:released`,
        refs: {
          jobId: earning.jobId,
          paymentId: earning.paymentId,
          earningId: earning.id,
          providerId: earning.providerId,
        },
        description:
          settle > 0n
            ? `Kazanç kullanılabilir; ${formatMoney(Number(settle))} platform borcuna mahsup edildi`
            : 'Kazanç kullanılabilir bakiyeye geçti',
        createdById: adminId,
      });
    }
    await tx.providerEarning.update({
      where: { id: earning.id },
      data: {
        status: amount > 0n ? 'AVAILABLE' : 'REVERSED',
        releasedAt: amount > 0n ? now : null,
        version: { increment: 1 },
      },
    });
    await this.audit.recordIn(tx, {
      action: 'provider_earning.released',
      actorId: adminId,
      entityType: 'provider_earning',
      entityId: earning.id,
      metadata: {
        jobId: earning.jobId,
        amountMinor: Number(amount),
        debtSettledMinor: Number(settle),
        byAdmin: adminId !== null,
      },
    });
    if (amount - settle > 0n) {
      const provider = await tx.providerProfile.findUniqueOrThrow({
        where: { id: earning.providerId },
        select: { userId: true },
      });
      await this.notifications.enqueueIn(tx, [
        {
          userId: provider.userId,
          type: NotificationEvent.EARNING_AVAILABLE,
          title: `${formatMoney(Number(amount - settle))} kullanılabilir bakiyenize geçti.`,
          body: 'Kazançlarım ekranından para çekme talebi oluşturabilirsiniz.',
          data: { jobId: earning.jobId, earningId: earning.id },
        },
      ]);
    }
  }

  /**
   * Releases every earning whose hold passed (background sweep). One short
   * transaction per earning, locking the job first like every other path.
   */
  async releaseDue(now = new Date()): Promise<number> {
    const due = await this.prisma.providerEarning.findMany({
      where: { status: 'PENDING', holdUntil: { lte: now }, job: { status: 'COMPLETED' } },
      select: { id: true, jobId: true },
      orderBy: { holdUntil: 'asc' },
      take: 100,
    });
    let released = 0;
    for (const e of due) {
      const ok = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM jobs WHERE id = ${e.jobId}::uuid FOR UPDATE`;
        return this.releaseIfDue(tx, e.id, now);
      });
      if (ok) released += 1;
    }
    return released;
  }
}
