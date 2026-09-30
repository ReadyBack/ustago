/**
 * Faz 6 operations types: fee policy administration, operational alerts,
 * reconciliation runs, workers and the admin "Operasyon" page
 * (docs/adr/0025).
 */
import type { NamedRef } from './address.js';
import type { Money } from './money.js';

export type FeePolicyLifecycle = 'DRAFT' | 'SCHEDULED' | 'ACTIVE' | 'RETIRED';

export interface AdminFeePolicy {
  id: string;
  code: string;
  name: string;
  currency: 'TRY';
  bps: number;
  fixed: Money;
  min: Money | null;
  max: Money | null;
  effectiveFrom: string;
  lifecycle: FeePolicyLifecycle;
  /** Only the whole marketplace today; per-category scopes are future work. */
  scope: 'GLOBAL';
  isDevelopment: boolean;
  publishedAt: string | null;
  publishedBy: NamedRef | null;
  retiredAt: string | null;
  jobsUsing: number;
  createdAt: string;
}

export interface FeePreviewLine {
  gross: Money;
  fee: Money;
  providerNet: Money;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface OperationalAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  detail: Record<string, unknown> | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedBy: NamedRef | null;
  acknowledgedAt: string | null;
  resolvedBy: NamedRef | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export type ReconciliationRunStatus = 'RUNNING' | 'CLEAN' | 'MISMATCH' | 'FAILED';

export interface ReconciliationRun {
  id: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  status: ReconciliationRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  checkedCount: number;
  totals: { debit: Money; credit: Money } | null;
  mismatchCount: number;
  snapshotsChecked: number;
  snapshotMismatchCount: number;
  error: string | null;
  alertId: string | null;
}

export interface WorkerStatus {
  name: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  totalRuns: number;
  totalFailures: number;
  lastDurationMs: number | null;
  /** Error class only: messages can carry data. */
  lastError: string | null;
  /** "ok" only when the worker actually succeeded recently. */
  health: 'ok' | 'stale' | 'failing' | 'never_ran' | 'disabled';
}

export type ComponentState = 'up' | 'down' | 'degraded' | 'disabled' | 'unknown';

export interface RuntimeFlagView {
  key: string;
  label: string;
  /** Deploy-time value; admins cannot change it. */
  envEnabled: boolean;
  /** Admin kill switch; effective = envEnabled AND adminEnabled. */
  adminEnabled: boolean;
  effective: boolean;
  reason: string | null;
  updatedBy: NamedRef | null;
  updatedAt: string | null;
}

export interface AdminOperationsStatus {
  environment: 'development' | 'test' | 'staging' | 'production';
  version: string;
  checkedAt: string;
  components: {
    api: ComponentState;
    database: ComponentState;
    redis: ComponentState;
    pushOutbox: ComponentState;
    reconciliation: ComponentState;
  };
  pushOutbox: { pending: number; failed: number; oldestPendingAgeSeconds: number | null };
  payouts: { needsReconciliation: number; requested: number };
  webhooks: { received24h: number; failed24h: number; duplicates24h: number };
  latestReconciliation: ReconciliationRun | null;
  openAlerts: { critical: number; warning: number; info: number };
  workers: WorkerStatus[];
  flags: RuntimeFlagView[];
  /** Honest labels for mock integrations, e.g. "TEST (mock)". */
  integrations: { name: string; mode: string; productionReady: boolean }[];
}
