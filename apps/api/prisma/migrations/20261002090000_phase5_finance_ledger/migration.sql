-- Faz 5: payments, refunds, cash settlements, provider earnings, payouts,
-- webhook de-duplication and the double-entry ledger (docs/adr/0018-0020).
-- Additive: no existing table or column is dropped; non-finance data is
-- untouched. Enum value renames only touch values nothing has used yet.

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('JOB_CANCELLED', 'DISPUTE_RESOLUTION', 'SERVICE_ISSUE', 'CUSTOMER_REQUEST', 'DUPLICATE_PAYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProviderEarningStatus" AS ENUM ('PENDING', 'HELD', 'AVAILABLE', 'REVERSED');

-- CreateEnum
CREATE TYPE "CashSettlementStatus" AS ENUM ('AWAITING_CONFIRMATION', 'CUSTOMER_CONFIRMED', 'PROVIDER_CONFIRMED', 'CONFIRMED', 'DISPUTED', 'RESOLVED_UNPAID');

-- CreateEnum
CREATE TYPE "PayoutDestinationType" AS ENUM ('TEST_BANK_ACCOUNT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WebhookEventOutcome" AS ENUM ('PROCESSED', 'IGNORED_STALE', 'IGNORED_UNKNOWN');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('PAYMENT_CAPTURED', 'EARNING_RELEASED', 'CASH_FEE_ASSESSED', 'REFUND_REQUESTED', 'REFUND_COMPLETED', 'PAYOUT_RESERVED', 'PAYOUT_PAID', 'PAYOUT_RELEASED', 'REVERSAL', 'ADJUSTMENT');

-- AlterEnum: Faz 1 declared these values but nothing ever wrote them
-- (payments and ledger tables are empty before Faz 5). Renaming keeps the
-- types; no data changes.
ALTER TYPE "LedgerAccountType" RENAME VALUE 'PROVIDER_PAID_OUT' TO 'PROVIDER_RESERVED';
ALTER TYPE "LedgerAccountType" RENAME VALUE 'REFUNDS' TO 'REFUND_LIABILITY';
ALTER TYPE "LedgerAccountType" ADD VALUE 'PROVIDER_PLATFORM_DEBT';
ALTER TYPE "PaymentStatus" RENAME VALUE 'CAPTURED' TO 'SUCCEEDED';

-- AlterEnum
ALTER TYPE "PaymentTransactionStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "platform_fee_bps" INTEGER,
ADD COLUMN     "platform_fee_policy_id" UUID;

-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "attempt_number" SMALLINT NOT NULL DEFAULT 1,
ADD COLUMN     "completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "gateway" VARCHAR(40);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3),
ADD COLUMN     "failed_at" TIMESTAMPTZ(3),
ADD COLUMN     "last_failure_code" VARCHAR(60),
ADD COLUMN     "platform_fee_bps" INTEGER,
ADD COLUMN     "provider_id" UUID,
ADD COLUMN     "succeeded_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "fee_portion_minor" BIGINT NOT NULL,
    "provider_portion_minor" BIGINT NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TRY',
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "RefundReason" NOT NULL,
    "internal_note" VARCHAR(1000),
    "requested_by_id" UUID,
    "gateway_refund_id" VARCHAR(120),
    "idempotency_key" VARCHAR(120) NOT NULL,
    "failure_code" VARCHAR(60),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_fee_policies" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "bps" INTEGER NOT NULL,
    "fixed_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "min_fee_minor" BIGINT,
    "max_fee_minor" BIGINT,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TRY',
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "is_development" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_fee_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_earnings" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "gross_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL,
    "net_minor" BIGINT NOT NULL,
    "fee_bps" INTEGER NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TRY',
    "status" "ProviderEarningStatus" NOT NULL DEFAULT 'PENDING',
    "hold_until" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "held_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_settlements" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "fee_minor" BIGINT NOT NULL DEFAULT 0,
    "fee_bps" INTEGER NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TRY',
    "status" "CashSettlementStatus" NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "customer_confirmed_at" TIMESTAMPTZ(3),
    "provider_confirmed_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "disputed_at" TIMESTAMPTZ(3),
    "disputed_by_id" UUID,
    "dispute_note" VARCHAR(1000),
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cash_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_destinations" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "type" "PayoutDestinationType" NOT NULL DEFAULT 'TEST_BANK_ACCOUNT',
    "holder_name" VARCHAR(120) NOT NULL,
    "masked_iban" VARCHAR(40) NOT NULL,
    "last4" VARCHAR(4) NOT NULL,
    "is_test" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ(3),

    CONSTRAINT "payout_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "destination_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TRY',
    "status" "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "idempotency_key" VARCHAR(120) NOT NULL,
    "gateway" VARCHAR(40),
    "gateway_reference" VARCHAR(120),
    "failure_code" VARCHAR(60),
    "status_note" VARCHAR(500),
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "processing_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(120) NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "outcome" "WebhookEventOutcome" NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TRY',
    "source_key" VARCHAR(160) NOT NULL,
    "description" VARCHAR(300),
    "job_id" UUID,
    "payment_id" UUID,
    "refund_id" UUID,
    "payout_id" UUID,
    "cash_settlement_id" UUID,
    "earning_id" UUID,
    "provider_id" UUID,
    "reverses_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_payment_id_status_idx" ON "refunds"("payment_id", "status");

-- CreateIndex
CREATE INDEX "refunds_status_created_at_idx" ON "refunds"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_fee_policies_code_key" ON "platform_fee_policies"("code");

-- CreateIndex
CREATE INDEX "platform_fee_policies_currency_effective_from_idx" ON "platform_fee_policies"("currency", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "provider_earnings_payment_id_key" ON "provider_earnings"("payment_id");

-- CreateIndex
CREATE INDEX "provider_earnings_provider_id_created_at_idx" ON "provider_earnings"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "provider_earnings_status_hold_until_idx" ON "provider_earnings"("status", "hold_until");

-- CreateIndex
CREATE INDEX "provider_earnings_job_id_idx" ON "provider_earnings"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_settlements_job_id_key" ON "cash_settlements"("job_id");

-- CreateIndex
CREATE INDEX "cash_settlements_status_created_at_idx" ON "cash_settlements"("status", "created_at");

-- CreateIndex
CREATE INDEX "cash_settlements_provider_id_created_at_idx" ON "cash_settlements"("provider_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_destinations_one_active_key" ON "payout_destinations"("provider_id") WHERE (deactivated_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "payouts_idempotency_key_key" ON "payouts"("idempotency_key");

-- CreateIndex
CREATE INDEX "payouts_provider_id_created_at_idx" ON "payouts"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_gateway_gateway_reference_key" ON "payouts"("gateway", "gateway_reference");

-- CreateIndex
CREATE INDEX "processed_webhook_events_received_at_idx" ON "processed_webhook_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhook_events_provider_event_id_key" ON "processed_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_source_key_key" ON "ledger_transactions"("source_key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_reverses_id_key" ON "ledger_transactions"("reverses_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_type_created_at_idx" ON "ledger_transactions"("type", "created_at");

-- CreateIndex
CREATE INDEX "ledger_transactions_provider_id_created_at_idx" ON "ledger_transactions"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_transactions_job_id_idx" ON "ledger_transactions"("job_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_payment_id_idx" ON "ledger_transactions"("payment_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_refund_id_idx" ON "ledger_transactions"("refund_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_payout_id_idx" ON "ledger_transactions"("payout_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_cash_settlement_id_idx" ON "ledger_transactions"("cash_settlement_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_earning_id_idx" ON "ledger_transactions"("earning_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_created_at_idx" ON "ledger_transactions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_gateway_gateway_transaction_id_key" ON "payment_transactions"("gateway", "gateway_transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_payment_id_attempt_number_key" ON "payment_transactions"("payment_id", "attempt_number");

-- CreateIndex
CREATE INDEX "payments_payer_id_created_at_idx" ON "payments"("payer_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_provider_id_created_at_idx" ON "payments"("provider_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_one_in_flight_per_job_key" ON "payments"("job_id") WHERE (status = ANY (ARRAY['PENDING'::"PaymentStatus", 'AUTHORIZED'::"PaymentStatus"]));

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_platform_fee_policy_id_fkey" FOREIGN KEY ("platform_fee_policy_id") REFERENCES "platform_fee_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_fee_policies" ADD CONSTRAINT "platform_fee_policies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_earnings" ADD CONSTRAINT "provider_earnings_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_disputed_by_id_fkey" FOREIGN KEY ("disputed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_settlements" ADD CONSTRAINT "cash_settlements_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "payout_destinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_cash_settlement_id_fkey" FOREIGN KEY ("cash_settlement_id") REFERENCES "cash_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_earning_id_fkey" FOREIGN KEY ("earning_id") REFERENCES "provider_earnings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Money invariants the database enforces on its own (docs/adr/0018).
-- ---------------------------------------------------------------------------

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive_chk" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payments_fee_range_chk"
    CHECK ("platform_fee_minor" >= 0 AND "platform_fee_minor" <= "amount_minor"),
  ADD CONSTRAINT "payments_fee_bps_range_chk"
    CHECK ("platform_fee_bps" IS NULL OR "platform_fee_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "payments_succeeded_at_chk"
    CHECK ("status" NOT IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED') OR "succeeded_at" IS NOT NULL);

ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_amount_positive_chk" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "payment_transactions_attempt_positive_chk" CHECK ("attempt_number" >= 1);

ALTER TABLE "refunds"
  ADD CONSTRAINT "refunds_amount_positive_chk" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "refunds_split_chk"
    CHECK ("fee_portion_minor" >= 0 AND "provider_portion_minor" >= 0
      AND "fee_portion_minor" + "provider_portion_minor" = "amount_minor");

ALTER TABLE "platform_fee_policies"
  ADD CONSTRAINT "platform_fee_policies_bps_range_chk" CHECK ("bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "platform_fee_policies_fixed_chk" CHECK ("fixed_fee_minor" >= 0),
  ADD CONSTRAINT "platform_fee_policies_min_max_chk"
    CHECK (("min_fee_minor" IS NULL OR "min_fee_minor" >= 0)
      AND ("max_fee_minor" IS NULL OR "max_fee_minor" >= 0)
      AND ("min_fee_minor" IS NULL OR "max_fee_minor" IS NULL OR "min_fee_minor" <= "max_fee_minor"));

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_platform_fee_bps_range_chk"
    CHECK ("platform_fee_bps" IS NULL OR "platform_fee_bps" BETWEEN 0 AND 10000);

ALTER TABLE "provider_earnings"
  ADD CONSTRAINT "provider_earnings_split_chk"
    CHECK ("gross_minor" > 0 AND "fee_minor" >= 0 AND "net_minor" >= 0
      AND "fee_minor" + "net_minor" = "gross_minor"),
  ADD CONSTRAINT "provider_earnings_fee_bps_range_chk" CHECK ("fee_bps" BETWEEN 0 AND 10000);

ALTER TABLE "cash_settlements"
  ADD CONSTRAINT "cash_settlements_amount_positive_chk" CHECK ("amount_minor" > 0),
  ADD CONSTRAINT "cash_settlements_fee_range_chk"
    CHECK ("fee_minor" >= 0 AND "fee_minor" <= "amount_minor"),
  ADD CONSTRAINT "cash_settlements_fee_bps_range_chk" CHECK ("fee_bps" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "cash_settlements_confirmed_chk"
    CHECK ("status" <> 'CONFIRMED' OR "confirmed_at" IS NOT NULL);

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_amount_positive_chk" CHECK ("amount_minor" > 0);

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_amount_positive_chk" CHECK ("amount_minor" > 0);

-- A payment can never be refunded beyond its amount. The application
-- checks this under the payment's row lock; this trigger is the backstop.
CREATE FUNCTION "refunds_total_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  paid BIGINT;
  refunded BIGINT;
BEGIN
  SELECT "amount_minor" INTO paid FROM "payments" WHERE "id" = NEW."payment_id";
  SELECT COALESCE(SUM("amount_minor"), 0) INTO refunded
    FROM "refunds"
    WHERE "payment_id" = NEW."payment_id" AND "status" <> 'FAILED' AND "id" <> NEW."id";
  IF NEW."status" <> 'FAILED' AND refunded + NEW."amount_minor" > paid THEN
    RAISE EXCEPTION 'refund total % exceeds payment amount % (payment %)',
      refunded + NEW."amount_minor", paid, NEW."payment_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "refunds_total_guard"
  BEFORE INSERT OR UPDATE OF "amount_minor", "status" ON "refunds"
  FOR EACH ROW EXECUTE FUNCTION "refunds_total_guard"();

-- Ledger rows are never changed. Corrections are new REVERSAL/ADJUSTMENT
-- transactions. DELETE is only possible for automated test fixtures that
-- explicitly set `ustago.ledger_test_purge = 'on'` in their transaction;
-- application code never does, and production roles should not be able to
-- set it (see docs/adr/0018).
CREATE FUNCTION "ledger_append_only_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('ustago.ledger_test_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only_guard"();

CREATE TRIGGER "ledger_transactions_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION "ledger_append_only_guard"();

-- Double entry: at commit, every ledger transaction touched in this
-- database transaction has at least two entries, one currency, and
-- total debit = total credit. Deferred so the entries of one transaction
-- can be inserted one by one.
CREATE FUNCTION "ledger_transaction_balance_check"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  debit BIGINT;
  credit BIGINT;
  entry_count INTEGER;
  currencies INTEGER;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount_minor" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount_minor" ELSE 0 END), 0),
    COUNT(*),
    COUNT(DISTINCT "currency")
  INTO debit, credit, entry_count, currencies
  FROM "ledger_entries"
  WHERE "journal_id" = NEW."journal_id";
  IF entry_count < 2 OR debit <> credit OR currencies <> 1 THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (debit %, credit %, entries %, currencies %)',
      NEW."journal_id", debit, credit, entry_count, currencies
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ledger_entries_balanced"
  AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "ledger_transaction_balance_check"();
