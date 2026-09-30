import { Injectable, Logger } from '@nestjs/common';
import type { WorkerStatus } from '@ustago/types';

import type { Prisma } from '../generated/prisma/client.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Background workers the Operasyon page reports on. */
export const WORKERS = {
  PUSH: 'push-worker',
  FINANCE_SWEEP: 'finance-sweep',
  RECONCILIATION: 'finance-reconciliation',
  OPS: 'ops-monitor',
} as const;

/**
 * Worker heartbeats (docs/adr/0025): every run records start, success or
 * failure, so "healthy" on the Operasyon page means a recent success, not
 * merely "the process is up".
 */
@Injectable()
export class HeartbeatService {
  private readonly logger = new Logger(HeartbeatService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Runs `fn` and records the outcome. Rethrows the error. */
  async track<T>(name: string, fn: () => Promise<T>, summary?: (r: T) => Prisma.InputJsonObject) {
    const started = Date.now();
    const at = new Date(started);
    try {
      const result = await fn();
      await this.write(
        name,
        {
          lastRunAt: at,
          lastSuccessAt: new Date(),
          lastDurationMs: Date.now() - started,
          consecutiveFailures: 0,
          lastError: null,
          ...(summary ? { lastResult: summary(result) } : {}),
        },
        false,
      );
      metrics.workerRuns.inc({ worker: name, outcome: 'success' });
      return result;
    } catch (error) {
      await this.write(
        name,
        {
          lastRunAt: at,
          lastFailureAt: new Date(),
          lastDurationMs: Date.now() - started,
          // The class name only: messages can carry data.
          lastError: error instanceof Error ? error.name : 'Error',
        },
        true,
      );
      metrics.workerRuns.inc({ worker: name, outcome: 'failure' });
      throw error;
    }
  }

  private async write(
    name: string,
    data: Prisma.WorkerHeartbeatUpdateInput & { lastRunAt: Date },
    failed: boolean,
  ): Promise<void> {
    try {
      await this.prisma.workerHeartbeat.upsert({
        where: { name },
        create: {
          name,
          lastRunAt: data.lastRunAt,
          lastSuccessAt: failed ? null : new Date(),
          lastFailureAt: failed ? new Date() : null,
          consecutiveFailures: failed ? 1 : 0,
          totalRuns: 1,
          totalFailures: failed ? 1 : 0,
          lastError: (data.lastError as string | null | undefined) ?? null,
          lastDurationMs: (data.lastDurationMs as number | undefined) ?? null,
          ...(data.lastResult ? { lastResult: data.lastResult as Prisma.InputJsonObject } : {}),
        },
        update: {
          ...data,
          totalRuns: { increment: 1 },
          ...(failed
            ? { totalFailures: { increment: 1 }, consecutiveFailures: { increment: 1 } }
            : {}),
        },
      });
    } catch (error) {
      this.logger.warn({
        msg: 'heartbeat_write_failed',
        worker: name,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async statuses(
    expected: { name: string; maxAgeSeconds: number | null }[],
  ): Promise<WorkerStatus[]> {
    const rows = await this.prisma.workerHeartbeat.findMany();
    const byName = new Map(rows.map((r) => [r.name, r]));
    const now = Date.now();
    return expected.map(({ name, maxAgeSeconds }) => {
      const r = byName.get(name);
      let health: WorkerStatus['health'];
      if (maxAgeSeconds === null) health = 'disabled';
      else if (!r?.lastRunAt) health = 'never_ran';
      else if (r.consecutiveFailures > 0) health = 'failing';
      else if (!r.lastSuccessAt || now - r.lastSuccessAt.getTime() > maxAgeSeconds * 1000) {
        health = 'stale';
      } else health = 'ok';
      return {
        name,
        lastRunAt: r?.lastRunAt?.toISOString() ?? null,
        lastSuccessAt: r?.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: r?.lastFailureAt?.toISOString() ?? null,
        consecutiveFailures: r?.consecutiveFailures ?? 0,
        totalRuns: r?.totalRuns ?? 0,
        totalFailures: r?.totalFailures ?? 0,
        lastDurationMs: r?.lastDurationMs ?? null,
        lastError: r?.lastError ?? null,
        health,
      };
    });
  }
}
