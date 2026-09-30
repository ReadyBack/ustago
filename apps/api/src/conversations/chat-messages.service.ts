import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ChatMessage, MessagePage, SignedUrl, UploadIntentResponse } from '@ustago/types';
import {
  type ImageUploadIntent,
  type ListMessagesQuery,
  looksLikeContactInfo,
  type ReportMessage,
  type SendMessage,
} from '@ustago/validation';

import { MarketplaceEventsService } from '../analytics/marketplace-events.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { uuidv7 } from '../common/crypto/uuid.js';
import { forbidden, notFound, serviceUnavailable, unprocessable } from '../common/http/errors.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import type { Prisma } from '../generated/prisma/client.js';
import { NotificationEvent } from '../notifications/notification-events.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { detectMimeType, extensionFor, SIGNATURE_BYTES } from '../storage/file-signature.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  StorageUnavailableError,
} from '../storage/object-storage.js';
import { counterpartRole, deliveryState, newMessageNotice } from './conversation-rules.js';
import {
  ConversationsService,
  isUniqueViolation,
  type ParticipantView,
} from './conversations.service.js';

type Tx = Prisma.TransactionClient;

const IMAGE_URL_TTL_SECONDS = 300;
const IMAGE_UPLOADS_PER_HOUR = 60;
/** One MESSAGE_NEW per conversation while an earlier one is unread and this recent. */
export const MESSAGE_NOTIFICATION_COALESCE_MS = 5 * 60_000;

const messageNotFound = () => notFound('MESSAGE_NOT_FOUND', 'Mesaj bulunamadı.');
const uploadNotFound = () => notFound('UPLOAD_NOT_FOUND', 'Yükleme bulunamadı.');
const invalidImage = (message: string, details?: unknown) =>
  unprocessable('INVALID_CHAT_IMAGE', message, details);
const storageUnavailable = () =>
  serviceUnavailable('STORAGE_UNAVAILABLE', 'Fotoğraf yükleme şu anda kullanılamıyor.');

/** Thrown inside the send transaction when a concurrent retry already used the upload. */
class UploadAlreadyUsed extends Error {}

const messageSelect = {
  id: true,
  conversationId: true,
  senderId: true,
  type: true,
  body: true,
  clientMessageId: true,
  storageKey: true,
  containsContactInfo: true,
  createdAt: true,
  deletedAt: true,
} satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;

