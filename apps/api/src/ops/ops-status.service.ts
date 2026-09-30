import { Inject, Injectable } from '@nestjs/common';
import type { AdminOperationsStatus, ComponentState, WorkerStatus } from '@ustago/types';

import { withTimeout } from '../common/utils/with-timeout.js';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { metrics } from '../observability/metrics.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RedisService } from '../redis/redis.service.js';
import { AlertsService } from './alerts.service.js';
import { HeartbeatService, WORKERS } from './heartbeat.service.js';
import { ReconciliationRunsService } from './reconciliation-runs.service.js';
import { RuntimeFlagsService } from './runtime-flags.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The admin "Operasyon" page (docs/adr/0025). Every state is measured: a
 * component is "up" only when a probe or a recent successful run proves
 * it. Never ran, disabled or unknown are shown as such, never as green.
 */
@Injectable()
export class OpsStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly alerts: AlertsService,
    private readonly heartbeat: HeartbeatService,
    private readonly reconciliation: ReconciliationRunsService,
    private readonly flags: RuntimeFlagsService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async status(now = new Date()): Promise<AdminOperationsStatus> {
    const [database, redis] = await Promise.all([
      probe(() => this.prisma.ping()),
      probe(() => this.redis.ping()),
    ]);
    const dbUp = database === 'up';
    const pushInterval = this.env.PUSH_WORKER_INTERVAL_SECONDS;
    const opsInterval = this.env.OPS_WORKER_INTERVAL_SECONDS;
    const workers = dbUp
      ? await this.heartbeat.statuses([
          {
            name: WORKERS.PUSH,
            maxAgeSeconds: pushInterval > 0 ? Math.max(pushInterval * 5, 60) : null,
          },
          { name: WORKERS.FINANCE_SWEEP, maxAgeSeconds: 3600 },
          {
            name: WORKERS.RECONCILIATION,
            maxAgeSeconds:
              this.env.RECONCILIATION_INTERVAL_MINUTES > 0
                ? this.env.RECONCILIATION_INTERVAL_MINUTES * 60 * 2
                : null,
          },
          { name: WORKERS.OPS, maxAgeSeconds: opsInterval > 0 ? opsInterval * 5 : null },
        ])
      : [];

    const [pushStats, payouts, webhooks, latest, openAlerts, flags] = dbUp
      ? await Promise.all([
          this.pushStats(now),
          this.payoutStats(),
          this.webhookStats(now),
          this.reconciliation.latest(),
          this.alerts.counts(),
          this.flags.list(),
        ])
      : [
          { pending: 0, failed: 0, oldestPendingAgeSeconds: null },
          { needsReconciliation: 0, requested: 0 },
          { received24h: 0, ignored24h: 0 },
          null,
          { critical: 0, warning: 0, info: 0 },
          [],
        ];

    const pushWorker = workers.find((w) => w.name === WORKERS.PUSH);
    const reconWorker = workers.find((w) => w.name === WORKERS.RECONCILIATION);
    return {
      environment: this.env.APP_ENV,
      version: this.env.APP_VERSION,
      checkedAt: now.toISOString(),
      components: {
        api: 'up',
        database,
        redis,
        pushOutbox: !dbUp
          ? 'unknown'
          : this.env.PUSH_PROVIDER === 'disabled'
            ? 'disabled'
            : outboxState(pushWorker, pushStats.oldestPendingAgeSeconds, this.env),
        reconciliation: !dbUp
          ? 'unknown'
          : !latest
            ? this.env.RECONCILIATION_INTERVAL_MINUTES > 0
              ? 'unknown'
              : 'disabled'
            : latest.status === 'FAILED'
              ? 'down'
              : latest.mismatchCount > 0
                ? 'degraded'
                : reconWorker?.health === 'stale'
                  ? 'degraded'
                  : 'up',
      },
      pushOutbox: pushStats,
      payouts,
      webhooks: {
        ...webhooks,
        rejectedSinceStart: metrics.domainEvents.get({ event: 'webhook.rejected' }),
        duplicatesSinceStart: metrics.domainEvents.get({ event: 'webhook.duplicate' }),
      },
      latestReconciliation: latest,
      openAlerts,
      workers,
      flags,
      integrations: this.integrations(),
    };
  }

  private async pushStats(now: Date) {
    const [pending, failed, oldest] = await Promise.all([
      this.prisma.pushDelivery.count({ where: { status: 'PENDING' } }),
      this.prisma.pushDelivery.count({ where: { status: 'FAILED' } }),
      this.prisma.pushDelivery.findFirst({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      pending,
      failed,
      oldestPendingAgeSeconds: oldest
        ? Math.round((now.getTime() - oldest.createdAt.getTime()) / 1000)
        : null,
    };
  }

  private async payoutStats() {
    const [needsReconciliation, requested] = await Promise.all([
      this.prisma.payout.count({ where: { status: 'NEEDS_RECONCILIATION' } }),
      this.prisma.payout.count({ where: { status: 'REQUESTED' } }),
    ]);
    return { needsReconciliation, requested };
  }

  private async webhookStats(now: Date) {
    const since = new Date(now.getTime() - DAY_MS);
    const rows = await this.prisma.webhookEvent.groupBy({
      by: ['outcome'],
      where: { receivedAt: { gt: since } },
      _count: { _all: true },
    });
    const total = rows.reduce((n, r) => n + r._count._all, 0);
    const ignored = rows
      .filter((r) => r.outcome !== 'PROCESSED')
      .reduce((n, r) => n + r._count._all, 0);
    return { received24h: total, ignored24h: ignored };
  }

  private integrations(): AdminOperationsStatus['integrations'] {
    const env = this.env;
    const mode = (name: string, test: string[]) =>
      name === 'disabled' ? 'kapalı' : test.includes(name) ? `TEST (${name})` : name;
    return [
      {
        name: 'Ödeme sağlayıcısı',
        mode: mode(env.PAYMENT_PROVIDER, ['mock']),
        productionReady: false,
      },
      {
        name: 'Para çekme sağlayıcısı',
        mode: mode(env.PAYOUT_PROVIDER, ['mock']),
        productionReady: false,
      },
      { name: 'SMS', mode: mode(env.SMS_PROVIDER, ['console', 'fake']), productionReady: false },
      {
        name: 'Push',
        mode: mode(env.PUSH_PROVIDER, ['console']),
        // Expo push is wired but has not been tested on a physical device.
        productionReady: false,
      },
      { name: 'Belge depolama', mode: mode(env.STORAGE_DRIVER, ['local']), productionReady: false },
      {
        name: 'Kimlik doğrulama (KYC)',
        mode: `${env.KYC_PROVIDER} (elle inceleme)`,
        productionReady: false,
      },
      {
        name: 'Zararlı yazılım taraması',
        mode: env.MALWARE_SCANNER === 'none' ? 'yok (NOT_SCANNED)' : env.MALWARE_SCANNER,
        productionReady: false,
      },
      { name: 'Hata raporlama', mode: env.ERROR_REPORTER, productionReady: false },
    ];
  }
}

async function probe(fn: () => Promise<void>): Promise<ComponentState> {
  try {
    await withTimeout(fn(), 2000, 'probe');
    return 'up';
  } catch {
    return 'down';
  }
}

function outboxState(
  worker: WorkerStatus | undefined,
  oldestPendingAgeSeconds: number | null,
  env: ApiEnv,
): ComponentState {
  if (!worker || worker.health === 'disabled') return 'disabled';
  if (worker.health === 'failing') return 'down';
  if (worker.health === 'never_ran') return 'unknown';
  const backlog =
    oldestPendingAgeSeconds !== null &&
    oldestPendingAgeSeconds > env.QUEUE_BACKLOG_ALERT_MINUTES * 60;
  return worker.health === 'stale' || backlog ? 'degraded' : 'up';
}
