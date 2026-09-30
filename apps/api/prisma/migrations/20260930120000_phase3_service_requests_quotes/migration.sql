-- AlterEnum
ALTER TYPE "UploadPurpose" ADD VALUE 'SERVICE_REQUEST_PHOTO';

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "cancel_reason" VARCHAR(500),
ADD COLUMN     "idempotency_key" UUID;

-- CreateTable
CREATE TABLE "service_request_photos" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "upload_intent_id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_request_photos_upload_intent_id_key" ON "service_request_photos"("upload_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_request_photos_storage_key_key" ON "service_request_photos"("storage_key");

-- CreateIndex
CREATE INDEX "service_request_photos_service_request_id_sort_order_idx" ON "service_request_photos"("service_request_id", "sort_order");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "quotes_service_request_id_status_idx" ON "quotes"("service_request_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_one_accepted_per_request_key" ON "quotes"("service_request_id") WHERE (status = 'ACCEPTED');

-- CreateIndex
CREATE INDEX "service_requests_district_id_category_id_status_idx" ON "service_requests"("district_id", "category_id", "status");

-- CreateIndex
CREATE INDEX "service_requests_created_at_idx" ON "service_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_requests_customer_id_idempotency_key_key" ON "service_requests"("customer_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "service_request_photos" ADD CONSTRAINT "service_request_photos_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_photos" ADD CONSTRAINT "service_request_photos_upload_intent_id_fkey" FOREIGN KEY ("upload_intent_id") REFERENCES "upload_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written checks (docs/adr/0006: money is positive minor units;
-- docs/adr/0014: request, quote and job invariants). Existing rows: no
-- service request, quote or job has been written by the API before this
-- phase, so none of these can fail on existing data.
-- ---------------------------------------------------------------------------

-- The customer's budget is optional but, when given, a positive amount.
ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_budget_positive_chk"
    CHECK ("budget_minor" IS NULL OR "budget_minor" > 0),
  ADD CONSTRAINT "service_requests_preferred_window_chk"
    CHECK ("preferred_start_at" IS NULL OR "preferred_end_at" IS NULL
           OR "preferred_end_at" >= "preferred_start_at"),
  ADD CONSTRAINT "service_requests_published_at_chk"
    CHECK ("status" = 'DRAFT' OR "published_at" IS NOT NULL),
  ADD CONSTRAINT "service_requests_cancelled_at_chk"
    CHECK ("status" <> 'CANCELLED' OR "cancelled_at" IS NOT NULL);

ALTER TABLE "service_request_photos"
  ADD CONSTRAINT "service_request_photos_size_positive_chk" CHECK ("size_bytes" > 0);

-- Every price in a negotiation is a positive total; parts are never negative.
ALTER TABLE "quote_revisions"
  ADD CONSTRAINT "quote_revisions_total_positive_chk" CHECK ("total_minor" > 0),
  ADD CONSTRAINT "quote_revisions_labor_non_negative_chk"
    CHECK ("labor_minor" IS NULL OR "labor_minor" >= 0),
  ADD CONSTRAINT "quote_revisions_material_non_negative_chk"
    CHECK ("material_minor" IS NULL OR "material_minor" >= 0),
  ADD CONSTRAINT "quote_revisions_revision_no_positive_chk" CHECK ("revision_no" >= 1);

-- An accepted quote always points at the revision that was accepted.
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_accepted_revision_chk"
    CHECK (("status" = 'ACCEPTED') = ("accepted_revision_id" IS NOT NULL AND "accepted_at" IS NOT NULL));

-- AGREED_PRICE is a positive amount; the running total never goes below 0.
ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_agreed_price_positive_chk" CHECK ("agreed_price_minor" > 0),
  ADD CONSTRAINT "jobs_current_total_non_negative_chk" CHECK ("current_total_minor" >= 0);