interface InspectedImage {
  uploadId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Sending and reading messages. Chat never changes a price: quotes, change
 * orders and jobs are not touched here. Phone numbers and e-mails are only
 * flagged (`containsContactInfo`), never masked or refused.
 */
@Injectable()
export class ChatMessagesService {
  private readonly logger = new Logger(ChatMessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly notifications: NotificationsService,
    private readonly events: MarketplaceEventsService,
    private readonly rateLimit: RateLimitService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async list(
    user: AuthUser,
    conversationId: string,
    query: ListMessagesQuery,
  ): Promise<MessagePage> {
    const view = await this.conversations.access(user.id, conversationId);
    const where = { conversationId };
    let rows: MessageRow[];
    let hasMoreBefore: boolean;
    if (query.after) {
      rows = await this.prisma.message.findMany({
        where: { ...where, id: { gt: query.after } },
        orderBy: { id: 'asc' },
        take: query.limit,
        select: messageSelect,
      });
      const first = rows[0]?.id;
      const older = await this.prisma.message.count({
        where: { ...where, id: first ? { lt: first } : { lte: query.after } },
        take: 1,
      });
      hasMoreBefore = older > 0;
    } else {
      const desc = await this.prisma.message.findMany({
        where: { ...where, ...(query.before ? { id: { lt: query.before } } : {}) },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
        select: messageSelect,
      });
      hasMoreBefore = desc.length > query.limit;
      rows = desc.slice(0, query.limit).reverse();
    }
    return { items: rows.map((m) => this.toMessage(view, m)), hasMoreBefore };
  }

  async send(user: AuthUser, conversationId: string, input: SendMessage): Promise<ChatMessage> {
    const view = await this.conversations.access(user.id, conversationId);
    // A retry of a message that was stored returns it, whatever happened since.
    const previous = await this.findByClientId(conversationId, user.id, input.clientMessageId);
    if (previous) return this.toMessage(view, previous);

    const { reason } = await this.conversations.sendability(view);
    if (reason === 'BLOCKED') {
      throw forbidden('CONVERSATION_BLOCKED', 'Bu kişiyle mesajlaşma engellendi.');
    }
    if (reason === 'CLOSED') {
      throw forbidden(
        'CONVERSATION_CLOSED',
        'Bu konuşma kapandı; yalnızca geçmiş görüntülenebilir.',
      );
    }
    await this.rateLimit.enforce(
      {
        bucket: 'chat:minute',
        subject: `${user.id}:${conversationId}`,
        limit: this.env.CHAT_RATE_LIMIT_PER_MINUTE,
        windowSeconds: 60,
      },
      {
        bucket: 'chat:hour',
        subject: user.id,
        limit: this.env.CHAT_RATE_LIMIT_PER_HOUR,
        windowSeconds: 3600,
      },
    );
    const image =
      input.type === 'IMAGE'
        ? await this.inspectImage(user.id, conversationId, input.uploadId)
        : null;

    let stored: MessageRow;
    try {
      stored = await this.prisma.$transaction(async (tx) => {
        const now = Date.now();
        const createdAt = new Date(now);
        if (image) {
          const consumed = await tx.uploadIntent.updateMany({
            where: { id: image.uploadId, consumedAt: null },
            data: { consumedAt: createdAt },
          });
          if (consumed.count === 0) throw new UploadAlreadyUsed();
        }
        const message = await tx.message.create({
          data: {
            // Time-ordered id with the same millisecond as createdAt, so
            // id order (the page cursor) and read markers agree.
            id: uuidv7(now),
            conversationId,
            senderId: user.id,
            type: input.type,
            clientMessageId: input.clientMessageId,
            createdAt,
            ...(input.type === 'TEXT'
              ? { body: input.body, containsContactInfo: looksLikeContactInfo(input.body) }
              : {}),
            ...(image
              ? {
                  uploadIntentId: image.uploadId,
                  storageKey: image.storageKey,
                  mimeType: image.mimeType,
                  sizeBytes: image.sizeBytes,
                }
              : {}),
          },
          select: messageSelect,
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: createdAt },
        });
        // Writing a message means the sender has seen everything before it.
        await tx.conversationParticipant.updateMany({
          where: {
            conversationId,
            userId: user.id,
            OR: [{ lastReadAt: null }, { lastReadAt: { lt: createdAt } }],
          },
          data: { lastReadAt: createdAt },
        });
        await this.notifyIn(tx, view, input.type, createdAt);
        await this.events.recordIn(tx, {
          type: 'message_sent',
          serviceRequestId: view.row.serviceRequestId,
          providerId: view.row.providerId,
          categoryId: view.row.serviceRequest.categoryId,
          provinceId: view.row.serviceRequest.provinceId,
          districtId: view.row.serviceRequest.districtId,
          metadata: { messageType: input.type, senderRole: view.myRole },
        });
        return message;
      });
    } catch (error) {
      // Concurrent retry with the same clientMessageId: the first one won.
      if (isUniqueViolation(error) || error instanceof UploadAlreadyUsed) {
        const winner = await this.findByClientId(conversationId, user.id, input.clientMessageId);
        if (winner) return this.toMessage(view, winner);
        if (error instanceof UploadAlreadyUsed) throw uploadNotFound();
      }
      throw error;
    }
    metrics.chatMessages.inc({ type: input.type });
    return this.toMessage(view, stored);
  }

