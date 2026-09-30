import { Injectable } from '@nestjs/common';
import type { AppNotification } from '@ustago/types';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface NotificationDraft {
  userId: string;
  /** Event key, e.g. "quote.created", "now.new_request". */
  type: string;
  title: string;
  body: string;
  /** Ids the app needs to open the right screen. Never personal data. */
  data?: Record<string, string>;
}

/**
 * In-app notifications, written as an outbox (docs/adr/0014): rows are
 * inserted in the same transaction as the business change, so nothing is
 * announced for a change that rolled back. They are shown in the app
 * (pull-to-refresh / polling). A push worker that sends PENDING rows to
 * Expo Push / FCM is a later phase; until then no push is sent.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async enqueueIn(tx: Prisma.TransactionClient, drafts: NotificationDraft[]): Promise<void> {
    if (drafts.length === 0) return;
    await tx.notification.createMany({
      data: drafts.map((d) => ({
        userId: d.userId,
        type: d.type,
        channel: 'IN_APP',
        status: 'PENDING',
        title: d.title.slice(0, 140),
        body: d.body.slice(0, 1000),
        ...(d.data ? { data: d.data } : {}),
      })),
    });
  }

  async list(userId: string, limit = 30): Promise<AppNotification[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId, channel: 'IN_APP' },
      orderBy: { id: 'desc' },
      take: limit,
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      data: isStringRecord(n.data) ? n.data : null,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async markRead(userId: string, ids?: string[]): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
      data: { readAt: new Date(), status: 'READ' },
    });
    return result.count;
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === 'string')
  );
}
