import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { API_ENV, type ApiEnv } from '../config/env.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AlertsService } from './alerts.service.js';
import { HeartbeatService, WORKERS } from './heartbeat.service.js';
import { OpsTaskRegistry } from './ops-task-registry.js';
import { ReconciliationRunsService } from './reconciliation-runs.service.js';

export interface OpsMonitorResult {
  tasks: Record<string, Record<string, number>>;
  reconciliation: 'ran' | 'skipped' | 'not_due' | 'disabled';
  pushBacklog: number;
  pushFailedLastHour: number;
  payoutsNeedingReconciliation: number;
}

/**
 * The ops monitor (docs/adr/0025) runs every OPS_WORKER_INTERVAL_SECONDS:
 * registered maintenance tasks (e.g. suspension expiry), the scheduled
 * reconciliation when due, and threshold checks that raise alerts. It only
 * reads money tables; it never changes a payment, ledger row or balance.
 */
@Injectable()
export class OpsMonitorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OpsMonitorService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertsService,
    private readonly heartbeat: HeartbeatService,
    private readonly reconciliation: ReconciliationRunsService,
    private readonly registry: OpsTaskRegistry,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.OPS_WORKER_INTERVAL_SECONDS;
    if (seconds === 0 || this.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.heartbeat.track(
        WORKERS.OPS,
        () => this.runOnce(),
        (r) => ({
          reconciliation: r.reconciliation,
          pushBacklog: r.pushBacklog,
        }),
      );
    } catch (error) {
      this.logger.error({
        msg: 'ops_monitor_failed',
        error: error instanceof Error ? error.name : 'unknown',
      });
    } finally {
      this.running = false;
    }
  }

  async runOnce(now = new Date()): Promise<OpsMonitorResult> {
    const result: OpsMonitorResult = {
      tasks: {},
      reconciliation: 'disabled',
      pushBacklog: 0,
      pushFailedLastHour: 0,
      payoutsNeedingReconciliation: 0,
    };
    for (const [name, task] of this.registry.entries()) {
      result.tasks[name] = await task(now);
    }

    const interval = this.env.RECONCILIATION_INTERVAL_MINUTES;
    if (interval > 0) {
      if (await this.reconciliation.isDue(interval, now)) {
        const run = await this.reconciliation.run('SCHEDULED', now).catch(() => null);
        result.reconciliation = run ? 'ran' : 'skipped';
      } else {
        result.reconciliation = 'not_due';
      }
    }

    await this.checkPush(now, result);
    await this.checkPayouts(result);
    await this.checkWorkers();

    const counts = await this.alerts.counts();
    metrics.gauges.set(counts.critical, { name: 'open_alerts', severity: 'critical' });
    metrics.gauges.set(counts.warning, { name: 'open_alerts', severity: 'warning' });
    return result;
  }

  private async checkPush(now: Date, result: OpsMonitorResult): Promise<void> {
    const backlogBefore = new Date(now.getTime() - this.env.QUEUE_BACKLOG_ALERT_MINUTES * 60_000);
    const [backlog, failed] = await Promise.all([
      this.prisma.pushDelivery.count({
        where: { status: 'PENDING', createdAt: { lt: backlogBefore } },
      }),
      this.prisma.pushDelivery.count({
        where: { status: 'FAILED', updatedAt: { gt: new Date(now.getTime() - 3_600_000) } },
      }),
    ]);
    result.pushBacklog = backlog;
    result.pushFailedLastHour = failed;
    metrics.gauges.set(backlog, { name: 'push_backlog_stale' });
    if (backlog > 0) {
      await this.alerts.raise({
        type: 'push.backlog',
        severity: 'WARNING',
        title: `${backlog} bildirim ${this.env.QUEUE_BACKLOG_ALERT_MINUTES} dakikadan uzun süredir bekliyor`,
        details: { pending: backlog, olderThanMinutes: this.env.QUEUE_BACKLOG_ALERT_MINUTES },
        source: 'ops-monitor',
        dedupeKey: 'push.backlog',
      });
    } else {
      await this.alerts.autoResolve('push.backlog', 'Bildirim kuyruğu normale döndü.');
    }
    if (failed >= this.env.PUSH_FAILURE_ALERT_THRESHOLD) {
      await this.alerts.raise({
        type: 'push.failures',
        severity: 'WARNING',
        title: `Son 1 saatte ${failed} push bildirimi gönderilemedi`,
        details: { failedLastHour: failed, threshold: this.env.PUSH_FAILURE_ALERT_THRESHOLD },
        source: 'ops-monitor',
        dedupeKey: 'push.failures',
      });
    }
  }

  private async checkPayouts(result: OpsMonitorResult): Promise<void> {
    const stuck = await this.prisma.payout.count({ where: { status: 'NEEDS_RECONCILIATION' } });
    result.payoutsNeedingReconciliation = stuck;
    metrics.gauges.set(stuck, { name: 'payouts_needs_reconciliation' });
    if (stuck > 0) {
      await this.alerts.raise({
        type: 'payout.needs_reconciliation',
        severity: 'CRITICAL',
        title: `${stuck} para çekme talebinin sonucu bilinmiyor`,
        details: { count: stuck },
        source: 'ops-monitor',
        dedupeKey: 'payout.needs_reconciliation',
      });
    } else {
      await this.alerts.autoResolve(
        'payout.needs_reconciliation',
        'Sonucu bilinmeyen para çekme talebi kalmadı.',
      );
    }
  }

  private async checkWorkers(): Promise<void> {
    const failing = await this.prisma.workerHeartbeat.findMany({
      where: { consecutiveFailures: { gte: 3 } },
      select: { name: true, consecutiveFailures: true, lastError: true },
    });
    for (const w of failing) {
      await this.alerts.raise({
        type: 'worker.failing',
        severity: 'CRITICAL',
        title: `${w.name} arka arkaya ${w.consecutiveFailures} kez başarısız oldu`,
        details: { worker: w.name, consecutiveFailures: w.consecutiveFailures, error: w.lastError },
        source: 'ops-monitor',
        dedupeKey: `worker.failing:${w.name}`,
      });
    }
  }
}