  /** POST /conversations/:id/read: moves my read marker forward to that message. */
  async markRead(user: AuthUser, conversationId: string, messageId: string): Promise<void> {
    await this.conversations.access(user.id, conversationId);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId },
      select: { createdAt: true },
    });
    if (!message) throw messageNotFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.conversationParticipant.updateMany({
        where: {
          conversationId,
          userId: user.id,
          OR: [{ lastReadAt: null }, { lastReadAt: { lt: message.createdAt } }],
        },
        data: { lastReadAt: message.createdAt },
      });
      // The conversation's "new message" notifications are read as well.
      await tx.notification.updateMany({
        where: {
          userId: user.id,
          type: NotificationEvent.MESSAGE_NEW,
          entityId: conversationId,
          readAt: null,
        },
        data: { readAt: new Date(), status: 'READ' },
      });
    });
  }

  async createImageUploadIntent(
    user: AuthUser,
    conversationId: string,
    input: ImageUploadIntent,
  ): Promise<UploadIntentResponse> {
    const view = await this.conversations.access(user.id, conversationId);
    const { reason } = await this.conversations.sendability(view);
    if (reason) {
      throw forbidden(
        reason === 'BLOCKED' ? 'CONVERSATION_BLOCKED' : 'CONVERSATION_CLOSED',
        'Bu konuşmaya fotoğraf gönderilemez.',
      );
    }
    const maxSizeBytes = this.env.MEDIA_IMAGE_MAX_BYTES;
    if (input.sizeBytes > maxSizeBytes) throw invalidImage('Fotoğraf çok büyük.', { maxSizeBytes });
    await this.rateLimit.enforce({
      bucket: 'chat-image:user',
      subject: user.id,
      limit: IMAGE_UPLOADS_PER_HOUR,
      windowSeconds: 3600,
    });
    const storageKey = `chat-images/${conversationId}/${uuidv7()}.${extensionFor(input.mimeType)}`;
    let signed;
    try {
      signed = await this.storage.createUploadUrl(storageKey, {
        contentType: input.mimeType,
        maxBytes: maxSizeBytes,
        expiresInSeconds: this.env.UPLOAD_URL_TTL_SECONDS,
      });
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    const intent = await this.prisma.uploadIntent.create({
      data: {
        userId: user.id,
        purpose: 'CHAT_IMAGE',
        storageKey,
        declaredMimeType: input.mimeType,
        declaredSize: input.sizeBytes,
        maxSizeBytes,
        originalFileName: input.fileName ?? null,
        expiresAt: signed.expiresAt,
      },
    });
    return {
      uploadId: intent.id,
      uploadUrl: signed.url,
      method: 'PUT',
      headers: signed.headers,
      maxSizeBytes,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** GET /messages/:id/image-url: a 5-minute signed URL, participants only. */
  async imageUrl(user: AuthUser, messageId: string): Promise<SignedUrl> {
    const message = await this.prisma.message.findFirst({
      where: {
        id: messageId,
        type: 'IMAGE',
        deletedAt: null,
        storageKey: { not: null },
        conversation: { participants: { some: { userId: user.id } } },
      },
      select: { storageKey: true },
    });
    if (!message?.storageKey) throw messageNotFound();
    try {
      const signed = await this.storage.createDownloadUrl(
        message.storageKey,
        IMAGE_URL_TTL_SECONDS,
      );
      return { url: signed.url, expiresAt: signed.expiresAt.toISOString() };
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
  }

  /** POST /messages/:id/report: once per reporter (a repeat is a no-op). */
  async report(user: AuthUser, messageId: string, input: ReportMessage): Promise<void> {
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversation: { participants: { some: { userId: user.id } } } },
      select: { id: true, conversationId: true, senderId: true, type: true },
    });
    if (!message) throw messageNotFound();
    if (message.type === 'SYSTEM' || message.senderId === user.id) {
      throw unprocessable('MESSAGE_NOT_REPORTABLE', 'Bu mesaj bildirilemez.');
    }
    await this.prisma.messageReport.createMany({
      data: [
        {
          messageId: message.id,
          conversationId: message.conversationId,
          reporterId: user.id,
          reason: input.reason,
          note: input.note ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }

  // -------------------------------------------------------------------------

  toMessage(view: ParticipantView, m: MessageRow): ChatMessage {
    const mine = m.senderId !== null && m.senderId === view.myUserId;
    const senderRole =
      m.type === 'SYSTEM' || m.senderId === null
        ? null
        : mine
          ? view.myRole
          : counterpartRole(view.myRole);
    const deleted = m.deletedAt !== null;
    return {
      id: m.id,
      conversationId: m.conversationId,
      type: m.type,
      senderRole,
      mine,
      body: deleted ? null : m.body,
      hasImage: m.type === 'IMAGE' && !deleted && m.storageKey !== null,
      clientMessageId: m.clientMessageId,
      containsContactInfo: m.containsContactInfo,
      // Mine: has the other side read it? Theirs: have I read it?
      state: deliveryState(m.createdAt, mine ? view.counterpartLastReadAt : view.myLastReadAt),
      createdAt: m.createdAt.toISOString(),
      deletedAt: m.deletedAt?.toISOString() ?? null,
    };
  }

  private findByClientId(conversationId: string, senderId: string, clientMessageId: string) {
    return this.prisma.message.findFirst({
      where: { conversationId, senderId, clientMessageId },
      select: messageSelect,
    });
  }

  /**
   * New-message notice to the other side, without the body. Coalesced: no
   * second notice while an unread one for this conversation is recent.
   */
  private async notifyIn(tx: Tx, view: ParticipantView, type: 'TEXT' | 'IMAGE', at: Date) {
    const pending = await tx.notification.count({
      where: {
        userId: view.counterpartUserId,
        type: NotificationEvent.MESSAGE_NEW,
        entityId: view.row.id,
        readAt: null,
        createdAt: { gt: new Date(at.getTime() - MESSAGE_NOTIFICATION_COALESCE_MS) },
      },
      take: 1,
    });
    if (pending > 0) return;
    const notice = newMessageNotice(this.conversations.nameOf(view.row, view.myRole), type);
    await this.notifications.enqueueIn(tx, [
      {
        userId: view.counterpartUserId,
        type: NotificationEvent.MESSAGE_NEW,
        title: notice.title,
        body: notice.body,
        data: { conversationId: view.row.id },
      },
    ]);
  }

  /**
   * The upload must be the caller's, for this conversation, unused,
   * unexpired, present, within the size limit and really JPEG/PNG (magic
   * bytes). Bad files are deleted.
   */
  private async inspectImage(
    userId: string,
    conversationId: string,
    uploadId: string,
  ): Promise<InspectedImage> {
    const intent = await this.prisma.uploadIntent.findFirst({
      where: {
        id: uploadId,
        userId,
        purpose: 'CHAT_IMAGE',
        consumedAt: null,
        storageKey: { startsWith: `chat-images/${conversationId}/` },
      },
    });
    if (!intent) throw uploadNotFound();
    if (intent.expiresAt <= new Date()) {
      throw unprocessable('UPLOAD_EXPIRED', 'Yükleme süresi doldu. Lütfen yeniden yükleyin.');
    }
    let info;
    try {
      info = await this.storage.head(intent.storageKey);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    if (!info) throw unprocessable('UPLOAD_NOT_COMPLETED', 'Fotoğraf henüz yüklenmemiş.');
    if (info.size === 0 || info.size > intent.maxSizeBytes) {
      await this.deleteQuietly(intent.storageKey);
      throw invalidImage('Fotoğraf boş veya izin verilen boyutu aşıyor.');
    }
    const detected = detectMimeType(
      await this.storage.readPrefix(intent.storageKey, SIGNATURE_BYTES),
    );
    if (
      (detected !== 'image/jpeg' && detected !== 'image/png') ||
      detected !== intent.declaredMimeType
    ) {
      await this.deleteQuietly(intent.storageKey);
      throw invalidImage('Fotoğraf JPEG veya PNG olmalı.');
    }
    return { uploadId, storageKey: intent.storageKey, mimeType: detected, sizeBytes: info.size };
  }

  private async deleteQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Could not delete a stored object: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
