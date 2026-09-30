-- Phase 4: job lifecycle, change orders, completion, disputes, reviews,
-- UstaScore snapshot inputs, notification preferences and the push outbox
-- (docs/adr/0015, 0016, 0017).
--
-- Additive only: new nullable columns, new tables, new indexes and checks.
-- No column or table is dropped; two plain indexes are replaced by wider
-- ones. The checks below hold for every row a Phase 3 database can contain
-- (jobs are only ever CREATED there; no change order, review or dispute was
-- written by the API yet); the backfill makes that explicit.
-- CreateEnum
CREATE TYPE "JobActor" AS ENUM ('CUSTOMER', 'PROVIDER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PushDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DEV_LOGGED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PushTicketStatus" AS ENUM ('OK', 'ERROR');

-- CreateEnum
CREATE TYPE "PushReceiptStatus" AS ENUM ('PENDING', 'OK', 'ERROR', 'NOT_APPLICABLE');

-- DropIndex
DROP INDEX "disputes_status_idx";

-- DropIndex
DROP INDEX "reviews_target_id_status_idx";

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "push_token_invalidated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "arrived_at" TIMESTAMPTZ(3),
ADD COLUMN     "cancellation_actor" "JobActor",
ADD COLUMN     "completion_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "disputed_at" TIMESTAMPTZ(3),
ADD COLUMN     "en_route_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "moderated_at" TIMESTAMPTZ(3),
ADD COLUMN     "moderated_by_id" UUID,
ADD COLUMN     "moderation_reason" VARCHAR(500);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "quote_updates_push" BOOLEAN NOT NULL DEFAULT true,
    "marketing_push" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "push_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" SMALLINT NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "push_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_tickets" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "ticket_id" VARCHAR(100),
    "status" "PushTicketStatus" NOT NULL,
    "error" VARCHAR(100),
    "receipt_status" "PushReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "receipt_error" VARCHAR(100),
    "receipt_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_deliveries_notification_id_key" ON "push_deliveries"("notification_id");

-- CreateIndex
CREATE INDEX "push_deliveries_status_next_attempt_at_idx" ON "push_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "push_tickets_receipt_status_created_at_idx" ON "push_tickets"("receipt_status", "created_at");

-- CreateIndex
CREATE INDEX "push_tickets_delivery_id_idx" ON "push_tickets"("delivery_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_one_pending_per_job_key" ON "change_orders"("job_id") WHERE (status = 'PENDING');

-- CreateIndex
CREATE INDEX "disciplinary_actions_status_ends_at_idx" ON "disciplinary_actions"("status", "ends_at");

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_one_open_per_job_key" ON "disputes"("job_id") WHERE (status = ANY (ARRAY['OPEN'::"DisputeStatus", 'AWAITING_EVIDENCE'::"DisputeStatus", 'UNDER_REVIEW'::"DisputeStatus"]));

-- CreateIndex
CREATE INDEX "jobs_customer_id_status_idx" ON "jobs"("customer_id", "status");

-- CreateIndex
CREATE INDEX "jobs_completed_at_idx" ON "jobs"("completed_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "reviews_target_id_status_created_at_idx" ON "reviews"("target_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "push_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tickets" ADD CONSTRAINT "push_tickets_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill (defensive: Phase 3 never cancelled a job).
-- ---------------------------------------------------------------------------
UPDATE "jobs" SET "cancelled_at" = "updated_at"
  WHERE "status" = 'CANCELLED' AND "cancelled_at" IS NULL;
UPDATE "jobs" SET "cancellation_actor" = 'SYSTEM'
  WHERE "status" = 'CANCELLED' AND "cancellation_actor" IS NULL;

-- ---------------------------------------------------------------------------
-- Hand-written checks (not modelled by Prisma; they do not affect the diff).
-- ---------------------------------------------------------------------------

-- Jobs: the running total only grows through accepted change orders (extra
-- work is positive), and each status carries the timestamp of its step.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_current_total_ge_agreed_chk"
    CHECK ("current_total_minor" >= "agreed_price_minor"),
  ADD CONSTRAINT "jobs_step_order_chk"
    CHECK (
      ("arrived_at" IS NULL OR ("en_route_at" IS NOT NULL AND "en_route_at" <= "arrived_at"))
      AND ("started_at" IS NULL OR ("arrived_at" IS NOT NULL AND "arrived_at" <= "started_at"))
      AND ("completion_requested_at" IS NULL
           OR ("started_at" IS NOT NULL AND "started_at" <= "completion_requested_at"))
      AND ("completed_at" IS NULL
           OR ("completion_requested_at" IS NOT NULL AND "completion_requested_at" <= "completed_at"))
    ),
  ADD CONSTRAINT "jobs_status_timestamps_chk"
    CHECK (
      ("status" <> 'PROVIDER_EN_ROUTE' OR "en_route_at" IS NOT NULL)
      AND ("status" <> 'PROVIDER_ARRIVED' OR "arrived_at" IS NOT NULL)
      AND ("status" <> 'IN_PROGRESS' OR "started_at" IS NOT NULL)
      AND ("status" <> 'AWAITING_COMPLETION_CONFIRMATION' OR "completion_requested_at" IS NOT NULL)
      AND ("status" <> 'COMPLETED' OR "completed_at" IS NOT NULL)
      AND ("status" <> 'DISPUTED' OR "disputed_at" IS NOT NULL)
      AND ("status" <> 'CANCELLED' OR ("cancelled_at" IS NOT NULL AND "cancellation_actor" IS NOT NULL))
    );

-- AGREED_PRICE, the parties, the currency and every step timestamp are
-- write-once. Normal endpoints never try; this makes it true for admin
-- tools and hand-written SQL as well. (A correction needs its own audited
-- mechanism that disables this trigger explicitly.)
CREATE FUNCTION "jobs_write_once_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."agreed_price_minor" IS DISTINCT FROM OLD."agreed_price_minor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
     OR NEW."provider_id" IS DISTINCT FROM OLD."provider_id"
     OR NEW."service_request_id" IS DISTINCT FROM OLD."service_request_id" THEN
    RAISE EXCEPTION 'jobs: agreed price, currency and parties are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD."en_route_at" IS NOT NULL AND NEW."en_route_at" IS DISTINCT FROM OLD."en_route_at")
     OR (OLD."arrived_at" IS NOT NULL AND NEW."arrived_at" IS DISTINCT FROM OLD."arrived_at")
     OR (OLD."started_at" IS NOT NULL AND NEW."started_at" IS DISTINCT FROM OLD."started_at")
     OR (OLD."completion_requested_at" IS NOT NULL
         AND NEW."completion_requested_at" IS DISTINCT FROM OLD."completion_requested_at")
     OR (OLD."completed_at" IS NOT NULL AND NEW."completed_at" IS DISTINCT FROM OLD."completed_at")
     OR (OLD."disputed_at" IS NOT NULL AND NEW."disputed_at" IS DISTINCT FROM OLD."disputed_at")
     OR (OLD."cancelled_at" IS NOT NULL AND NEW."cancelled_at" IS DISTINCT FROM OLD."cancelled_at") THEN
    RAISE EXCEPTION 'jobs: step timestamps are write-once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "jobs_write_once_guard"
  BEFORE UPDATE ON "jobs"
  FOR EACH ROW EXECUTE FUNCTION "jobs_write_once_guard"();

-- Change orders: extra work is a positive amount and the proposal records
-- the exact total it leads to. Answered orders carry the answer time.
ALTER TABLE "change_orders"
  ADD CONSTRAINT "change_orders_amount_positive_chk" CHECK ("amount_delta_minor" > 0),
  ADD CONSTRAINT "change_orders_totals_chk"
    CHECK ("previous_total_minor" > 0
           AND "proposed_total_minor" = "previous_total_minor" + "amount_delta_minor"),
  ADD CONSTRAINT "change_orders_responded_chk"
    CHECK (("status" = 'PENDING') = ("responded_at" IS NULL));

-- Reviews: every rating is 1-5, nobody reviews themselves, a hidden review
-- records when it was moderated.
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_rating_range_chk" CHECK ("rating" BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_sub_ratings_range_chk"
    CHECK (("quality_rating" IS NULL OR "quality_rating" BETWEEN 1 AND 5)
           AND ("punctuality_rating" IS NULL OR "punctuality_rating" BETWEEN 1 AND 5)
           AND ("communication_rating" IS NULL OR "communication_rating" BETWEEN 1 AND 5)
           AND ("price_rating" IS NULL OR "price_rating" BETWEEN 1 AND 5)),
  ADD CONSTRAINT "reviews_not_self_chk" CHECK ("author_id" <> "target_id"),
  ADD CONSTRAINT "reviews_hidden_moderated_chk"
    CHECK ("status" <> 'HIDDEN' OR "moderated_at" IS NOT NULL);

-- Disputes: a resolved dispute says when.
ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_resolved_at_chk"
    CHECK ("status" IN ('OPEN', 'AWAITING_EVIDENCE', 'UNDER_REVIEW') OR "resolved_at" IS NOT NULL);

-- Sanctions end after they start.
ALTER TABLE "disciplinary_actions"
  ADD CONSTRAINT "disciplinary_actions_window_chk"
    CHECK ("ends_at" IS NULL OR "ends_at" > "starts_at");

ALTER TABLE "push_deliveries"
  ADD CONSTRAINT "push_deliveries_attempts_chk" CHECK ("attempt_count" >= 0);
