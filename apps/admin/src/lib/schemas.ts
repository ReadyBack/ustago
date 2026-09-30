import type {
  AdminFeePolicy,
  AdminOperationsStatus,
  AdminProvider360,
  AdminSuspension,
  AdminUserPermissions,
  AdminVerificationCaseDetail,
  AdminVerificationCaseListItem,
  CategoryRequirement,
  FeePreviewLine,
  OperationalAlert,
  ReconciliationRun,
  RiskSignal,
  RuntimeFlagView,
  WorkerStatus,
} from '@ustago/types';
import {
  adminPermissionSchema,
  auditEventSchema,
  moneySchema,
  providerAccountStatusSchema,
  providerStatusSchema,
  providerVerificationSchema,
  providerVerificationStatusSchema,
  riskSignalTypeSchema,
  serviceCategorySchema,
  verificationTypeSchema,
} from '@ustago/validation';
import { z } from 'zod';

/**
 * Response schemas for the Faz 6 admin endpoints. The shared package only
 * ships their request schemas, so the admin validates the responses here;
 * `satisfies` keeps every schema in step with the shared types.
 */

const date = z.iso.datetime();
const nullableDate = date.nullable();
const namedRef = z.object({ id: z.string(), name: z.string() });
const record = z.record(z.string(), z.unknown());

// -- Trust ------------------------------------------------------------------

const capabilitiesSchema = z.object({
  listed: z.boolean(),
  canQuote: z.boolean(),
  canTakeNowJobs: z.boolean(),
  canRequestPayout: z.boolean(),
  showVerifiedBadge: z.boolean(),
  restrictions: z.array(z.string()),
});

const checklistItemSchema = z.object({
  key: z.enum(['PROFILE', 'SERVICES', 'SERVICE_AREAS', 'DOCUMENTS', 'SUBMIT']),
  label: z.string(),
  done: z.boolean(),
});

const actorTypeSchema = z.enum(['PROVIDER', 'ADMIN', 'SYSTEM']);

export const adminSuspensionSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  level: z.enum(['SUSPENDED', 'BANNED', 'LIMITED']),
  status: z.enum(['ACTIVE', 'LIFTED', 'EXPIRED', 'EXPIRED_PENDING_REVIEW']),
  reasonCode: z.string(),
  userVisibleReason: z.string(),
  internalNote: z.string().nullable(),
  startsAt: date,
  expiresAt: nullableDate,
  autoLift: z.boolean(),
  createdAt: date,
  createdBy: namedRef.nullable(),
  liftedBy: namedRef.nullable(),
  liftedAt: nullableDate,
  liftNote: z.string().nullable(),
}) satisfies z.ZodType<AdminSuspension>;

export const adminVerificationCaseListItemSchema = z.object({
  providerId: z.string(),
  displayName: z.string(),
  contactName: z.string(),
  status: providerVerificationStatusSchema,
  providerStatus: providerStatusSchema,
  accountStatus: providerAccountStatusSchema,
  submittedAt: nullableDate,
  submissionCount: z.number().int(),
  documentCount: z.number().int(),
  reviewedBy: namedRef.nullable(),
  updatedAt: date,
}) satisfies z.ZodType<AdminVerificationCaseListItem>;

export const adminVerificationCaseDetailSchema = z.object({
  providerId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  contact: z.object({
    firstName: z.string(),
    lastName: z.string(),
    phoneMasked: z.string().nullable(),
  }),
  status: providerVerificationStatusSchema,
  providerStatus: providerStatusSchema,
  accountStatus: providerAccountStatusSchema,
  method: z.literal('MANUAL'),
  source: z.string(),
  submittedAt: nullableDate,
  submissionCount: z.number().int(),
  reviewStartedAt: nullableDate,
  reviewedBy: namedRef.nullable(),
  decidedAt: nullableDate,
  decisionBy: namedRef.nullable(),
  decisionReasonCode: z.string().nullable(),
  userVisibleReason: z.string().nullable(),
  internalNote: z.string().nullable(),
  verifiedAt: nullableDate,
  version: z.number().int(),
  categories: z.array(z.string()),
  areas: z.array(z.string()),
  checklist: z.array(checklistItemSchema),
  documents: z.array(
    providerVerificationSchema.extend({
      sha256: z.string().nullable(),
      scanStatus: z.enum(['NOT_SCANNED', 'SAFE', 'REJECTED', 'QUARANTINED']),
      duplicateOfOtherProvider: z.boolean(),
    }),
  ),
  requiredDocumentTypes: z.array(verificationTypeSchema),
  timeline: z.array(
    z.object({
      id: z.string(),
      event: z.string(),
      fromStatus: providerVerificationStatusSchema.nullable(),
      toStatus: providerVerificationStatusSchema,
      actorType: actorTypeSchema,
      userVisibleReason: z.string().nullable(),
      createdAt: date,
      actor: namedRef.nullable(),
      reasonCode: z.string().nullable(),
      internalNote: z.string().nullable(),
    }),
  ),
  actions: z.object({
    startReview: z.boolean(),
    approve: z.boolean(),
    requestRevision: z.boolean(),
    reject: z.boolean(),
  }),
}) satisfies z.ZodType<AdminVerificationCaseDetail>;

