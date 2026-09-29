import { Injectable, Logger } from '@nestjs/common';

import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  ipAddress?: string | null;
  metadata?: Prisma.InputJsonObject;
}

/**
 * Append-only audit trail (PROJECT.md §19, §31.12). Never put passwords,
 * tokens or other secrets in `metadata`.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an entry inside the caller's transaction. */
  async recordIn(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: toData(entry) });
  }

  /**
   * Records an entry outside any transaction. A failure is logged and does
   * not fail the request (used for sign-in events).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: toData(entry) });
    } catch (error) {
      this.logger.error(
        `Could not write audit log ${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

function toData(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
  return {
    action: entry.action,
    actorId: entry.actorId ?? null,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    ipAddress: entry.ipAddress ?? null,
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
  };
}
