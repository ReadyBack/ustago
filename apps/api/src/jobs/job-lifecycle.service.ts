import { Injectable } from '@nestjs/common';
import type { Job } from '@ustago/types';
import type { CancelJob, OpenDispute } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, unprocessable } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import {
  type NotificationDraft,
  NotificationsService,
} from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { QualityService } from '../quality/quality.service.js';
import {
  sourceStatuses,
  transitionFor as requestTransitionFor,
} from '../service-requests/domain/service-request-lifecycle.js';
import {
  disputeReasonAllowed,
  type JobAction,
  type JobStamp,
  transitionFor,
} from './domain/job-state-machine.js';
import { invalidTransition, pendingChangeOrder, wrongParty } from './job-errors.js';
import { OPEN_DISPUTE_STATUSES } from './job.mappers.js';
import { JobStore, type LockedJob } from './job.store.js';
import { JobsService } from './jobs.service.js';

type Tx = Prisma.TransactionClient;

const AUDIT_ACTION: Record<JobAction, string> = {
  EN_ROUTE: 'job.en_route',
  ARRIVE: 'job.arrived',
  START: 'job.started',
  REQUEST_COMPLETION: 'job.completion_requested',
  COMPLETE: 'job.completed',
  DISPUTE: 'job.disputed',
  CANCEL: 'job.cancelled',
};

const disputeAlreadyOpen = () =>
  conflict('DISPUTE_ALREADY_OPEN', 'Bu iş için zaten açık bir sorun bildirimi var.');

interface Extra {
  cancel?: CancelJob;
  dispute?: OpenDispute;
}

/**
 * Moves jobs through their lifecycle (docs/adr/0015). Every action runs in
 * one transaction: lock the job row, decide with the state machine, do a
 * conditional update on the source status, append the status history,
 * write the audit entry and the notification outbox rows. A repeated
 * action (double tap, retried request) finds the job already in the
 * target state and returns it without writing anything a second time.
 */