export const categoryRequirementSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  documentType: verificationTypeSchema,
  note: z.string().nullable(),
  createdAt: date,
}) satisfies z.ZodType<CategoryRequirement>;

/** GET /categories returns the active tree: parents with their children. */
export const categoryTreeSchema = z.array(
  serviceCategorySchema.extend({ children: z.array(serviceCategorySchema).default([]) }),
);

export const adminProvider360Schema = z.object({
  providerId: z.string(),
  userId: z.string(),
  displayName: z.string(),
  applicationStatus: providerStatusSchema,
  accountStatus: providerAccountStatusSchema,
  verificationStatus: providerVerificationStatusSchema,
  capabilities: capabilitiesSchema,
  createdAt: date,
  contact: z.object({
    name: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
  }),
  suspensions: z.array(adminSuspensionSchema),
  jobs: z.object({
    total: z.number().int(),
    byStatus: z.record(z.string(), z.number()),
    recent: z.array(
      z.object({ id: z.string(), status: z.string(), currentTotal: moneySchema, createdAt: date }),
    ),
  }),
  reviews: z.object({
    published: z.number().int(),
    hidden: z.number().int(),
    average: z.number().nullable(),
    recent: z.array(
      z.object({
        id: z.string(),
        rating: z.number(),
        comment: z.string().nullable(),
        status: z.string(),
        createdAt: date,
      }),
    ),
  }),
  quality: z.object({
    ustaScore: z.number().nullable(),
    sampleSize: z.number().int(),
    isNewProvider: z.boolean(),
    computedAt: nullableDate,
  }),
  finance: z.object({
    balances: z.object({
      pending: moneySchema,
      held: moneySchema,
      available: moneySchema,
      reserved: moneySchema,
      platformDebt: moneySchema,
      withdrawable: moneySchema,
      paidOut: moneySchema,
    }),
    earningsByStatus: z.record(z.string(), moneySchema),
    recentPayouts: z.array(
      z.object({ id: z.string(), status: z.string(), amount: moneySchema, createdAt: date }),
    ),
    destination: z
      .object({
        maskedIban: z.string(),
        isTest: z.boolean(),
        verificationStatus: z.enum(['UNVERIFIED', 'PENDING_VERIFICATION', 'VERIFIED']),
      })
      .nullable(),
  }),
  penalties: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      reasonCode: z.string(),
      startsAt: date,
      endsAt: nullableDate,
    }),
  ),
  audit: z.array(auditEventSchema),
}) satisfies z.ZodType<AdminProvider360>;

// -- Operations -------------------------------------------------------------

export const adminFeePolicySchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  currency: z.literal('TRY'),
  bps: z.number().int(),
  fixed: moneySchema,
  min: moneySchema.nullable(),
  max: moneySchema.nullable(),
  effectiveFrom: date,
  lifecycle: z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'RETIRED']),
  scope: z.literal('GLOBAL'),
  isDevelopment: z.boolean(),
  publishedAt: nullableDate,
  publishedBy: namedRef.nullable(),
  retiredAt: nullableDate,
  jobsUsing: z.number().int(),
  createdAt: date,
}) satisfies z.ZodType<AdminFeePolicy>;

export const feePreviewLineSchema = z.object({
  gross: moneySchema,
  fee: moneySchema,
  providerNet: moneySchema,
}) satisfies z.ZodType<FeePreviewLine>;

