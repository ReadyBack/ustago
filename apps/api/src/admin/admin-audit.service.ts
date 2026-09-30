import { Injectable } from '@nestjs/common';
import type { AuditEvent, Paginated } from '@ustago/types';
import type { ListAuditEventsQuery } from '@ustago/validation';

import type { Prisma } from '../generated/prisma/client.js';
import { redact } from '../observability/redact.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Read-only view of the audit trail for the back office. Metadata is passed
 * through the log redactor (docs/adr/0026): even a slip in an audit writer
 * never shows a phone number, IBAN, token or IP hash on the admin screen.
 */
@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Newest first, cursor = id of the last item (ids are UUIDv7, time-ordered). */
  async list(query: ListAuditEventsQuery): Promise<Paginated<AuditEvent>> {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action
        ? query.action.endsWith('.')
          ? { action: { startsWith: query.action } }
          : { action: query.action }
        : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: endOfDayIfDate(query.to) } : {}),
            },
          }
        : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { actor: { select: { id: true, firstName: true, lastName: true } } },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        actor: row.actor
          ? {
              id: row.actor.id,
              displayName: `${row.actor.firstName} ${row.actor.lastName}`.trim(),
            }
          : null,
        entityType: row.entityType,
        entityId: row.entityId,
        metadata: isRecord(row.metadata) ? (redact(row.metadata) as Record<string, unknown>) : null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `to=2026-10-01` means the whole day; a full timestamp is used as is. */
function endOfDayIfDate(value: Date): Date {
  const midnight =
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0;
  return midnight ? new Date(value.getTime() + 86_400_000 - 1) : value;
}
