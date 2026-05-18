-- Partner API key store for `/api/search` + `Query.search`.
--
-- See:
-- - docs/plans/2026-05-18-001-feat-partner-api-key-store-plan.md
-- - apps/admin/CLAUDE.md §"Partner API key store"
--
-- Forward-only additive migration. No data backfill — today's `xoSP…` key
-- in `SEARCH_API_KEYS` is migrated post-deploy via:
--   `pnpm --filter @forge/admin partner-keys import-from-env ...`
-- The env-CSV validator branch stays through PR1 so the partner is never
-- without a working auth path during the cutover.

CREATE TABLE "partner_api_key" (
  "id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "key_hash" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "owner_email" TEXT NOT NULL,
  "note" TEXT,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_by_id" TEXT,
  "revoked_by_id" TEXT,

  CONSTRAINT "partner_api_key_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_api_key_key_id_key"
  ON "partner_api_key"("key_id");

CREATE UNIQUE INDEX "partner_api_key_key_hash_key"
  ON "partner_api_key"("key_hash");

CREATE INDEX "partner_api_key_revoked_at_idx"
  ON "partner_api_key"("revoked_at");

CREATE INDEX "partner_api_key_last_used_at_idx"
  ON "partner_api_key"("last_used_at");

CREATE INDEX "partner_api_key_created_by_id_idx"
  ON "partner_api_key"("created_by_id");

CREATE INDEX "partner_api_key_revoked_by_id_idx"
  ON "partner_api_key"("revoked_by_id");

ALTER TABLE "partner_api_key"
  ADD CONSTRAINT "partner_api_key_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "partner_api_key"
  ADD CONSTRAINT "partner_api_key_revoked_by_id_fkey"
  FOREIGN KEY ("revoked_by_id") REFERENCES "user"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