export const operationalAlertSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']),
  title: z.string(),
  details: record,
  source: z.string(),
  occurrences: z.number().int(),
  firstSeenAt: date,
  lastSeenAt: date,
  acknowledgedBy: namedRef.nullable(),
  acknowledgedAt: nullableDate,
  resolvedBy: namedRef.nullable(),
  resolvedAt: nullableDate,
  resolutionNote: z.string().nullable(),
}) satisfies z.ZodType<OperationalAlert>;

export const reconciliationRunSchema = z.object({
  id: z.string(),
  trigger: z.enum(['SCHEDULED', 'MANUAL']),
  status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED']),
  startedAt: date,
  finishedAt: nullableDate,
  durationMs: z.number().nullable(),
  counts: z.record(z.string(), z.number()).nullable(),
  mismatches: z.array(
    z.object({
      kind: z.string(),
      entityType: z.string(),
      entityId: z.string(),
      message: z.string(),
    }),
  ),
  totals: z.object({ debit: moneySchema, credit: moneySchema }).nullable(),
  mismatchCount: z.number().int(),
  snapshotsChecked: z.number().int(),
  snapshotMismatchCount: z.number().int(),
  error: z.string().nullable(),
  alertId: z.string().nullable(),
}) satisfies z.ZodType<ReconciliationRun>;

export const runtimeFlagSchema = z.object({
  key: z.string(),
  label: z.string(),
  envEnabled: z.boolean(),
  adminEnabled: z.boolean(),
  effective: z.boolean(),
  reason: z.string().nullable(),
  updatedBy: namedRef.nullable(),
  updatedAt: nullableDate,
}) satisfies z.ZodType<RuntimeFlagView>;

const componentStateSchema = z.enum(['up', 'down', 'degraded', 'disabled', 'unknown']);

const workerStatusSchema = z.object({
  name: z.string(),
  lastRunAt: nullableDate,
  lastSuccessAt: nullableDate,
  lastFailureAt: nullableDate,
  consecutiveFailures: z.number().int(),
  totalRuns: z.number().int(),
  totalFailures: z.number().int(),
  lastDurationMs: z.number().nullable(),
  lastError: z.string().nullable(),
  health: z.enum(['ok', 'stale', 'failing', 'never_ran', 'disabled']),
}) satisfies z.ZodType<WorkerStatus>;

export const adminOperationsStatusSchema = z.object({
  environment: z.enum(['development', 'test', 'staging', 'production']),
  version: z.string(),
  checkedAt: date,
  components: z.object({
    api: componentStateSchema,
    database: componentStateSchema,
    redis: componentStateSchema,
    pushOutbox: componentStateSchema,
    reconciliation: componentStateSchema,
  }),
  pushOutbox: z.object({
    pending: z.number().int(),
    failed: z.number().int(),
    oldestPendingAgeSeconds: z.number().nullable(),
  }),
  payouts: z.object({ needsReconciliation: z.number().int(), requested: z.number().int() }),
  webhooks: z.object({
    received24h: z.number().int(),
    ignored24h: z.number().int(),
    rejectedSinceStart: z.number().int(),
    duplicatesSinceStart: z.number().int(),
  }),
  latestReconciliation: reconciliationRunSchema.nullable(),
  openAlerts: z.object({
    critical: z.number().int(),
    warning: z.number().int(),
    info: z.number().int(),
  }),
  workers: z.array(workerStatusSchema),
  flags: z.array(runtimeFlagSchema),
  integrations: z.array(
    z.object({ name: z.string(), mode: z.string(), productionReady: z.boolean() }),
  ),
}) satisfies z.ZodType<AdminOperationsStatus>;

// -- Security ---------------------------------------------------------------

export const adminUserPermissionsSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  permissions: z.array(adminPermissionSchema),
  effective: z.array(adminPermissionSchema),
}) satisfies z.ZodType<AdminUserPermissions>;

export const riskSignalSchema = z.object({
  id: z.string(),
  type: riskSignalTypeSchema,
  status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']),
  subject: namedRef.nullable(),
  evidence: record,
  source: z.string(),
  occurrences: z.number().int(),
  firstSeenAt: date,
  lastSeenAt: date,
  reviewedBy: namedRef.nullable(),
  reviewNote: z.string().nullable(),
}) satisfies z.ZodType<RiskSignal>;
