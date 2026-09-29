-- DropIndex
DROP INDEX "ledger_accounts_provider_id_type_currency_key";

-- AlterTable
ALTER TABLE "ledger_accounts" ADD COLUMN     "owner_key" VARCHAR(64) NOT NULL;

-- CreateIndex
CREATE INDEX "ledger_accounts_provider_id_idx" ON "ledger_accounts"("provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_owner_key_type_currency_key" ON "ledger_accounts"("owner_key", "type", "currency");

