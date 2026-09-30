import { Inject, Injectable } from '@nestjs/common';
import type { AppNotification, NotificationPreferences, Paginated } from '@ustago/types';
import type { ListNotificationsQuery, UpdateNotificationPreferences } from '@ustago/validation';

import { localMinuteOfDay } from '../common/utils/local-time.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { NotificationPreference, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DEFAULT_PUSH_PREFERENCES,
  notificationTab,
  notificationTarget,
  type PushPreferences,
  wantsPush,
} from './notification-events.js';

export interface NotificationDraft {
  userId: string;
  /** Event key, see NotificationEvent (e.g. "job.en_route"). */
  type: string;
  title: string;
  body: string;
  /** Ids the app needs to open the right screen. Never personal data. */
  data?: Record<string, string>;
  /** Faz 7: false = in-app only (e.g. a provider's "sessiz" new-job alerts). */
  push?: boolean;
}

/**
 * Notifications as an outbox (docs/adr/0014, 0017).
 *
 * `enqueueIn` runs inside the business transaction: the in-app row and,
 * when the user gets pushes for this kind of event, a PENDING push
 * delivery are written together with the state change, so nothing is
 * announced for a change that rolled back and nothing is lost if the push
 * service is down. The push worker sends after commit; the in-app row is
 * the source of truth whatever happens to the push.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async enqueueIn(tx: Prisma.TransactionClient, drafts: NotificationDraft[]): Promise<void> {
    if (drafts.length === 0) return;
    const rows = await tx.notification.createManyAndReturn({
      data: drafts.map((d) => {
        const target = notificationTarget(d.type, d.data);
        return {
          userId: d.userId,
          type: d.type,
          channel: 'IN_APP' as const,
          status: 'PENDING' as const,
          title: d.title.slice(0, 140),
          body: d.body.slice(0, 1000),
          category: notificationTab(d.type),
          ...(d.data ? { data: d.data } : {}),
          ...(target ?? {}),
        };
      }),
      select: { id: true, userId: true, type: true },
    });
    const prefs = await tx.notificationPreference.findMany({
      where: { userId: { in: [...new Set(rows.map((r) => r.userId))] } },
      select: {
        userId: true,
        quoteUpdatesPush: true,
        newMessagePush: true,
        newJobAlerts: true,
        quietHoursStart: true,
        quietHoursEnd: true,
      },
    });
    const prefsBy = new Map<string, PushPreferences>(prefs.map((p) => [p.userId, p]));
    const localMinute = localMinuteOfDay(new Date(), this.env.MARKETPLACE_TIME_ZONE);
    const noPush = new Set(drafts.flatMap((d, i) => (d.push === false ? [i] : [])));
    const push = rows.filter(
      (r, i) =>
        !noPush.has(i) &&
        wantsPush(r.type, prefsBy.get(r.userId) ?? DEFAULT_PUSH_PREFERENCES, localMinute),
    );
    if (push.length > 0) {
      await tx.pushDelivery.createMany({ data: push.map((r) => ({ notificationId: r.id })) });
    }
  }

  async list(userId: string, query: ListNotificationsQuery): Promise<Paginated<AppNotification>> {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        channel: 'IN_APP',
        ...(query.unreadOnly ? { readAt: null } : {}),
        ...(query.category ? { category: query.category } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: isStringRecord(n.data) ? n.data : null,
        entityType: n.entityType,
        entityId: n.entityId,
        deepLink: n.deepLink,
        category: (n.category as AppNotification['category'] | null) ?? notificationTab(n.type),
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, channel: 'IN_APP', readAt: null } });
  }

  async markRead(userId: string, ids?: string[]): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date(), status: 'READ' },
    });
    return result.count;
  }

  async preferences(userId: string): Promise<NotificationPreferences> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return toPreferences(row);
  }

  async updatePreferences(
    userId: string,
    input: UpdateNotificationPreferences,
  ): Promise<NotificationPreferences> {
    const data = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Prisma.NotificationPreferenceUpdateInput;
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...(data as Omit<Prisma.NotificationPreferenceUncheckedCreateInput, 'userId'>),
      },
      update: data,
    });
    return toPreferences(row);
  }
}

function toPreferences(row: NotificationPreference | null): NotificationPreferences {
  const d = DEFAULT_PUSH_PREFERENCES;
  return {
    jobUpdatesPush: true,
    financePush: true,
    quoteUpdatesPush: row?.quoteUpdatesPush ?? d.quoteUpdatesPush,
    newMessagePush: row?.newMessagePush ?? d.newMessagePush,
    marketingPush: row?.marketingPush ?? false,
    newJobAlerts: row?.newJobAlerts ?? d.newJobAlerts,
    quietHoursStart: row?.quietHoursStart ?? null,
    quietHoursEnd: row?.quietHoursEnd ?? null,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}
