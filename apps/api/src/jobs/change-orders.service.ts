import { Injectable } from '@nestjs/common';
import type { ChangeOrder } from '@ustago/types';
import { type CreateChangeOrder, formatMoney } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, unprocessable } from '../common/http/errors.js';
import { toMinor } from '../common/money.js';
import { type ChangeOrder as ChangeOrderRow, Prisma } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  answerTransition,
  canAnswerChangeOrder,
  canProposeChangeOrder,
  ChangeOrderAmountError,
  type ChangeOrderAnswer,
  proposedTotal,
  totalAfterAccept,
} from './domain/change-order.js';
import type { JobParty } from './domain/job-state-machine.js';
import { changeOrderNotFound, invalidTransition, wrongParty } from './job-errors.js';
import { toChangeOrder } from './job.mappers.js';
import { JobStore } from './job.store.js';

type Tx = Prisma.TransactionClient;

const ANSWERED_BY: Record<ChangeOrderAnswer, JobParty> = {
  ACCEPT: 'CUSTOMER',
  REJECT: 'CUSTOMER',
  CANCEL: 'PROVIDER',
};

const AUDIT: Record<ChangeOrderAnswer, string> = {
  ACCEPT: 'job.change_order.accepted',
  REJECT: 'job.change_order.rejected',
  CANCEL: 'job.change_order.cancelled',
};

const notPending = (status: string) =>
  conflict('CHANGE_ORDER_NOT_PENDING', 'Bu ek iş talebi artık yanıt beklemiyor.', { status });

/**
 * Change orders (docs/adr/0015). Lock order: the job row, then the change
 * order row; state changes are conditional updates. Accepting adds the
 * amount to the job's current total in the same transaction and never
 * touches the agreed price. A second accept (double tap, two devices) or
 * an accept racing a reject finds the order no longer PENDING: exactly one
 * of them wins and the total moves at most once.
 */
