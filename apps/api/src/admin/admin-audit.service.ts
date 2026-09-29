import { Injectable } from '@nestjs/common';
import type { AuditEvent, Paginated } from '@ustago/types';
import type { ListAuditEventsQuery } from '@ustago/validation';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Read-only view of the audit trail for the back office. */
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
        metadata: isRecord(row.metadata) ? row.metadata : null,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
