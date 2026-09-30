import { Injectable } from '@nestjs/common';
import type { DataExportRequestView } from '@ustago/types';

import { AuditService } from '../audit/audit.service.js';
import { conflict } from '../common/http/errors.js';
import type { DataExportRequest } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

const OPEN = ['REQUESTED', 'PROCESSING'] as const;

/**
 * Personal data export requests (docs/adr/0027). Only the request is
 * recorded: generating and delivering the archive is not built yet and
 * its scope and deadline are "Legal review required". Nothing here claims
 * an export was produced.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<DataExportRequestView[]> {
    const rows = await this.prisma.dataExportRequest.findMany({
      where: { userId },
      orderBy: { requestedAt: 'desc' },
      take: 10,
    });
    return rows.map(toView);
  }

  async request(userId: string, ipAddress: string | null): Promise<DataExportRequestView> {
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ustago:data-export:${userId}`}))`;
      const open = await tx.dataExportRequest.count({
        where: { userId, status: { in: [...OPEN] } },
      });
      if (open > 0) {
        throw conflict(
          'DATA_EXPORT_ALREADY_REQUESTED',
          'Açık bir veri dışa aktarma talebiniz var.',
        );
      }
      const created = await tx.dataExportRequest.create({ data: { userId } });
      await this.audit.recordIn(tx, {
        action: 'account.data_export_requested',
        actorId: userId,
        entityType: 'user',
        entityId: userId,
        ipAddress,
        metadata: { requestId: created.id },
      });
      return created;
    });
    return toView(row);
  }
}

function toView(r: DataExportRequest): DataExportRequestView {
  return {
    id: r.id,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    readyAt: r.readyAt?.toISOString() ?? null,
  };
}