@Injectable()
export class ChangeOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: JobStore,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string, jobId: string): Promise<ChangeOrder[]> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, OR: [{ customer: { userId } }, { provider: { userId } }] },
      select: { changeOrders: { orderBy: { createdAt: 'asc' } } },
    });
    if (!job) throw changeOrderNotFoundForJob();
    return job.changeOrders.map(toChangeOrder);
  }

  async create(
    user: AuthUser,
    jobId: string,
    input: CreateChangeOrder,
    ipAddress: string | null,
  ): Promise<ChangeOrder> {
    let created: ChangeOrderRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const locked = await this.store.lockForParty(tx, jobId, user.id);
        const { job } = locked;
        if (locked.party !== 'PROVIDER') throw wrongParty();
        if (!canProposeChangeOrder(job.status)) {
          throw conflict(
            'CHANGE_ORDER_NOT_ALLOWED',
            'Ek iş yalnızca iş devam ederken eklenebilir.',
            { status: job.status },
          );
        }
        const pending = await tx.changeOrder.count({ where: { jobId, status: 'PENDING' } });
        if (pending > 0) throw alreadyPending();

        const amount = toMinor(input.amountMinor);
        let total: bigint;
        try {
          total = proposedTotal(job.currentTotalMinor, amount);
        } catch (error) {
          if (error instanceof ChangeOrderAmountError) {
            throw unprocessable('CHANGE_ORDER_INVALID_AMOUNT', 'Ek iş tutarı geçersiz.');
          }
          throw error;
        }
        const order = await tx.changeOrder.create({
          data: {
            jobId,
            requestedById: user.id,
            description: input.description,
            amountDeltaMinor: amount,
            currency: job.currency,
            previousTotalMinor: job.currentTotalMinor,
            proposedTotalMinor: total,
          },
        });
        await this.audit.recordIn(tx, {
          action: 'job.change_order.created',
          actorId: user.id,
          entityType: 'job',
          entityId: jobId,
          ipAddress,
          metadata: {
            changeOrderId: order.id,
            amountMinor: input.amountMinor,
            previousTotalMinor: Number(job.currentTotalMinor),
            proposedTotalMinor: Number(total),
          },
        });
        await this.notifications.enqueueIn(tx, [
          {
            userId: locked.customerUserId,
            type: NotificationEvent.CHANGE_ORDER_CREATED,
            title: `Ustanız ${formatMoney(input.amountMinor)} tutarında ek iş onayı istedi.`,
            body: `${input.description.slice(0, 120)} · Yeni toplam ${formatMoney(Number(total))}`,
            data: { jobId, changeOrderId: order.id },
          },
        ]);
        return order;
      });
    } catch (error) {
      // The partial unique index (one PENDING per job) backs the count above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw alreadyPending();
      }
      throw error;
    }
    return toChangeOrder(created);
  }

  accept(user: AuthUser, id: string, ip: string | null): Promise<ChangeOrder> {
    return this.answer(user, id, 'ACCEPT', ip);
  }
  reject(user: AuthUser, id: string, ip: string | null): Promise<ChangeOrder> {
    return this.answer(user, id, 'REJECT', ip);
  }
  cancel(user: AuthUser, id: string, ip: string | null): Promise<ChangeOrder> {
    return this.answer(user, id, 'CANCEL', ip);
  }

  private async answer(
    user: AuthUser,
    id: string,
    answer: ChangeOrderAnswer,
    ipAddress: string | null,
  ): Promise<ChangeOrder> {
    const ref = await this.prisma.changeOrder.findUnique({
      where: { id },
      select: { jobId: true },
    });
    if (!ref) throw changeOrderNotFound();
    const updated = await this.prisma.$transaction(async (tx) => {
      const locked = await this.lockParty(tx, ref.jobId, user.id);
      const order = await this.lockOrder(tx, id);
      const { job } = locked;
      if (locked.party !== ANSWERED_BY[answer]) throw wrongParty();
      const to = answerTransition(order.status, answer);
      if (!to) throw notPending(order.status);
      if (!canAnswerChangeOrder(job.status)) throw invalidTransition(job.status);

      const now = new Date();
      const moved = await tx.changeOrder.updateMany({
        where: { id, status: 'PENDING', version: order.version },
        data: { status: to, respondedAt: now, respondedById: user.id, version: { increment: 1 } },
      });
      if (moved.count === 0) throw notPending(order.status);

      if (answer === 'ACCEPT') {
        const total = totalAfterAccept(job.currentTotalMinor, order);
        if (total === null) {
          throw conflict('CHANGE_ORDER_STALE', 'İşin toplamı değişti; ek iş talebi güncel değil.');
        }
        // Conditional on the total it was proposed against: the amount is
        // added exactly once even if the lock were ever bypassed.
        const bumped = await tx.job.updateMany({
          where: { id: job.id, currentTotalMinor: order.previousTotalMinor },
          data: { currentTotalMinor: total, version: { increment: 1 } },
        });
        if (bumped.count === 0) {
          throw conflict('CHANGE_ORDER_STALE', 'İşin toplamı değişti; ek iş talebi güncel değil.');
        }
      }
      await this.audit.recordIn(tx, {
        action: AUDIT[answer],
        actorId: user.id,
        entityType: 'job',
        entityId: job.id,
        ipAddress,
        metadata: {
          changeOrderId: id,
          amountMinor: Number(order.amountDeltaMinor),
          ...(answer === 'ACCEPT' ? { newTotalMinor: Number(order.proposedTotalMinor) } : {}),
        },
      });
      const amount = formatMoney(Number(order.amountDeltaMinor));
      const data = { jobId: job.id, changeOrderId: id };
      await this.notifications.enqueueIn(
        tx,
        answer === 'ACCEPT'
          ? [
              {
                userId: locked.providerUserId,
                type: NotificationEvent.CHANGE_ORDER_ACCEPTED,
                title: `${amount} ek iş talebiniz onaylandı.`,
                body: `${locked.title} · Güncel toplam ${formatMoney(Number(order.proposedTotalMinor))}`,
                data,
              },
            ]
          : answer === 'REJECT'
            ? [
                {
                  userId: locked.providerUserId,
                  type: NotificationEvent.CHANGE_ORDER_REJECTED,
                  title: 'Ek iş talebiniz reddedildi.',
                  body: `${locked.title} · ${amount}`,
                  data,
                },
              ]
            : [
                {
                  userId: locked.customerUserId,
                  type: NotificationEvent.CHANGE_ORDER_CANCELLED,
                  title: 'Ustanız ek iş talebini geri çekti.',
                  body: `${locked.title} · ${amount}`,
                  data,
                },
              ],
      );
      return tx.changeOrder.findUniqueOrThrow({ where: { id } });
    });
    return toChangeOrder(updated);
  }

  /** The change order's job, locked; non-participants get a 404 for the order itself. */
  private async lockParty(tx: Tx, jobId: string, userId: string) {
    try {
      return await this.store.lockForParty(tx, jobId, userId);
    } catch (error) {
      if (isNotFound(error)) throw changeOrderNotFound();
      throw error;
    }
  }

  private async lockOrder(tx: Tx, id: string): Promise<ChangeOrderRow> {
    await tx.$queryRaw`SELECT id FROM change_orders WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.changeOrder.findUniqueOrThrow({ where: { id } });
  }
}

const alreadyPending = () =>
  conflict('CHANGE_ORDER_ALREADY_PENDING', 'Yanıt bekleyen bir ek iş talebi zaten var.');

const changeOrderNotFoundForJob = () => changeOrderNotFound();

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'getStatus' in error &&
    typeof (error as { getStatus: unknown }).getStatus === 'function' &&
    (error as { getStatus: () => number }).getStatus() === 404
  );
}
