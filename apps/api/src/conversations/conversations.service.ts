import { Injectable } from '@nestjs/common';
import type {
  BadgeCounts,
  ConversationDetail,
  ConversationListItem,
  ConversationRole,
  Paginated,
} from '@ustago/types';
import type { ListConversationsQuery, OpenConversation } from '@ustago/validation';

import { MarketplaceEventsService } from '../analytics/marketplace-events.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { badRequest, notFound } from '../common/http/errors.js';
import { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { categoryRefSelect, toCategoryRef } from '../service-requests/service-request.mappers.js';
import {
  cannotSendReason,
  counterpartRole,
  customerDisplayName,
  decodeConversationCursor,
  encodeConversationCursor,
  messagePreview,
} from './conversation-rules.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export const conversationNotFound = () => notFound('CONVERSATION_NOT_FOUND', 'Konuşma bulunamadı.');

/** Everything a conversation view needs; no phone, e-mail or address. */
export const conversationInclude = {
  serviceRequest: {
    select: {
      id: true,
      title: true,
      status: true,
      categoryId: true,
      provinceId: true,
      districtId: true,
      category: { select: categoryRefSelect },
      job: { select: { id: true, providerId: true } },
    },
  },
  provider: { select: { id: true, displayName: true, userId: true } },
  customer: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
  participants: { select: { userId: true, role: true, lastReadAt: true } },
  messages: {
    orderBy: { id: 'desc' },
    take: 1,
    select: { type: true, body: true, senderId: true, createdAt: true, deletedAt: true },
  },
} satisfies Prisma.ConversationInclude;

export type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

/** The caller's side of a conversation they take part in. */
export interface ParticipantView {
  row: ConversationRow;
  myUserId: string;
  myRole: ConversationRole;
  myLastReadAt: Date | null;
  counterpartUserId: string;
  counterpartLastReadAt: Date | null;
}

export interface SystemEventInput {
  serviceRequestId: string;
  providerId: string;
  /** Unique per conversation, e.g. "quote_accepted:<quoteId>". */
  eventKey: string;
  body: string;
}

/**
 * Faz 7 messaging: one conversation per (service request, provider),
 * opened once the provider has a quote on the request or a job. Only the
 * two participants may read it; anyone else gets 404 as if it did not
 * exist (admins included: support reads a conversation only through a
 * message report, with a reason, audited).
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: MarketplaceEventsService,
  ) {}

  /** POST /conversations: idempotent, returns the existing conversation if open. */
  async open(user: AuthUser, input: OpenConversation): Promise<ConversationDetail> {
    const party = await this.partyOf(user.id, input);
    const existing = await this.prisma.conversation.findUnique({
      where: {
        serviceRequestId_providerId: {
          serviceRequestId: party.serviceRequestId,
          providerId: party.providerId,
        },
      },
      select: { id: true },
    });
    if (existing) return this.detail(user, existing.id);
    let id: string;
    try {
      id = await this.prisma.$transaction(async (tx) => {
        const created = await tx.conversation.create({
          data: {
            serviceRequestId: party.serviceRequestId,
            providerId: party.providerId,
            customerId: party.customerId,
            jobId: party.jobId,
            lastMessageAt: new Date(),
            participants: {
              create: [
                { userId: party.customerUserId, role: 'CUSTOMER' },
                { userId: party.providerUserId, role: 'PROVIDER' },
              ],
            },
          },
          select: { id: true },
        });
        await this.events.recordIn(tx, {
          type: 'conversation_started',
          serviceRequestId: party.serviceRequestId,
          providerId: party.providerId,
          categoryId: party.categoryId,
          provinceId: party.provinceId,
          districtId: party.districtId,
          metadata: { openedBy: party.role },
        });
        return created.id;
      });
    } catch (error) {
      // Both sides opened it at the same moment: return the winner's row.
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.conversation.findUniqueOrThrow({
        where: {
          serviceRequestId_providerId: {
            serviceRequestId: party.serviceRequestId,
            providerId: party.providerId,
          },
        },
        select: { id: true },
      });
      id = winner.id;
    }
    return this.detail(user, id);
  }

  async list(
    user: AuthUser,
    query: ListConversationsQuery,
  ): Promise<Paginated<ConversationListItem>> {
    let keyset: Prisma.ConversationWhereInput = {};
    if (query.cursor) {
      const c = decodeConversationCursor(query.cursor);
      if (!c) throw badRequest('INVALID_CURSOR', 'Geçersiz sayfa imleci.');
      keyset = {
        OR: [{ lastMessageAt: { lt: c.at } }, { lastMessageAt: c.at, id: { lt: c.id } }],
      };
    }
    const rows = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId: user.id } }, ...keyset },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: conversationInclude,
    });
    const page = rows.slice(0, query.limit);
    const unread = await this.unreadCounts(
      user.id,
      page.map((r) => r.id),
    );
    const last = page.at(-1);
    return {
      items: page.map((r) => this.listItem(this.viewAs(r, user.id), unread.get(r.id) ?? 0)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeConversationCursor(activityAt(last), last.id)
          : null,
    };
  }

  async detail(user: AuthUser, conversationId: string): Promise<ConversationDetail> {
    const view = await this.access(user.id, conversationId);
    return this.detailOf(view);
  }

  /** PUT/DELETE /conversations/:id/block: blocks the counterpart user (all their chats with me). */
  async setBlock(
    user: AuthUser,
    conversationId: string,
    blocked: boolean,
  ): Promise<ConversationDetail> {
    const view = await this.access(user.id, conversationId);
    if (blocked) {
      await this.prisma.userBlock.createMany({
        data: [{ blockerId: user.id, blockedId: view.counterpartUserId }],
        skipDuplicates: true,
      });
    } else {
      await this.prisma.userBlock.deleteMany({
        where: { blockerId: user.id, blockedId: view.counterpartUserId },
      });
    }
    return this.detailOf(view);
  }

  async badges(user: AuthUser): Promise<BadgeCounts> {
    const [notifications, unread] = await Promise.all([
      this.notifications.unreadCount(user.id),
      this.unreadCounts(user.id),
    ]);
    let messages = 0;
    for (const n of unread.values()) messages += n;
    return { notifications, messages };
  }

  /**
   * For other modules (quotes, jobs): writes a SYSTEM message ("Teklif
   * kabul edildi") inside their transaction, only when the conversation
   * already exists. The same `eventKey` twice is ignored (no error, so the
   * caller's transaction is not aborted). No notification: the domain
   * event already notified both sides. Returns whether a message was written.
   */
  async postSystemEventIn(tx: Tx, input: SystemEventInput): Promise<boolean> {
    const conversation = await tx.conversation.findUnique({
      where: {
        serviceRequestId_providerId: {
          serviceRequestId: input.serviceRequestId,
          providerId: input.providerId,
        },
      },
      select: { id: true, jobId: true },
    });
    if (!conversation) return false;
    const now = new Date();
    const written = await tx.message.createMany({
      data: [
        {
          conversationId: conversation.id,
          type: 'SYSTEM',
          senderId: null,
          eventKey: input.eventKey.slice(0, 120),
          body: input.body.trim().slice(0, 2000),
          createdAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (written.count === 0) return false;
    const jobId =
      conversation.jobId ?? (await this.jobIdFor(tx, input.serviceRequestId, input.providerId));
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, ...(jobId ? { jobId } : {}) },
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Shared with the messages service
  // -------------------------------------------------------------------------

  /** The conversation as seen by a participant, or 404 for everyone else. */
  async access(
    userId: string,
    conversationId: string,
    db: Db = this.prisma,
  ): Promise<ParticipantView> {
    const row = await db.conversation.findFirst({
      where: { id: conversationId, participants: { some: { userId } } },
      include: conversationInclude,
    });
    if (!row) throw conversationNotFound();
    // A job created after the conversation opened is linked on first sight.
    const job = row.serviceRequest.job;
    if (row.jobId === null && job && job.providerId === row.providerId) {
      await db.conversation.update({ where: { id: row.id }, data: { jobId: job.id } });
      row.jobId = job.id;
    }
    return this.viewAs(row, userId);
  }

  viewAs(row: ConversationRow, userId: string): ParticipantView {
    const me = row.participants.find((p) => p.userId === userId);
    const other = row.participants.find((p) => p.userId !== userId);
    if (!me || !other) throw conversationNotFound();
    return {
      row,
      myUserId: userId,
      myRole: me.role,
      myLastReadAt: me.lastReadAt,
      counterpartUserId: other.userId,
      counterpartLastReadAt: other.lastReadAt,
    };
  }

  async blockState(
    userId: string,
    counterpartUserId: string,
    db: Db = this.prisma,
  ): Promise<{ blockedByMe: boolean; blockedByCounterpart: boolean }> {
    const blocks = await db.userBlock.findMany({
      where: {
        OR: [
          { blockerId: userId, blockedId: counterpartUserId },
          { blockerId: counterpartUserId, blockedId: userId },
        ],
      },
      select: { blockerId: true },
    });
    return {
      blockedByMe: blocks.some((b) => b.blockerId === userId),
      blockedByCounterpart: blocks.some((b) => b.blockerId === counterpartUserId),
    };
  }

  async sendability(view: ParticipantView, db: Db = this.prisma) {
    const blocks = await this.blockState(view.myUserId, view.counterpartUserId, db);
    const reason = cannotSendReason({
      providerId: view.row.providerId,
      requestStatus: view.row.serviceRequest.status,
      jobProviderId: view.row.serviceRequest.job?.providerId ?? null,
      ...blocks,
    });
    return { reason, blockedByMe: blocks.blockedByMe };
  }

  /** Name of one side as the other side sees it. */
  nameOf(row: ConversationRow, role: ConversationRole): string {
    return role === 'PROVIDER'
      ? row.provider.displayName
      : customerDisplayName(row.customer.user.firstName, row.customer.user.lastName);
  }

  /**
   * Unread messages per conversation for a user: messages from the other
   * side after the user's read marker. SYSTEM messages are not counted (the
   * domain already sent a notification for them).
   */
  async unreadCounts(userId: string, conversationIds?: string[]): Promise<Map<string, number>> {
    if (conversationIds && conversationIds.length === 0) return new Map();
    const filter = conversationIds
      ? Prisma.sql`AND p.conversation_id IN (${Prisma.join(conversationIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<{ conversation_id: string; unread: bigint }[]>`
      SELECT p.conversation_id, COUNT(m.id) AS unread
      FROM conversation_participants p
      JOIN messages m
        ON m.conversation_id = p.conversation_id
       AND m.type <> 'SYSTEM'
       AND m.deleted_at IS NULL
       AND m.sender_id IS DISTINCT FROM p.user_id
       AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
      WHERE p.user_id = ${userId}::uuid ${filter}
      GROUP BY p.conversation_id`;
    return new Map(rows.map((r) => [r.conversation_id, Number(r.unread)]));
  }

  // -------------------------------------------------------------------------

  private async detailOf(view: ParticipantView): Promise<ConversationDetail> {
    const [unread, send] = await Promise.all([
      this.unreadCounts(view.myUserId, [view.row.id]),
      this.sendability(view),
    ]);
    return {
      ...this.listItem(view, unread.get(view.row.id) ?? 0),
      myRole: view.myRole,
      canSend: send.reason === null,
      cannotSendReason: send.reason,
      blockedByMe: send.blockedByMe,
      counterpartLastReadAt: view.counterpartLastReadAt?.toISOString() ?? null,
    };
  }

  private listItem(view: ParticipantView, unreadCount: number): ConversationListItem {
    const { row } = view;
    const other = counterpartRole(view.myRole);
    const last = row.messages[0];
    return {
      id: row.id,
      serviceRequestId: row.serviceRequestId,
      jobId:
        row.jobId ??
        (row.serviceRequest.job?.providerId === row.providerId ? row.serviceRequest.job.id : null),
      title: row.serviceRequest.title,
      category: toCategoryRef(row.serviceRequest.category),
      counterpart: {
        role: other,
        name: this.nameOf(row, other),
        providerId: other === 'PROVIDER' ? row.providerId : null,
      },
      lastMessage: last
        ? {
            type: last.type,
            preview: messagePreview(last.type, last.body, last.deletedAt !== null),
            createdAt: last.createdAt.toISOString(),
            mine: last.senderId !== null && last.senderId === view.myUserId,
          }
        : null,
      unreadCount,
      updatedAt: activityAt(row).toISOString(),
    };
  }

  /** Who opens a conversation for a quote or a job: its customer or its provider. */
  private async partyOf(userId: string, input: OpenConversation) {
    if (input.quoteId) {
      const quote = await this.prisma.quote.findUnique({
        where: { id: input.quoteId },
        select: {
          providerId: true,
          provider: { select: { userId: true } },
          serviceRequest: {
            select: {
              id: true,
              customerId: true,
              categoryId: true,
              provinceId: true,
              districtId: true,
              customer: { select: { userId: true } },
              job: { select: { id: true, providerId: true } },
            },
          },
        },
      });
      const role = quote
        ? roleIn(userId, quote.serviceRequest.customer.userId, quote.provider.userId)
        : null;
      if (!quote || !role) throw notFound('QUOTE_NOT_FOUND', 'Teklif bulunamadı.');
      const r = quote.serviceRequest;
      return {
        role,
        serviceRequestId: r.id,
        providerId: quote.providerId,
        customerId: r.customerId,
        customerUserId: r.customer.userId,
        providerUserId: quote.provider.userId,
        jobId: r.job && r.job.providerId === quote.providerId ? r.job.id : null,
        categoryId: r.categoryId,
        provinceId: r.provinceId,
        districtId: r.districtId,
      };
    }
    const job = await this.prisma.job.findUnique({
      where: { id: input.jobId ?? '' },
      select: {
        id: true,
        providerId: true,
        customerId: true,
        serviceRequestId: true,
        customer: { select: { userId: true } },
        provider: { select: { userId: true } },
        serviceRequest: { select: { categoryId: true, provinceId: true, districtId: true } },
      },
    });
    const role = job ? roleIn(userId, job.customer.userId, job.provider.userId) : null;
    if (!job || !role) throw notFound('JOB_NOT_FOUND', 'İş bulunamadı.');
    return {
      role,
      serviceRequestId: job.serviceRequestId,
      providerId: job.providerId,
      customerId: job.customerId,
      customerUserId: job.customer.userId,
      providerUserId: job.provider.userId,
      jobId: job.id,
      categoryId: job.serviceRequest.categoryId,
      provinceId: job.serviceRequest.provinceId,
      districtId: job.serviceRequest.districtId,
    };
  }

  private async jobIdFor(tx: Tx, serviceRequestId: string, providerId: string) {
    const job = await tx.job.findUnique({
      where: { serviceRequestId },
      select: { id: true, providerId: true },
    });
    return job && job.providerId === providerId ? job.id : null;
  }
}

function roleIn(
  userId: string,
  customerUserId: string,
  providerUserId: string,
): ConversationRole | null {
  if (userId === customerUserId) return 'CUSTOMER';
  if (userId === providerUserId) return 'PROVIDER';
  return null;
}

/** Last activity: the newest message, or the opening time. */
function activityAt(row: { lastMessageAt: Date | null; createdAt: Date }): Date {
  return row.lastMessageAt ?? row.createdAt;
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
