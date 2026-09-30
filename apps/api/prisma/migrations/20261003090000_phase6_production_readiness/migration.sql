-- Faz 6: production readiness (docs/adr/0022-0027).
--
-- Additive only: new enums, tables and nullable/defaulted columns. No
-- existing column is dropped or renamed, and no row of payments, refunds,
-- ledger, earnings, payouts, jobs or reviews is changed. Backfills below
-- touch only the new columns/tables (fee policy lifecycle, verification
-- cases derived from Faz 2 approvals, legacy suspensions, least-privilege
-- admin permissions).


-- AlterEnum (new value is not used in this migration)
ALTER TYPE "PayoutStatus" ADD VALUE 'NEEDS_RECONCILIATION';

-- CreateEnum
CREATE TYPE "DocumentScanStatus" AS ENUM ('NOT_SCANNED', 'SAFE', 'REJECTED', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "PayoutDestinationStatus" AS ENUM ('UNVERIFIED', 'PENDING_VERIFICATION', 'VERIFIED');

-- CreateEnum
CREATE TYPE "ProviderVerificationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'NEEDS_REVISION', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ProviderAccountStatus" AS ENUM ('ACTIVE', 'LIMITED', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "ProviderSuspensionStatus" AS ENUM ('ACTIVE', 'LIFTED', 'EXPIRED', 'EXPIRED_PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "AdminPermission" AS ENUM ('ADMIN_SUPPORT', 'ADMIN_VERIFICATION', 'ADMIN_FINANCE', 'ADMIN_SUPER');

-- CreateEnum
CREATE TYPE "RiskSignalType" AS ENUM ('OTP_ABUSE', 'QUOTE_SPAM', 'CANCEL_ABUSE', 'PAYMENT_ABUSE', 'REVIEW_ABUSE', 'DEVICE_ANOMALY', 'ADMIN_FLAG');

-- CreateEnum
CREATE TYPE "RiskSignalStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReconciliationRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('REQUESTED', 'BLOCKED_BY_ACTIVE_JOB', 'PROCESSING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'READY', 'EXPIRED', 'FAILED');

-- AlterEnum
ALTER TYPE "PayoutDestinationType" ADD VALUE 'BANK_ACCOUNT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerificationType" ADD VALUE 'BUSINESS_DOCUMENT';
ALTER TYPE "VerificationType" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "auth_sessions" ADD COLUMN     "ip_hash" CHAR(64),
ADD COLUMN     "is_admin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "deep_link" VARCHAR(200),
ADD COLUMN     "entity_id" VARCHAR(64),
ADD COLUMN     "entity_type" VARCHAR(40);

-- AlterTable
ALTER TABLE "payout_destinations" ADD COLUMN     "external_destination_ref" VARCHAR(120),
ADD COLUMN     "verification_status" "PayoutDestinationStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
ADD COLUMN     "verified_at" TIMESTAMPTZ(3),
ADD COLUMN     "verified_by_id" UUID;

-- AlterTable
ALTER TABLE "platform_fee_policies" ADD COLUMN     "name" VARCHAR(120),
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "published_by_id" UUID,
ADD COLUMN     "retired_at" TIMESTAMPTZ(3),
ADD COLUMN     "retired_by_id" UUID;

-- AlterTable
ALTER TABLE "provider_profiles" ADD COLUMN     "account_status" "ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "account_status_changed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "provider_verifications" ADD COLUMN     "case_id" UUID,
ADD COLUMN     "scan_status" "DocumentScanStatus" NOT NULL DEFAULT 'NOT_SCANNED',
ADD COLUMN     "scanned_at" TIMESTAMPTZ(3),
ADD COLUMN     "sha256" CHAR(64);

-- CreateTable
CREATE TABLE "provider_verification_cases" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "status" "ProviderVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "method" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    "external_reference" VARCHAR(120),
    "submitted_at" TIMESTAMPTZ(3),
    "submission_count" INTEGER NOT NULL DEFAULT 0,
    "review_started_at" TIMESTAMPTZ(3),
    "reviewed_by_admin_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "decision_by_admin_id" UUID,
    "decision_reason_code" VARCHAR(60),
    "user_visible_reason" VARCHAR(500),
    "internal_note" VARCHAR(2000),
    "verified_at" TIMESTAMPTZ(3),
    "source" VARCHAR(30) NOT NULL DEFAULT 'WORKFLOW',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_verification_events" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "event" VARCHAR(40) NOT NULL,
    "from_status" "ProviderVerificationStatus",
    "to_status" "ProviderVerificationStatus" NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "reason_code" VARCHAR(60),
    "user_visible_reason" VARCHAR(500),
    "internal_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_verification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_provider_requirements" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "document_type" "VerificationType" NOT NULL,
    "note" VARCHAR(300),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ(3),

    CONSTRAINT "category_provider_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_suspensions" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "status" "ProviderSuspensionStatus" NOT NULL DEFAULT 'ACTIVE',
    "level" "ProviderAccountStatus" NOT NULL,
    "reason_code" VARCHAR(60) NOT NULL,
    "internal_note" VARCHAR(2000) NOT NULL,
    "user_visible_reason" VARCHAR(500) NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "auto_lift" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "lifted_by_id" UUID,
    "lifted_at" TIMESTAMPTZ(3),
    "lift_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permission_grants" (
    "user_id" UUID NOT NULL,
    "permission" "AdminPermission" NOT NULL,
    "granted_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permission_grants_pkey" PRIMARY KEY ("user_id","permission")
);

-- CreateTable
CREATE TABLE "risk_signals" (
    "id" UUID NOT NULL,
    "type" "RiskSignalType" NOT NULL,
    "status" "RiskSignalStatus" NOT NULL DEFAULT 'OPEN',
    "subject_user_id" UUID,
    "subject_key" VARCHAR(64),
    "evidence" JSONB NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "dedupe_key" VARCHAR(160) NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_alerts" (
    "id" UUID NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(200) NOT NULL,
    "details" JSONB NOT NULL,
    "source" VARCHAR(60) NOT NULL,
    "dedupe_key" VARCHAR(160) NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "resolution_note" VARCHAR(2000),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operational_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_reconciliation_runs" (
    "id" UUID NOT NULL,
    "trigger" VARCHAR(20) NOT NULL,
    "status" "ReconciliationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "counts" JSONB,
    "debit_total_minor" BIGINT,
    "credit_total_minor" BIGINT,
    "mismatch_count" INTEGER,
    "mismatches" JSONB,
    "snapshots_checked" INTEGER NOT NULL DEFAULT 0,
    "snapshot_mismatch_count" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "alert_id" UUID,

    CONSTRAINT "finance_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_account_snapshots" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "as_of" TIMESTAMPTZ(3) NOT NULL,
    "debit_total_minor" BIGINT NOT NULL,
    "credit_total_minor" BIGINT NOT NULL,
    "entry_count" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_account_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeats" (
    "name" VARCHAR(60) NOT NULL,
    "last_run_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "last_failure_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "total_runs" INTEGER NOT NULL DEFAULT 0,
    "total_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "last_duration_ms" INTEGER,
    "last_result" JSONB,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "runtime_flags" (
    "key" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "runtime_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'REQUESTED',
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "DataExportStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "storage_key" VARCHAR(512),

    CONSTRAINT "data_export_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "provider_verification_cases_provider_id_key" ON "provider_verification_cases"("provider_id");

-- CreateIndex
CREATE INDEX "provider_verification_cases_status_submitted_at_idx" ON "provider_verification_cases"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "provider_verification_events_case_id_created_at_idx" ON "provider_verification_events"("case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "category_provider_requirements_live_key" ON "category_provider_requirements"("category_id", "document_type") WHERE (deactivated_at IS NULL);

-- CreateIndex
CREATE INDEX "provider_suspensions_status_expires_at_idx" ON "provider_suspensions"("status", "expires_at");

-- CreateIndex
CREATE INDEX "provider_suspensions_provider_id_created_at_idx" ON "provider_suspensions"("provider_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_suspensions_one_open_key" ON "provider_suspensions"("provider_id") WHERE (status = ANY (ARRAY['ACTIVE'::"ProviderSuspensionStatus", 'EXPIRED_PENDING_REVIEW'::"ProviderSuspensionStatus"]));

-- CreateIndex
CREATE INDEX "risk_signals_status_created_at_idx" ON "risk_signals"("status", "created_at");

-- CreateIndex
CREATE INDEX "risk_signals_subject_user_id_created_at_idx" ON "risk_signals"("subject_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "risk_signals_open_dedupe_key" ON "risk_signals"("dedupe_key") WHERE (status = 'OPEN');

-- CreateIndex
CREATE INDEX "operational_alerts_status_created_at_idx" ON "operational_alerts"("status", "created_at");

-- CreateIndex
CREATE INDEX "operational_alerts_severity_status_idx" ON "operational_alerts"("severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "operational_alerts_open_dedupe_key" ON "operational_alerts"("dedupe_key") WHERE (status <> 'RESOLVED');

-- CreateIndex
CREATE UNIQUE INDEX "finance_reconciliation_runs_one_running_key" ON "finance_reconciliation_runs"("status") WHERE (status = 'RUNNING'::"ReconciliationRunStatus");

-- CreateIndex
CREATE INDEX "finance_reconciliation_runs_started_at_idx" ON "finance_reconciliation_runs"("started_at");

-- CreateIndex
CREATE INDEX "ledger_account_snapshots_as_of_idx" ON "ledger_account_snapshots"("as_of");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_account_snapshots_account_id_as_of_key" ON "ledger_account_snapshots"("account_id", "as_of");

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_requested_at_idx" ON "account_deletion_requests"("status", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_requests_one_open_key" ON "account_deletion_requests"("user_id") WHERE (status = ANY (ARRAY['REQUESTED'::"AccountDeletionStatus", 'BLOCKED_BY_ACTIVE_JOB'::"AccountDeletionStatus", 'PROCESSING'::"AccountDeletionStatus"]));

-- CreateIndex
CREATE INDEX "data_export_requests_user_id_requested_at_idx" ON "data_export_requests"("user_id", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_fee_policies_one_live_per_start_key" ON "platform_fee_policies"("currency", "is_development", "effective_from") WHERE (published_at IS NOT NULL AND retired_at IS NULL);

-- CreateIndex
CREATE INDEX "provider_verifications_case_id_idx" ON "provider_verifications"("case_id");

-- CreateIndex
CREATE INDEX "provider_verifications_provider_id_sha256_idx" ON "provider_verifications"("provider_id", "sha256");

-- AddForeignKey
ALTER TABLE "provider_verifications" ADD CONSTRAINT "provider_verifications_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "provider_verification_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_fee_policies" ADD CONSTRAINT "platform_fee_policies_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_fee_policies" ADD CONSTRAINT "platform_fee_policies_retired_by_id_fkey" FOREIGN KEY ("retired_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_verified_by_id_fkey" FOREIGN KEY ("verified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_cases" ADD CONSTRAINT "provider_verification_cases_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_cases" ADD CONSTRAINT "provider_verification_cases_reviewed_by_admin_id_fkey" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_cases" ADD CONSTRAINT "provider_verification_cases_decision_by_admin_id_fkey" FOREIGN KEY ("decision_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_events" ADD CONSTRAINT "provider_verification_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "provider_verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_events" ADD CONSTRAINT "provider_verification_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_verification_events" ADD CONSTRAINT "provider_verification_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_provider_requirements" ADD CONSTRAINT "category_provider_requirements_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_provider_requirements" ADD CONSTRAINT "category_provider_requirements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_suspensions" ADD CONSTRAINT "provider_suspensions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_suspensions" ADD CONSTRAINT "provider_suspensions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_suspensions" ADD CONSTRAINT "provider_suspensions_lifted_by_id_fkey" FOREIGN KEY ("lifted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permission_grants" ADD CONSTRAINT "admin_permission_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permission_grants" ADD CONSTRAINT "admin_permission_grants_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_signals" ADD CONSTRAINT "risk_signals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runtime_flags" ADD CONSTRAINT "runtime_flags_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_requests" ADD CONSTRAINT "data_export_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfills (new columns / tables only)
-- ---------------------------------------------------------------------------

-- Fee policies that exist today are live: they were inserted directly and
-- already priced jobs. They become PUBLISHED so the lifecycle and the
-- immutability trigger below cover them.
UPDATE "platform_fee_policies"
   SET "published_at" = "created_at", "name" = COALESCE("name", "code")
 WHERE "published_at" IS NULL;

-- Verification cases from Faz 2 decisions. VERIFIED only where an admin
-- approved the identity document AND the application (Faz 2 rule); every
-- other provider starts from what the data proves, never more.
INSERT INTO "provider_verification_cases"
  ("id", "provider_id", "status", "submitted_at", "submission_count",
   "decided_at", "verified_at", "source", "created_at", "updated_at")
SELECT gen_random_uuid(), p."id",
       CASE
         WHEN p."status" IN ('ACTIVE', 'SUSPENDED') AND EXISTS (
           SELECT 1 FROM "provider_verifications" v
            WHERE v."provider_id" = p."id" AND v."type" = 'IDENTITY' AND v."status" = 'APPROVED')
           THEN 'VERIFIED'::"ProviderVerificationStatus"
         WHEN p."status" = 'PENDING_REVIEW' THEN 'SUBMITTED'::"ProviderVerificationStatus"
         WHEN p."status" = 'REJECTED' THEN 'REJECTED'::"ProviderVerificationStatus"
         ELSE 'IN_PROGRESS'::"ProviderVerificationStatus"
       END,
       p."submitted_at",
       CASE WHEN p."submitted_at" IS NULL THEN 0 ELSE 1 END,
       CASE WHEN p."status" IN ('ACTIVE', 'SUSPENDED', 'REJECTED') THEN p."reviewed_at" END,
       CASE WHEN p."status" IN ('ACTIVE', 'SUSPENDED') THEN COALESCE(p."approved_at", p."reviewed_at", now()) END,
       'LEGACY_BACKFILL', now(), now()
  FROM "provider_profiles" p
 WHERE p."deleted_at" IS NULL
   AND (p."status" <> 'DRAFT' OR EXISTS (
         SELECT 1 FROM "provider_verifications" v WHERE v."provider_id" = p."id"))
   AND (p."status" NOT IN ('ACTIVE', 'SUSPENDED') OR EXISTS (
         SELECT 1 FROM "provider_verifications" v
          WHERE v."provider_id" = p."id" AND v."type" = 'IDENTITY' AND v."status" = 'APPROVED'));

INSERT INTO "provider_verification_events"
  ("id", "case_id", "provider_id", "event", "from_status", "to_status", "actor_type", "internal_note", "created_at")
SELECT gen_random_uuid(), c."id", c."provider_id", 'LEGACY_BACKFILL', NULL, c."status", 'SYSTEM',
       'Faz 6 migration: derived from the Faz 2 application and document decisions.', now()
  FROM "provider_verification_cases" c;

UPDATE "provider_verifications" v
   SET "case_id" = c."id"
  FROM "provider_verification_cases" c
 WHERE c."provider_id" = v."provider_id" AND v."case_id" IS NULL;

-- Faz 2 suspensions become account suspensions (the application status is
-- left as it was; the eligibility policy reads both).
INSERT INTO "provider_suspensions"
  ("id", "provider_id", "status", "level", "reason_code", "internal_note",
   "user_visible_reason", "starts_at", "created_by_id", "created_at", "updated_at")
SELECT gen_random_uuid(), p."id", 'ACTIVE', 'SUSPENDED', 'LEGACY_SUSPENSION',
       'Faz 6 migration: Faz 2 provider suspension carried over.',
       COALESCE(p."status_reason", 'Hesabınız geçici olarak askıya alındı.'),
       COALESCE(p."reviewed_at", now()), p."reviewed_by_id", now(), now()
  FROM "provider_profiles" p
 WHERE p."status" = 'SUSPENDED' AND p."deleted_at" IS NULL;

UPDATE "provider_profiles"
   SET "account_status" = 'SUSPENDED', "account_status_changed_at" = COALESCE("reviewed_at", now())
 WHERE "status" = 'SUSPENDED';

-- Least privilege: existing plain ADMINs keep support access only; a
-- SUPER_ADMIN grants finance / verification explicitly (audited).
INSERT INTO "admin_permission_grants" ("user_id", "permission", "created_at")
SELECT ur."user_id", 'ADMIN_SUPPORT', now()
  FROM "user_roles" ur
 WHERE ur."role" = 'ADMIN'
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

ALTER TABLE "provider_verifications"
  ADD CONSTRAINT "provider_verifications_sha256_format_chk"
    CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "provider_verifications_size_positive_chk"
    CHECK ("size_bytes" IS NULL OR "size_bytes" > 0);

ALTER TABLE "provider_verification_cases"
  ADD CONSTRAINT "provider_verification_cases_verified_at_chk"
    CHECK ("status" <> 'VERIFIED' OR "verified_at" IS NOT NULL),
  ADD CONSTRAINT "provider_verification_cases_submission_count_chk"
    CHECK ("submission_count" >= 0);

ALTER TABLE "provider_suspensions"
  ADD CONSTRAINT "provider_suspensions_level_chk" CHECK ("level" <> 'ACTIVE'),
  ADD CONSTRAINT "provider_suspensions_expiry_chk"
    CHECK ("expires_at" IS NULL OR "expires_at" > "starts_at"),
  ADD CONSTRAINT "provider_suspensions_lifted_chk"
    CHECK ("status" <> 'LIFTED' OR "lifted_at" IS NOT NULL);

ALTER TABLE "platform_fee_policies"
  ADD CONSTRAINT "platform_fee_policies_retire_chk"
    CHECK ("retired_at" IS NULL OR ("published_at" IS NOT NULL AND "retired_at" >= "published_at"));

ALTER TABLE "operational_alerts"
  ADD CONSTRAINT "operational_alerts_resolved_chk"
    CHECK ("status" <> 'RESOLVED' OR ("resolved_at" IS NOT NULL AND "resolution_note" IS NOT NULL)),
  ADD CONSTRAINT "operational_alerts_occurrences_chk" CHECK ("occurrences" >= 1);

ALTER TABLE "finance_reconciliation_runs"
  ADD CONSTRAINT "finance_reconciliation_runs_counts_chk"
    CHECK (("mismatch_count" IS NULL OR "mismatch_count" >= 0)
       AND "snapshots_checked" >= 0 AND "snapshot_mismatch_count" >= 0);

ALTER TABLE "ledger_account_snapshots"
  ADD CONSTRAINT "ledger_account_snapshots_totals_chk"
    CHECK ("debit_total_minor" >= 0 AND "credit_total_minor" >= 0 AND "entry_count" >= 0);

ALTER TABLE "payout_destinations"
  ADD CONSTRAINT "payout_destinations_verified_chk"
    CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A published fee policy is a financial fact: its numbers, scope and start
-- never change. Corrections are a new policy (new version). The only
-- change allowed afterwards is retiring it, once. Deleting a published
-- policy is refused (test fixtures use the ledger purge flag).
CREATE FUNCTION "platform_fee_policies_immutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."published_at" IS NULL
       OR current_setting('ustago.ledger_test_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'published fee policy % cannot be deleted', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."published_at" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."bps" IS DISTINCT FROM OLD."bps"
     OR NEW."fixed_fee_minor" IS DISTINCT FROM OLD."fixed_fee_minor"
     OR NEW."min_fee_minor" IS DISTINCT FROM OLD."min_fee_minor"
     OR NEW."max_fee_minor" IS DISTINCT FROM OLD."max_fee_minor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."effective_from" IS DISTINCT FROM OLD."effective_from"
     OR NEW."is_development" IS DISTINCT FROM OLD."is_development"
     OR NEW."code" IS DISTINCT FROM OLD."code"
     OR NEW."published_at" IS DISTINCT FROM OLD."published_at"
     OR NEW."published_by_id" IS DISTINCT FROM OLD."published_by_id"
     OR (OLD."retired_at" IS NOT NULL AND NEW."retired_at" IS DISTINCT FROM OLD."retired_at") THEN
    RAISE EXCEPTION 'published fee policy % is immutable; create a new policy version', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "platform_fee_policies_immutable"
  BEFORE UPDATE OR DELETE ON "platform_fee_policies"
  FOR EACH ROW EXECUTE FUNCTION "platform_fee_policies_immutable"();

-- Operation history is kept: audit logs and verification timelines cannot
-- be edited or deleted through the application. The only UPDATE allowed is
-- the foreign key clearing the actor when a user row is removed (ON DELETE
-- SET NULL). Test fixtures may delete with `ustago.audit_test_purge = 'on'`
-- in their transaction; application code never sets it and the production
-- release checklist removes this escape hatch (docs/runbooks).
CREATE FUNCTION "history_append_only_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('ustago.audit_test_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only: DELETE is not allowed', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."actor_id" IS NULL AND OLD."actor_id" IS NOT NULL
     AND (to_jsonb(NEW) - 'actor_id') = (to_jsonb(OLD) - 'actor_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is append-only: UPDATE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "history_append_only_guard"();

CREATE TRIGGER "provider_verification_events_append_only"
  BEFORE UPDATE OR DELETE ON "provider_verification_events"
  FOR EACH ROW EXECUTE FUNCTION "history_append_only_guard"();
