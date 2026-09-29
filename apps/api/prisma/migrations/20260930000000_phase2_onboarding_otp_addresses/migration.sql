-- Phase 2: phone OTP, customer addresses, provider onboarding and review,
-- verification uploads (ADR-0009 .. ADR-0012).
--
-- Data safety: no column or row is dropped. Before the new partial unique
-- indexes and CHECK constraints, existing rows that would violate them are
-- brought into line (a no-op on databases created by Phase 1 seeds).

-- Pre-flight data fixes -------------------------------------------------------

-- Keep only the newest default address per user.
UPDATE "addresses" a SET "is_default" = false
WHERE a."is_default" AND a."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "addresses" b
    WHERE b."user_id" = a."user_id" AND b."is_default" AND b."deleted_at" IS NULL
      AND b."id" > a."id"
  );

-- Keep only the newest PENDING verification per provider and type.
UPDATE "provider_verifications" v SET "status" = 'EXPIRED'
WHERE v."status" = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM "provider_verifications" w
    WHERE w."provider_id" = v."provider_id" AND w."type" = v."type"
      AND w."status" = 'PENDING' AND w."id" > v."id"
  );

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTER_OR_LOGIN', 'VERIFY_PHONE');

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('PROVIDER_VERIFICATION');

-- DropIndex
DROP INDEX "addresses_user_id_idx";

-- DropIndex
DROP INDEX "provider_verifications_status_idx";

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "instructions" VARCHAR(500);

-- AlterTable
ALTER TABLE "provider_profiles" ADD COLUMN     "reviewed_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewed_by_id" UUID,
ADD COLUMN     "status_reason" VARCHAR(1000),
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "provider_verifications" ADD COLUMN     "mime_type" VARCHAR(100),
ADD COLUMN     "original_file_name" VARCHAR(255),
ADD COLUMN     "size_bytes" INTEGER,
ADD COLUMN     "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "user_id" UUID,
    "code_hash" CHAR(64) NOT NULL,
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "max_attempts" SMALLINT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "invalidated_at" TIMESTAMPTZ(3),
    "ip_address" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_intents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "storage_key" VARCHAR(512) NOT NULL,
    "declared_mime_type" VARCHAR(100) NOT NULL,
    "declared_size" INTEGER NOT NULL,
    "max_size_bytes" INTEGER NOT NULL,
    "original_file_name" VARCHAR(255),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_challenges_phone_purpose_created_at_idx" ON "otp_challenges"("phone", "purpose", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_expires_at_idx" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "otp_challenges_open_phone_purpose_key" ON "otp_challenges"("phone", "purpose") WHERE (consumed_at IS NULL AND invalidated_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "upload_intents_storage_key_key" ON "upload_intents"("storage_key");

-- CreateIndex
CREATE INDEX "upload_intents_user_id_created_at_idx" ON "upload_intents"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "addresses_user_id_deleted_at_idx" ON "addresses"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_one_default_per_user_key" ON "addresses"("user_id") WHERE (is_default AND deleted_at IS NULL);

-- CreateIndex
CREATE INDEX "provider_profiles_status_submitted_at_idx" ON "provider_profiles"("status", "submitted_at");

-- CreateIndex
CREATE INDEX "provider_verifications_status_submitted_at_idx" ON "provider_verifications"("status", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "provider_verifications_one_pending_key" ON "provider_verifications"("provider_id", "type") WHERE (status = 'PENDING');

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfills required by the CHECK constraints below --------------------------

UPDATE "provider_profiles" SET "status_reason" = 'Belirtilmedi (Faz 2 öncesi kayıt)'
WHERE "status" IN ('REJECTED', 'SUSPENDED') AND "status_reason" IS NULL;
UPDATE "provider_profiles" SET "approved_at" = "updated_at"
WHERE "status" = 'ACTIVE' AND "approved_at" IS NULL;
UPDATE "provider_profiles" SET "is_available_now" = false
WHERE "is_available_now" AND NOT ("now_enabled" AND "status" = 'ACTIVE');
UPDATE "provider_verifications" SET "reviewed_at" = "updated_at"
WHERE "status" IN ('APPROVED', 'REJECTED') AND "reviewed_at" IS NULL;
UPDATE "provider_verifications" SET "rejection_reason" = 'Belirtilmedi (Faz 2 öncesi kayıt)'
WHERE "status" = 'REJECTED' AND "rejection_reason" IS NULL;

-- CHECK constraints (not modelled by Prisma; they do not affect the diff) ----

ALTER TABLE "users" ADD CONSTRAINT "users_phone_e164_check"
  CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{6,14}$');

ALTER TABLE "addresses" ADD CONSTRAINT "addresses_coordinates_pair_check"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_latitude_range_check"
  CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90);
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_longitude_range_check"
  CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180);

ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_experience_range_check"
  CHECK ("years_of_experience" IS NULL OR "years_of_experience" BETWEEN 0 AND 70);
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_active_approved_check"
  CHECK ("status" <> 'ACTIVE' OR "approved_at" IS NOT NULL);
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_status_reason_check"
  CHECK ("status" NOT IN ('REJECTED', 'SUSPENDED') OR "status_reason" IS NOT NULL);
-- Only an ACTIVE provider who opted in to NOW can be dispatchable.
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_available_now_check"
  CHECK (NOT "is_available_now" OR ("now_enabled" AND "status" = 'ACTIVE'));

ALTER TABLE "provider_verifications" ADD CONSTRAINT "provider_verifications_reviewed_check"
  CHECK ("status" NOT IN ('APPROVED', 'REJECTED') OR "reviewed_at" IS NOT NULL);
ALTER TABLE "provider_verifications" ADD CONSTRAINT "provider_verifications_rejection_reason_check"
  CHECK ("status" <> 'REJECTED' OR "rejection_reason" IS NOT NULL);
ALTER TABLE "provider_verifications" ADD CONSTRAINT "provider_verifications_size_check"
  CHECK ("size_bytes" IS NULL OR "size_bytes" > 0);

ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_attempts_check"
  CHECK ("max_attempts" > 0 AND "attempts" BETWEEN 0 AND "max_attempts");

ALTER TABLE "upload_intents" ADD CONSTRAINT "upload_intents_size_check"
  CHECK ("declared_size" > 0 AND "declared_size" <= "max_size_bytes");
