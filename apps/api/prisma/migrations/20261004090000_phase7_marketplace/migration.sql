-- Faz 7: marketplace (docs/adr/0028-0031).
--
-- Additive only (docs/adr/0021): new enums, tables and nullable/defaulted
-- columns. No existing column is dropped, renamed or retyped, and no row of
-- payments, refunds, ledger, earnings, payouts, jobs, reviews,
-- verifications, sessions or audit logs is changed. The only backfill
-- touches the new notifications.category column. District/province
-- coordinates are reference data and are filled by the idempotent
-- reference seed, not here.

-- CreateEnum
CREATE TYPE "ProviderRegionKind" AS ENUM ('PROVINCE', 'RADIUS');

-- CreateEnum
CREATE TYPE "RequestPhotoPolicy" AS ENUM ('OPTIONAL', 'RECOMMENDED', 'REQUIRED');

-- CreateEnum
CREATE TYPE "CategoryQuestionType" AS ENUM ('SINGLE_SELECT', 'MULTI_SELECT', 'BOOLEAN', 'SHORT_TEXT', 'NUMBER');

-- CreateEnum
CREATE TYPE "DispatchNotifyMode" AS ENUM ('PUSH', 'IN_APP', 'NONE');

-- CreateEnum
CREATE TYPE "DispatchResult" AS ENUM ('PENDING', 'QUOTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QuoteEta" AS ENUM ('MIN_30', 'HOUR_1', 'HOUR_2', 'TODAY', 'TOMORROW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "NewJobAlertMode" AS ENUM ('ON', 'SILENT', 'OFF');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('CUSTOMER', 'PROVIDER');

-- CreateEnum
CREATE TYPE "MessageReportReason" AS ENUM ('SPAM', 'HARASSMENT', 'FRAUD', 'CONTACT_INFO', 'INAPPROPRIATE', 'OTHER');

-- CreateEnum
CREATE TYPE "MessageReportStatus" AS ENUM ('OPEN', 'REVIEWED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "MarketplaceEventType" AS ENUM ('request_created', 'request_dispatched', 'provider_viewed_request', 'quote_created', 'quote_accepted', 'job_started', 'job_completed', 'conversation_started', 'message_sent', 'provider_favorited', 'provider_rehired', 'search_performed', 'search_no_result', 'search_category_clicked', 'request_no_offer', 'request_search_expanded');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UploadPurpose" ADD VALUE 'PORTFOLIO_IMAGE';
ALTER TYPE "UploadPurpose" ADD VALUE 'CHAT_IMAGE';
ALTER TYPE "UploadPurpose" ADD VALUE 'PROFILE_PHOTO';

-- AlterTable
ALTER TABLE "districts" ADD COLUMN     "coordinate_source" VARCHAR(24),
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6);

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "new_job_alerts" "NewJobAlertMode" NOT NULL DEFAULT 'ON',
ADD COLUMN     "new_message_push" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quiet_hours_end" SMALLINT,
ADD COLUMN     "quiet_hours_start" SMALLINT;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "category" VARCHAR(16);

-- AlterTable
ALTER TABLE "provider_profiles" ADD COLUMN     "accepting_new_jobs" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_active_at" TIMESTAMPTZ(3),
ADD COLUMN     "max_travel_km" SMALLINT,
ADD COLUMN     "photo_storage_key" VARCHAR(512),
ADD COLUMN     "service_center_district_id" UUID,
ADD COLUMN     "unavailable_until" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "provinces" ADD COLUMN     "country_code" CHAR(2) NOT NULL DEFAULT 'TR',
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "waitlist_open" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "quote_revisions" ADD COLUMN     "arrival_eta" "QuoteEta",
ADD COLUMN     "other_minor" BIGINT,
ADD COLUMN     "service_minor" BIGINT;

-- AlterTable
ALTER TABLE "service_categories" ADD COLUMN     "request_photo_policy" "RequestPhotoPolicy" NOT NULL DEFAULT 'OPTIONAL';

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "answers" JSONB,
ADD COLUMN     "approx_latitude" DECIMAL(8,4),
ADD COLUMN     "approx_longitude" DECIMAL(8,4),
ADD COLUMN     "budget_max_minor" BIGINT,
ADD COLUMN     "dispatch_wave" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "last_dispatched_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_dispatch_at" TIMESTAMPTZ(3),
ADD COLUMN     "no_offer_alerted_at" TIMESTAMPTZ(3),
ADD COLUMN     "preferred_only" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "preferred_provider_id" UUID,
ADD COLUMN     "rehire_of_job_id" UUID,
ADD COLUMN     "schedule_option" VARCHAR(10);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- Türkiye is the first (and for now only) active country. Inserted before
-- the provinces foreign key below so existing provinces stay valid.
INSERT INTO "countries" ("code", "name", "is_active", "updated_at")
VALUES ('TR', 'Türkiye', true, CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "provider_service_regions" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "kind" "ProviderRegionKind" NOT NULL,
    "province_id" SMALLINT NOT NULL,
    "center_district_id" UUID,
    "radius_km" SMALLINT,
    "center_lat" DECIMAL(9,6),
    "center_lng" DECIMAL(9,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "provider_service_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_weekly_hours" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_weekly_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_time_off" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "note" VARCHAR(200),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_portfolio_items" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "category_id" UUID,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "consent_confirmed_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "provider_portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_media" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "upload_intent_id" UUID NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "kind" VARCHAR(10) NOT NULL DEFAULT 'IMAGE',
    "mime_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_providers" (
    "customer_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_providers_pkey" PRIMARY KEY ("customer_id","provider_id")
);

-- CreateTable
CREATE TABLE "category_aliases" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "alias" VARCHAR(80) NOT NULL,
    "normalized" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_questions" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "help_text" VARCHAR(300),
    "type" "CategoryQuestionType" NOT NULL,
    "options" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_value" INTEGER,
    "max_value" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_dispatches" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "wave" SMALLINT NOT NULL,
    "algorithm_version" VARCHAR(20) NOT NULL,
    "match_score" DECIMAL(5,2) NOT NULL,
    "score_breakdown" JSONB NOT NULL,
    "distance_km" DECIMAL(6,1),
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "notify_mode" "DispatchNotifyMode" NOT NULL,
    "dispatched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewed_at" TIMESTAMPTZ(3),
    "responded_at" TIMESTAMPTZ(3),
    "result" "DispatchResult" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "request_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_review_replies" (
    "review_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_review_replies_pkey" PRIMARY KEY ("review_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "service_request_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "job_id" UUID,
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "last_read_at" TIMESTAMPTZ(3),
    "hidden_at" TIMESTAMPTZ(3),
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID,
    "type" "MessageType" NOT NULL,
    "body" VARCHAR(2000),
    "client_message_id" UUID,
    "event_key" VARCHAR(120),
    "upload_intent_id" UUID,
    "storage_key" VARCHAR(512),
    "mime_type" VARCHAR(100),
    "size_bytes" INTEGER,
    "contains_contact_info" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_reports" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "reason" "MessageReportReason" NOT NULL,
    "note" VARCHAR(500),
    "status" "MessageReportStatus" NOT NULL DEFAULT 'OPEN',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "resolution_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_blocks" (
    "blocker_id" UUID NOT NULL,
    "blocked_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_blocks_pkey" PRIMARY KEY ("blocker_id","blocked_id")
);

-- CreateTable
CREATE TABLE "marketplace_events" (
    "id" UUID NOT NULL,
    "type" "MarketplaceEventType" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "service_request_id" UUID,
    "provider_id" UUID,
    "category_id" UUID,
    "province_id" SMALLINT,
    "district_id" UUID,
    "value" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "marketplace_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_service_regions_provider_id_active_idx" ON "provider_service_regions"("provider_id", "active");

-- CreateIndex
CREATE INDEX "provider_service_regions_province_id_kind_active_idx" ON "provider_service_regions"("province_id", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_weekly_hours_provider_id_weekday_start_minute_key" ON "provider_weekly_hours"("provider_id", "weekday", "start_minute");

-- CreateIndex
CREATE INDEX "provider_time_off_provider_id_ends_at_idx" ON "provider_time_off"("provider_id", "ends_at");

-- CreateIndex
CREATE INDEX "provider_portfolio_items_provider_id_deleted_at_sort_order_idx" ON "provider_portfolio_items"("provider_id", "deleted_at", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_media_upload_intent_id_key" ON "portfolio_media"("upload_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_media_storage_key_key" ON "portfolio_media"("storage_key");

-- CreateIndex
CREATE INDEX "portfolio_media_item_id_sort_order_idx" ON "portfolio_media"("item_id", "sort_order");

-- CreateIndex
CREATE INDEX "favorite_providers_customer_id_created_at_idx" ON "favorite_providers"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "category_aliases_normalized_key" ON "category_aliases"("normalized");

-- CreateIndex
CREATE INDEX "category_aliases_category_id_idx" ON "category_aliases"("category_id");

-- CreateIndex
CREATE INDEX "category_questions_category_id_is_active_sort_order_idx" ON "category_questions"("category_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "category_questions_category_id_key_key" ON "category_questions"("category_id", "key");

-- CreateIndex
CREATE INDEX "request_dispatches_service_request_id_wave_idx" ON "request_dispatches"("service_request_id", "wave");

-- CreateIndex
CREATE INDEX "request_dispatches_provider_id_dispatched_at_idx" ON "request_dispatches"("provider_id", "dispatched_at");

-- CreateIndex
CREATE UNIQUE INDEX "request_dispatches_service_request_id_provider_id_key" ON "request_dispatches"("service_request_id", "provider_id");

-- CreateIndex
CREATE INDEX "conversations_job_id_idx" ON "conversations"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_service_request_id_provider_id_key" ON "conversations"("service_request_id", "provider_id");

-- CreateIndex
CREATE INDEX "conversation_participants_user_id_idx" ON "conversation_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_upload_intent_id_key" ON "messages"("upload_intent_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_sender_id_client_message_id_key" ON "messages"("conversation_id", "sender_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_event_key_key" ON "messages"("conversation_id", "event_key");

-- CreateIndex
CREATE INDEX "message_reports_status_created_at_idx" ON "message_reports"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "message_reports_message_id_reporter_id_key" ON "message_reports"("message_id", "reporter_id");

-- CreateIndex
CREATE INDEX "marketplace_events_type_occurred_at_idx" ON "marketplace_events"("type", "occurred_at");

-- CreateIndex
CREATE INDEX "marketplace_events_service_request_id_occurred_at_idx" ON "marketplace_events"("service_request_id", "occurred_at");

-- CreateIndex
CREATE INDEX "marketplace_events_province_id_type_occurred_at_idx" ON "marketplace_events"("province_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "marketplace_events_category_id_type_occurred_at_idx" ON "marketplace_events"("category_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_category_created_at_idx" ON "notifications"("user_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "provinces_country_code_idx" ON "provinces"("country_code");

-- CreateIndex
CREATE INDEX "service_requests_next_dispatch_at_idx" ON "service_requests"("next_dispatch_at");

-- CreateIndex
CREATE INDEX "service_requests_preferred_provider_id_idx" ON "service_requests"("preferred_provider_id");

-- AddForeignKey
ALTER TABLE "provinces" ADD CONSTRAINT "provinces_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_service_center_district_id_fkey" FOREIGN KEY ("service_center_district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_regions" ADD CONSTRAINT "provider_service_regions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_regions" ADD CONSTRAINT "provider_service_regions_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_service_regions" ADD CONSTRAINT "provider_service_regions_center_district_id_fkey" FOREIGN KEY ("center_district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_weekly_hours" ADD CONSTRAINT "provider_weekly_hours_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_time_off" ADD CONSTRAINT "provider_time_off_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_portfolio_items" ADD CONSTRAINT "provider_portfolio_items_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_portfolio_items" ADD CONSTRAINT "provider_portfolio_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_media" ADD CONSTRAINT "portfolio_media_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "provider_portfolio_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_media" ADD CONSTRAINT "portfolio_media_upload_intent_id_fkey" FOREIGN KEY ("upload_intent_id") REFERENCES "upload_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_providers" ADD CONSTRAINT "favorite_providers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_providers" ADD CONSTRAINT "favorite_providers_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_aliases" ADD CONSTRAINT "category_aliases_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_questions" ADD CONSTRAINT "category_questions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_preferred_provider_id_fkey" FOREIGN KEY ("preferred_provider_id") REFERENCES "provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_rehire_of_job_id_fkey" FOREIGN KEY ("rehire_of_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_dispatches" ADD CONSTRAINT "request_dispatches_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_dispatches" ADD CONSTRAINT "request_dispatches_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_review_replies" ADD CONSTRAINT "provider_review_replies_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_review_replies" ADD CONSTRAINT "provider_review_replies_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_upload_intent_id_fkey" FOREIGN KEY ("upload_intent_id") REFERENCES "upload_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_reports" ADD CONSTRAINT "message_reports_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_fkey" FOREIGN KEY ("blocker_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_fkey" FOREIGN KEY ("blocked_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_events" ADD CONSTRAINT "marketplace_events_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_events" ADD CONSTRAINT "marketplace_events_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_events" ADD CONSTRAINT "marketplace_events_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_events" ADD CONSTRAINT "marketplace_events_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- ============================================================================
-- Invariants the application also enforces (defence in depth)
-- ============================================================================

ALTER TABLE "countries"
  ADD CONSTRAINT "countries_code_chk" CHECK ("code" ~ '^[A-Z]{2}$');

ALTER TABLE "provider_weekly_hours"
  ADD CONSTRAINT "provider_weekly_hours_weekday_chk" CHECK ("weekday" BETWEEN 1 AND 7),
  ADD CONSTRAINT "provider_weekly_hours_interval_chk"
    CHECK ("start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440);

ALTER TABLE "provider_time_off"
  ADD CONSTRAINT "provider_time_off_interval_chk" CHECK ("starts_at" < "ends_at");

ALTER TABLE "provider_service_regions"
  ADD CONSTRAINT "provider_service_regions_shape_chk" CHECK (
    ("kind" = 'PROVINCE' AND "center_district_id" IS NULL AND "radius_km" IS NULL)
    OR ("kind" = 'RADIUS' AND "center_district_id" IS NOT NULL AND "radius_km" BETWEEN 1 AND 200
        AND "center_lat" IS NOT NULL AND "center_lng" IS NOT NULL));

-- One live PROVINCE region per provider and province.
CREATE UNIQUE INDEX "provider_service_regions_one_province_key"
  ON "provider_service_regions" ("provider_id", "province_id")
  WHERE "kind" = 'PROVINCE' AND "active";

ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_max_travel_chk"
    CHECK ("max_travel_km" IS NULL OR "max_travel_km" BETWEEN 1 AND 500);

ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "notification_preferences_quiet_hours_chk" CHECK (
    ("quiet_hours_start" IS NULL AND "quiet_hours_end" IS NULL)
    OR ("quiet_hours_start" BETWEEN 0 AND 1439 AND "quiet_hours_end" BETWEEN 0 AND 1439
        AND "quiet_hours_start" <> "quiet_hours_end"));

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_budget_range_chk" CHECK (
    "budget_max_minor" IS NULL
    OR ("budget_minor" IS NOT NULL AND "budget_max_minor" >= "budget_minor")),
  ADD CONSTRAINT "service_requests_schedule_option_chk" CHECK (
    "schedule_option" IS NULL OR "schedule_option" IN ('NOW', 'TODAY', 'TOMORROW', 'DATE')),
  ADD CONSTRAINT "service_requests_dispatch_wave_chk" CHECK ("dispatch_wave" >= 0),
  ADD CONSTRAINT "service_requests_preferred_only_chk"
    CHECK (NOT "preferred_only" OR "preferred_provider_id" IS NOT NULL);

ALTER TABLE "request_dispatches"
  ADD CONSTRAINT "request_dispatches_wave_chk" CHECK ("wave" >= 1),
  ADD CONSTRAINT "request_dispatches_score_chk" CHECK ("match_score" BETWEEN 0 AND 100);

ALTER TABLE "quote_revisions"
  ADD CONSTRAINT "quote_revisions_breakdown_lines_chk" CHECK (
    ("service_minor" IS NULL OR "service_minor" >= 0)
    AND ("other_minor" IS NULL OR "other_minor" >= 0));

ALTER TABLE "category_questions"
  ADD CONSTRAINT "category_questions_options_chk" CHECK (
    "type" NOT IN ('SINGLE_SELECT', 'MULTI_SELECT')
    OR (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") >= 2)),
  ADD CONSTRAINT "category_questions_range_chk"
    CHECK ("min_value" IS NULL OR "max_value" IS NULL OR "min_value" <= "max_value"),
  ADD CONSTRAINT "category_questions_key_chk" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');

ALTER TABLE "category_aliases"
  ADD CONSTRAINT "category_aliases_normalized_chk" CHECK (length(trim("normalized")) > 0);

ALTER TABLE "portfolio_media"
  ADD CONSTRAINT "portfolio_media_kind_chk" CHECK ("kind" IN ('IMAGE', 'VIDEO')),
  ADD CONSTRAINT "portfolio_media_size_chk" CHECK ("size_bytes" > 0);

ALTER TABLE "provider_review_replies"
  ADD CONSTRAINT "provider_review_replies_body_chk" CHECK (length(trim("body")) > 0);

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_shape_chk" CHECK (
    ("type" = 'TEXT' AND "sender_id" IS NOT NULL AND "body" IS NOT NULL
       AND length(trim("body")) > 0 AND "event_key" IS NULL)
    OR ("type" = 'IMAGE' AND "sender_id" IS NOT NULL AND "storage_key" IS NOT NULL
       AND "event_key" IS NULL)
    OR ("type" = 'SYSTEM' AND "sender_id" IS NULL AND "event_key" IS NOT NULL
       AND "body" IS NOT NULL));

ALTER TABLE "user_blocks"
  ADD CONSTRAINT "user_blocks_not_self_chk" CHECK ("blocker_id" <> "blocked_id");

-- ============================================================================
-- Backfill: notification centre tab for existing rows (new column only)
-- ============================================================================

UPDATE "notifications" SET "category" = CASE
  WHEN "type" LIKE 'message.%' THEN 'MESSAGES'
  WHEN "type" LIKE 'payment.%' OR "type" LIKE 'cash.%' OR "type" LIKE 'earning.%'
    OR "type" LIKE 'payout.%' THEN 'FINANCE'
  WHEN "type" LIKE 'provider.%' OR "type" LIKE 'auth.%' OR "type" LIKE 'account.%' THEN 'ACCOUNT'
  ELSE 'JOBS'
END
WHERE "category" IS NULL;