@Injectable()
export class JobLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: JobStore,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly quality: QualityService,
  ) {}

  enRoute(user: AuthUser, jobId: string, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'EN_ROUTE', ip);
  }
  arrive(user: AuthUser, jobId: string, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'ARRIVE', ip);
  }
  start(user: AuthUser, jobId: string, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'START', ip);
  }
  requestCompletion(user: AuthUser, jobId: string, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'REQUEST_COMPLETION', ip);
  }
  complete(user: AuthUser, jobId: string, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'COMPLETE', ip);
  }
  cancel(user: AuthUser, jobId: string, input: CancelJob, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'CANCEL', ip, { cancel: input });
  }
  dispute(user: AuthUser, jobId: string, input: OpenDispute, ip: string | null): Promise<Job> {
    return this.run(user, jobId, 'DISPUTE', ip, { dispute: input });
  }

  private async run(
    user: AuthUser,
    jobId: string,
    action: JobAction,
    ipAddress: string | null,
    extra: Extra = {},
  ): Promise<Job> {
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await this.store.lockForParty(tx, jobId, user.id);
        const { job, party } = locked;
        const decision = transitionFor(job.status, action, party);
        if (decision.kind === 'WRONG_PARTY') throw wrongParty();
        if (decision.kind === 'ALREADY_DONE') {
          // Retried request: nothing new is written. A second, different
          // dispute is not a retry, though.
          if (action === 'DISPUTE') throw disputeAlreadyOpen();
          return;
        }
        if (decision.kind === 'INVALID') throw invalidTransition(job.status);

        await this.guard(tx, locked, action, extra);

        const now = new Date();
        const stamp: Partial<Record<JobStamp, Date>> = { [decision.stamp]: now };
        const moved = await tx.job.updateMany({
          where: { id: jobId, status: decision.from, version: job.version },
          data: {
            status: decision.to,
            ...stamp,
            version: { increment: 1 },
            ...(action === 'CANCEL'
              ? {
                  cancelledById: user.id,
                  cancellationActor: party,
                  cancellationReason: extra.cancel?.reason ?? null,
                }
              : {}),
          },
        });
        // The row is locked, so this only happens if the lock was bypassed.
        if (moved.count === 0) throw invalidTransition(job.status);

        await tx.jobStatusHistory.create({
          data: {
            jobId,
            fromStatus: decision.from,
            toStatus: decision.to,
            actorUserId: user.id,
            reason: action.toLowerCase(),
            metadata: { actor: party },
          },
        });
        await this.sideEffects(tx, locked, action, extra, now);
        await this.audit.recordIn(tx, {
          action: AUDIT_ACTION[action],
          actorId: user.id,
          entityType: 'job',
          entityId: jobId,
          ipAddress,
          metadata: {
            from: decision.from,
            to: decision.to,
            actor: party,
            ...(extra.dispute ? { reason: extra.dispute.reason } : {}),
          },
        });
        await this.notifications.enqueueIn(tx, this.notificationsFor(locked, action, extra));
        if (action === 'COMPLETE' || action === 'CANCEL') {
          await this.quality.recalculateIn(tx, [job.providerId], now);
        }
      });
    } catch (error) {
      // One open dispute per job is also a unique index.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw disputeAlreadyOpen();
      }
      throw error;
    }
    return this.jobs.get(user.id, jobId);
  }

  private async guard(tx: Tx, locked: LockedJob, action: JobAction, extra: Extra): Promise<void> {
    const jobId = locked.job.id;
    if (action === 'REQUEST_COMPLETION') {
      const pending = await tx.changeOrder.count({ where: { jobId, status: 'PENDING' } });
      if (pending > 0) throw pendingChangeOrder();
    }
    if (action === 'DISPUTE') {
      const input = extra.dispute;
      if (!input || !disputeReasonAllowed(locked.job.status, input.reason)) {
        throw unprocessable(
          'DISPUTE_REASON_NOT_ALLOWED',
          'Usta adrese gelmeden yalnızca "Usta gelmedi" bildirimi yapılabilir.',
        );
      }
      const open = await tx.dispute.count({
        where: { jobId, status: { in: [...OPEN_DISPUTE_STATUSES] } },
      });
      if (open > 0) throw disputeAlreadyOpen();
    }
  }

  private async sideEffects(
    tx: Tx,
    locked: LockedJob,
    action: JobAction,
    extra: Extra,
    now: Date,
  ): Promise<void> {
    const { job } = locked;
    if (action === 'COMPLETE' || action === 'CANCEL') {
      const event = action === 'COMPLETE' ? 'JOB_COMPLETED' : 'JOB_CANCELLED';
      const request = await tx.serviceRequest.findUniqueOrThrow({
        where: { id: job.serviceRequestId },
        select: { status: true, type: true },
      });
      const to = requestTransitionFor(request.status, event, request.type);
      if (to) {
        await tx.serviceRequest.updateMany({
          where: { id: job.serviceRequestId, status: { in: [...sourceStatuses(event)] } },
          data: {
            status: to,
            version: { increment: 1 },
            ...(to === 'CANCELLED'
              ? { cancelledAt: now, cancelReason: extra.cancel?.reason ?? null }
              : {}),
          },
        });
      }
    }
    if (action === 'CANCEL' || action === 'DISPUTE') {
      // Nothing to answer any more: an open extra-work request is withdrawn.
      await tx.changeOrder.updateMany({
        where: { jobId: job.id, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: now, version: { increment: 1 } },
      });
    }
    if (action === 'DISPUTE' && extra.dispute) {
      await tx.dispute.create({
        data: {
          jobId: job.id,
          openedById: locked.customerUserId,
          againstId: locked.providerUserId,
          reason: extra.dispute.reason,
          description: extra.dispute.description,
        },
      });
    }
  }

  private notificationsFor(
    locked: LockedJob,
    action: JobAction,
    extra: Extra,
  ): NotificationDraft[] {
    const { job, title, providerName, customerUserId, providerUserId, party } = locked;
    const data = { jobId: job.id };
    const toCustomer = (type: string, heading: string, body: string): NotificationDraft => ({
      userId: customerUserId,
      type,
      title: heading,
      body,
      data,
    });
    const toProvider = (type: string, heading: string, body: string): NotificationDraft => ({
      userId: providerUserId,
      type,
      title: heading,
      body,
      data,
    });
    switch (action) {
      case 'EN_ROUTE':
        return [
          toCustomer(NotificationEvent.JOB_EN_ROUTE, 'Ustanız yola çıktı.', `${providerName} · ${title}`),
        ];
      case 'ARRIVE':
        return [
          toCustomer(NotificationEvent.JOB_ARRIVED, 'Ustanız adrese ulaştı.', `${providerName} · ${title}`),
        ];
      case 'START':
        return [
          toCustomer(NotificationEvent.JOB_STARTED, 'Ustanız işe başladı.', `${providerName} · ${title}`),
        ];
      case 'REQUEST_COMPLETION':
        return [
          toCustomer(
            NotificationEvent.JOB_COMPLETION_REQUESTED,
            'Ustanız işi tamamladığını bildirdi. Lütfen kontrol edin.',
            title,
          ),
        ];
      case 'COMPLETE':
        return [
          toProvider(
            NotificationEvent.JOB_COMPLETED,
            'Müşteri işin tamamlandığını onayladı.',
            title,
          ),
        ];
      case 'DISPUTE':
        return [
          toProvider(
            NotificationEvent.JOB_DISPUTED,
            'Müşteri işle ilgili bir sorun bildirdi.',
            `${title}. UstaGO ekibi inceleyecek.`,
          ),
        ];
      case 'CANCEL': {
        const reason = extra.cancel?.reason ? ` Neden: ${extra.cancel.reason}` : '';
        return party === 'CUSTOMER'
          ? [toProvider(NotificationEvent.JOB_CANCELLED, 'Müşteri işi iptal etti.', `${title}.${reason}`)]
          : [toCustomer(NotificationEvent.JOB_CANCELLED, 'Usta işi iptal etti.', `${title}.${reason}`)];
      }
    }
  }
}
