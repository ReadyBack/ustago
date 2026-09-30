import { Injectable, Logger } from '@nestjs/common';
import type { Paginated, RiskSignal } from '@ustago/types';
import type { ListRiskSignalsQuery, ReviewRiskSignalRequest } from '@ustago/validation';

import { AuditService } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/http/errors.js';
import type { Prisma, RiskSignalType } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface RiskSignalInput {
  type: RiskSignalType;
  subjectUserId?: string | null;
  /** A keyed hash (phone, IP) when there is no user; never a raw value. */
  subjectKey?: string | null;
  /** Counts, ids and codes only. */
  evidence: Prisma.InputJsonObject;
  source: string;
  /** Repeats with the same key while OPEN bump `occurrences`. */
  dedupeKey: string;
}

/**
 * Risk signals are evidence for a human reviewer (docs/adr/0024). They never
 * ban, suspend or score anyone automatically, and recording one never fails
 * the request that produced it.
 */
@Injectable()
export class RiskSignalsService {
  private readonly logger = new Logger(RiskSignalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async record(input: RiskSignalInput): Promise<void> {
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "risk_signals"
          ("id", "type", "subject_user_id", "subject_key", "evidence", "source", "dedupe_key")
        VALUES (
          gen_random_uuid(), ${input.type}::"RiskSignalType", ${input.subjectUserId ?? null}::uuid,
          ${input.subjectKey ?? null}, ${JSON.stringify(input.evidence)}::jsonb, ${input.source},
          ${input.dedupeKey.slice(0, 160)}
        )
        ON CONFLICT ("dedupe_key") WHERE status = 'OPEN'
        DO UPDATE SET
          "occurrences" = "risk_signals"."occurrences" + 1,
          "last_seen_at" = now(),
          "evidence" = EXCLUDED."evidence"`;
      metrics.domainEvents.inc({ event: `risk_signal.${input.type.toLowerCase()}` });
    } catch (error) {
      this.logger.warn({
        msg: 'risk_signal_record_failed',
        type: input.type,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async list(query: ListRiskSignalsQuery): Promise<Paginated<RiskSignal>> {
    const rows = await this.prisma.riskSignal.findMany({
      where: { status: query.status, ...(query.type ? { type: query.type } : {}) },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        subject: { select: { id: true, firstName: true, lastName: true } },
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        type: r.type,
        status: r.status,
        subject: r.subject
          ? { id: r.subject.id, name: `${r.subject.firstName} ${r.subject.lastName}` }
          : null,
        evidence: (r.evidence ?? {}) as Record<string, unknown>,
        source: r.source,
        occurrences: r.occurrences,
        firstSeenAt: r.createdAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        reviewedBy: r.reviewedBy
          ? { id: r.reviewedBy.id, name: `${r.reviewedBy.firstName} ${r.reviewedBy.lastName}` }
          : null,
        reviewNote: r.reviewNote,
      })),
      nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async review(
    actorId: string,
    id: string,
    input: ReviewRiskSignalRequest,
    ipAddress: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.riskSignal.updateMany({
        where: { id, status: 'OPEN' },
        data: {
          status: input.status,
          reviewedById: actorId,
          reviewedAt: new Date(),
          reviewNote: input.note,
        },
      });
      if (count === 0) {
        const exists = await tx.riskSignal.count({ where: { id } });
        if (!exists) throw notFound('RISK_SIGNAL_NOT_FOUND', 'Risk sinyali bulunamadı.');
        throw conflict('RISK_SIGNAL_ALREADY_REVIEWED', 'Bu sinyal zaten incelenmiş.');
      }
      await this.audit.recordIn(tx, {
        action: 'risk_signal.reviewed',
        actorId,
        entityType: 'risk_signal',
        entityId: id,
        ipAddress,
        metadata: { status: input.status },
      });
    });
  }

  /** An admin marks a user for follow-up; still only evidence. */
  async flagUser(actorId: string, userId: string, note: string, ipAddress: string | null) {
    const user = await this.prisma.user.count({ where: { id: userId } });
    if (!user) throw notFound('USER_NOT_FOUND', 'Kullanıcı bulunamadı.');
    await this.record({
      type: 'ADMIN_FLAG',
      subjectUserId: userId,
      evidence: { flaggedBy: actorId, noteLength: note.length },
      source: 'admin',
      dedupeKey: `ADMIN_FLAG:${userId}`,
    });
    await this.audit.record({
      action: 'risk_signal.admin_flag',
      actorId,
      entityType: 'user',
      entityId: userId,
      ipAddress,
      metadata: { note },
    });
  }
}
