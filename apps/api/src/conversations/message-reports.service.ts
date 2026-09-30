import { Injectable } from '@nestjs/common';
import type {
  AdminMessageReport,
  AdminReportedConversation,
  ConversationRole,
  Paginated,
} from '@ustago/types';
import type {
  AccessReportedConversation,
  ListMessageReportsQuery,
  ResolveMessageReport,
} from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../common/auth/auth-user.js';
import { conflict, notFound } from '../common/http/errors.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { customerDisplayName, deliveryState } from './conversation-rules.js';

/** Messages support sees when opening one reported conversation (newest last). */
const ACCESS_MESSAGE_LIMIT = 500;

const reportNotFound = () => notFound('MESSAGE_REPORT_NOT_FOUND', 'Bildirim bulunamadı.');

const reportInclude = {
  conversation: { select: { participants: { select: { userId: true, role: true } } } },
} satisfies Prisma.MessageReportInclude;

type ReportRow = Prisma.MessageReportGetPayload<{ include: typeof reportInclude }>;

/**
 * Support side of "Mesajı bildir". The list shows no message bodies; a
 * reported conversation is opened only with a written reason, and every
 * opening and decision is in the audit log.
 */
@Injectable()
export class MessageReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListMessageReportsQuery): Promise<Paginated<AdminMessageReport>> {
    const rows = await this.prisma.messageReport.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      include: reportInclude,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toReport),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async access(
    admin: AuthUser,
    reportId: string,
    input: AccessReportedConversation,
    ipAddress: string | null,
  ): Promise<AdminReportedConversation> {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.messageReport.findUnique({
        where: { id: reportId },
        include: reportInclude,
      });
      if (!report) throw reportNotFound();
      await this.audit.recordIn(tx, {
        action: 'message_report.conversation_accessed',
        actorId: admin.id,
        entityType: 'message_report',
        entityId: report.id,
        ipAddress,
        metadata: { conversationId: report.conversationId, reason: input.reason },
      });
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { id: report.conversationId },
        select: {
          provider: { select: { displayName: true } },
          customer: { select: { user: { select: { firstName: true, lastName: true } } } },
          participants: { select: { userId: true, role: true, lastReadAt: true } },
        },
      });
      const newest = await tx.message.findMany({
        where: { conversationId: report.conversationId },
        orderBy: { id: 'desc' },
        take: ACCESS_MESSAGE_LIMIT,
      });
      const roleOf = new Map(conversation.participants.map((p) => [p.userId, p.role]));
      const readOf = new Map(conversation.participants.map((p) => [p.role, p.lastReadAt]));
      const names: Record<ConversationRole, string> = {
        PROVIDER: conversation.provider.displayName,
        CUSTOMER: customerDisplayName(
          conversation.customer.user.firstName,
          conversation.customer.user.lastName,
        ),
      };
      return {
        report: toReport(report),
        messages: newest.reverse().map((m) => {
          const role = m.type === 'SYSTEM' || !m.senderId ? null : (roleOf.get(m.senderId) ?? null);
          const reader = role === 'CUSTOMER' ? 'PROVIDER' : 'CUSTOMER';
          return {
            id: m.id,
            conversationId: m.conversationId,
            type: m.type,
            senderRole: role,
            mine: false,
            body: m.body,
            hasImage: m.type === 'IMAGE' && m.storageKey !== null,
            clientMessageId: m.clientMessageId,
            containsContactInfo: m.containsContactInfo,
            state: role ? deliveryState(m.createdAt, readOf.get(reader) ?? null) : 'SENT',
            createdAt: m.createdAt.toISOString(),
            deletedAt: m.deletedAt?.toISOString() ?? null,
            senderName: role ? names[role] : null,
          };
        }),
      };
    });
  }

  async resolve(
    admin: AuthUser,
    reportId: string,
    input: ResolveMessageReport,
    ipAddress: string | null,
  ): Promise<AdminMessageReport> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updated = await tx.messageReport.updateMany({
        where: { id: reportId, status: 'OPEN' },
        data: {
          status: input.status,
          resolutionNote: input.note,
          reviewedById: admin.id,
          reviewedAt: now,
        },
      });
      if (updated.count === 0) {
        const exists = await tx.messageReport.count({ where: { id: reportId } });
        if (exists === 0) throw reportNotFound();
        throw conflict('MESSAGE_REPORT_ALREADY_RESOLVED', 'Bu bildirim zaten sonuçlandı.');
      }
      await this.audit.recordIn(tx, {
        action: 'message_report.resolved',
        actorId: admin.id,
        entityType: 'message_report',
        entityId: reportId,
        ipAddress,
        metadata: { status: input.status },
      });
      return toReport(
        await tx.messageReport.findUniqueOrThrow({
          where: { id: reportId },
          include: reportInclude,
        }),
      );
    });
  }
}

function toReport(r: ReportRow): AdminMessageReport {
  const reporterRole =
    r.conversation.participants.find((p) => p.userId === r.reporterId)?.role ?? 'CUSTOMER';
  return {
    id: r.id,
    messageId: r.messageId,
    conversationId: r.conversationId,
    reason: r.reason,
    note: r.note,
    status: r.status,
    reporterRole,
    createdAt: r.createdAt.toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
  };
}
