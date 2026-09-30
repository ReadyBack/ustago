import { Injectable, Logger } from '@nestjs/common';
import type { OperationalAlert, Paginated } from '@ustago/types';
import type { ListAlertsQuery } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/http/errors.js';
import type { AlertSeverity, Prisma } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AlertInput {
  type: string;
  severity: AlertSeverity;
  title: string;
  /** Ids, counts and codes only; never personal data or raw payloads. */
  details: Prisma.InputJsonObject;
  source: string;
  /** Repeats with the same key bump `occurrences` until resolved. */
  dedupeKey: string;
}

const actor = { select: { id: true, firstName: true, lastName: true } } as const;

/**
 * Operational alerts (docs/adr/0025). Raising one never fails the caller:
 * an alert that cannot be written is logged instead. Alerts only inform;
 * nothing here changes money, jobs or accounts.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async raise(input: AlertInput): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO "operational_alerts"
          ("id", "type", "severity", "title", "details", "source", "dedupe_key", "updated_at")
        VALUES (
          gen_random_uuid(), ${input.type}, ${input.severity}::"AlertSeverity", ${input.title.slice(0, 200)},
          ${JSON.stringify(input.details)}::jsonb, ${input.source}, ${input.dedupeKey.slice(0, 160)}, now()
        )
        ON CONFLICT ("dedupe_key") WHERE status <> 'RESOLVED'
        DO UPDATE SET
          "occurrences" = "operational_alerts"."occurrences" + 1,
          "last_seen_at" = now(),
          "details" = EXCLUDED."details",
          "severity" = EXCLUDED."severity",
          "title" = EXCLUDED."title",
          "updated_at" = now()
        RETURNING "id"`;
      metrics.domainEvents.inc({ event: `alert.${input.severity.toLowerCase()}` });
      this.logger.warn({ msg: 'operational_alert', type: input.type, severity: input.severity });
      return rows[0]?.id ?? null;
    } catch (error) {
      this.logger.error({
        msg: 'operational_alert_write_failed',
        type: input.type,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
  }

  /** Resolves an open alert when the condition cleared (system actor). */
  async autoResolve(dedupeKey: string, note: string): Promise<void> {
    await this.prisma.operationalAlert.updateMany({
      where: { dedupeKey, status: { not: 'RESOLVED' } },
      data: { status: 'RESOLVED', resolvedAt: new Date(), resolutionNote: note },
    });
  }

  async list(query: ListAlertsQuery): Promise<Paginated<OperationalAlert>> {
    const status =
      query.status === 'ACTIVE' ? { in: ['OPEN', 'ACKNOWLEDGED'] as const } : query.status;
    const rows = await this.prisma.operationalAlert.findMany({
      where: {
        status: typeof status === 'string' ? status : { in: [...status.in] },
        ...(query.severity ? { severity: query.severity } : {}),
      },
      orderBy: [{ id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { acknowledgedBy: actor, resolvedBy: actor },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toAlert),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async counts(): Promise<{ critical: number; warning: number; info: number }> {
    const rows = await this.prisma.operationalAlert.groupBy({
      by: ['severity'],
      where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      _count: { _all: true },
    });
    const of = (s: AlertSeverity) => rows.find((r) => r.severity === s)?._count._all ?? 0;
    return { critical: of('CRITICAL'), warning: of('WARNING'), info: of('INFO') };
  }

  async acknowledge(actorId: string, id: string, ipAddress: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.operationalAlert.updateMany({
        where: { id, status: 'OPEN' },
        data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedById: actorId },
      });
      if (count === 0) await this.explainNoChange(tx, id);
      await this.audit.recordIn(tx, {
        action: 'alert.acknowledged',
        actorId,
        entityType: 'operational_alert',
        entityId: id,
        ipAddress,
      });
      return toAlert(
        await tx.operationalAlert.findUniqueOrThrow({
          where: { id },
          include: { acknowledgedBy: actor, resolvedBy: actor },
        }),
      );
    });
  }

  async resolve(actorId: string, id: string, note: string, ipAddress: string | null) {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.operationalAlert.updateMany({
        where: { id, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedById: actorId,
          resolutionNote: note,
        },
      });
      if (count === 0) await this.explainNoChange(tx, id);
      await this.audit.recordIn(tx, {
        action: 'alert.resolved',
        actorId,
        entityType: 'operational_alert',
        entityId: id,
        ipAddress,
      });
      return toAlert(
        await tx.operationalAlert.findUniqueOrThrow({
          where: { id },
          include: { acknowledgedBy: actor, resolvedBy: actor },
        }),
      );
    });
  }

  private async explainNoChange(tx: Prisma.TransactionClient, id: string): Promise<never> {
    const exists = await tx.operationalAlert.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!exists) throw notFound('ALERT_NOT_FOUND', 'Uyarı bulunamadı.');
    throw conflict('ALERT_INVALID_STATE', `Uyarı zaten ${exists.status} durumunda.`);
  }
}

type AlertRow = Prisma.OperationalAlertGetPayload<{
  include: { acknowledgedBy: typeof actor; resolvedBy: typeof actor };
}>;

function ref(u: { id: string; firstName: string; lastName: string } | null) {
  return u ? { id: u.id, name: `${u.firstName} ${u.lastName}` } : null;
}

export function toAlert(a: AlertRow): OperationalAlert {
  return {
    id: a.id,
    type: a.type,
    severity: a.severity,
    status: a.status,
    title: a.title,
    details: (a.details ?? {}) as Record<string, unknown>,
    source: a.source,
    occurrences: a.occurrences,
    firstSeenAt: a.createdAt.toISOString(),
    lastSeenAt: a.lastSeenAt.toISOString(),
    acknowledgedBy: ref(a.acknowledgedBy),
    acknowledgedAt: a.acknowledgedAt?.toISOString() ?? null,
    resolvedBy: ref(a.resolvedBy),
    resolvedAt: a.resolvedAt?.toISOString() ?? null,
    resolutionNote: a.resolutionNote,
  };
}
