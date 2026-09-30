import type {
  AlertSeverity,
  AlertStatus,
  ComponentState,
  FeePolicyLifecycle,
  ProviderAccountStatus,
  ProviderVerificationStatus,
  ReconciliationRunStatus,
  RiskSignalStatus,
  SuspensionStatus,
  WorkerStatus,
} from '@ustago/types';

import {
  ACCOUNT_STATUS_LABELS,
  ALERT_SEVERITY_LABELS,
  ALERT_STATUS_LABELS,
  COMPONENT_STATE_LABELS,
  FEE_POLICY_LIFECYCLE_LABELS,
  PROVIDER_VERIFICATION_STATUS_LABELS,
  RECONCILIATION_RUN_STATUS_LABELS,
  RISK_SIGNAL_STATUS_LABELS,
  SUSPENSION_STATUS_LABELS,
  WORKER_HEALTH_LABELS,
} from '@/lib/labels';

const CASE_TONE: Record<ProviderVerificationStatus, string> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'neutral',
  SUBMITTED: 'warning',
  UNDER_REVIEW: 'warning',
  NEEDS_REVISION: 'warning',
  VERIFIED: 'success',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

const ACCOUNT_TONE: Record<ProviderAccountStatus, string> = {
  ACTIVE: 'success',
  LIMITED: 'warning',
  SUSPENDED: 'danger',
  BANNED: 'danger',
};

const SUSPENSION_TONE: Record<SuspensionStatus, string> = {
  ACTIVE: 'danger',
  LIFTED: 'neutral',
  EXPIRED: 'neutral',
  EXPIRED_PENDING_REVIEW: 'warning',
};

const LIFECYCLE_TONE: Record<FeePolicyLifecycle, string> = {
  DRAFT: 'neutral',
  SCHEDULED: 'warning',
  ACTIVE: 'success',
  RETIRED: 'neutral',
};

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  INFO: 'neutral',
  WARNING: 'warning',
  CRITICAL: 'danger',
};

const ALERT_TONE: Record<AlertStatus, string> = {
  OPEN: 'danger',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
};

const RUN_TONE: Record<ReconciliationRunStatus, string> = {
  RUNNING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
};

const COMPONENT_TONE: Record<ComponentState, string> = {
  up: 'success',
  down: 'danger',
  degraded: 'warning',
  disabled: 'neutral',
  unknown: 'neutral',
};

const WORKER_TONE: Record<WorkerStatus['health'], string> = {
  ok: 'success',
  stale: 'warning',
  failing: 'danger',
  never_ran: 'neutral',
  disabled: 'neutral',
};

const RISK_TONE: Record<RiskSignalStatus, string> = {
  OPEN: 'warning',
  REVIEWED: 'success',
  DISMISSED: 'neutral',
};

export function VerificationCasePill({ status }: { status: ProviderVerificationStatus }) {
  return (
    <span className={`pill pill-${CASE_TONE[status]}`}>
      {PROVIDER_VERIFICATION_STATUS_LABELS[status]}
    </span>
  );
}

export function AccountStatusPill({ status }: { status: ProviderAccountStatus }) {
  return (
    <span className={`pill pill-${ACCOUNT_TONE[status]}`}>{ACCOUNT_STATUS_LABELS[status]}</span>
  );
}

export function SuspensionStatusPill({ status }: { status: SuspensionStatus }) {
  return (
    <span className={`pill pill-${SUSPENSION_TONE[status]}`}>
      {SUSPENSION_STATUS_LABELS[status]}
    </span>
  );
}

export function FeePolicyPill({ lifecycle }: { lifecycle: FeePolicyLifecycle }) {
  return (
    <span className={`pill pill-${LIFECYCLE_TONE[lifecycle]}`}>
      {FEE_POLICY_LIFECYCLE_LABELS[lifecycle]}
    </span>
  );
}

export function AlertSeverityPill({ severity }: { severity: AlertSeverity }) {
  return (
    <span className={`pill pill-${SEVERITY_TONE[severity]}`}>
      {ALERT_SEVERITY_LABELS[severity]}
    </span>
  );
}

export function AlertStatusPill({ status }: { status: AlertStatus }) {
  return <span className={`pill pill-${ALERT_TONE[status]}`}>{ALERT_STATUS_LABELS[status]}</span>;
}

export function RunStatusPill({ status }: { status: ReconciliationRunStatus }) {
  return (
    <span className={`pill pill-${RUN_TONE[status]}`}>
      {RECONCILIATION_RUN_STATUS_LABELS[status]}
    </span>
  );
}

export function ComponentStatePill({ state }: { state: ComponentState }) {
  return (
    <span className={`pill pill-${COMPONENT_TONE[state]}`}>{COMPONENT_STATE_LABELS[state]}</span>
  );
}

export function WorkerHealthPill({ health }: { health: WorkerStatus['health'] }) {
  return <span className={`pill pill-${WORKER_TONE[health]}`}>{WORKER_HEALTH_LABELS[health]}</span>;
}

export function RiskStatusPill({ status }: { status: RiskSignalStatus }) {
  return (
    <span className={`pill pill-${RISK_TONE[status]}`}>{RISK_SIGNAL_STATUS_LABELS[status]}</span>
  );
}

/** On / off for a feature flag. */
export function FlagPill({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className={`pill pill-${on ? 'success' : 'danger'}`}>
      {label ?? (on ? 'Açık' : 'Kapalı')}
    </span>
  );
}
