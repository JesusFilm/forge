CREATE TABLE IF NOT EXISTS "language_fallback" (
  "id" TEXT NOT NULL,
  "source" "SourceTier" NOT NULL DEFAULT 'core',
  "source_language_id" TEXT NOT NULL,
  "fallback_language_id" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "reason" TEXT,
  "synced_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "language_fallback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "language_fallback_source_language_id_fallback_language_id_key"
  ON "language_fallback"("source_language_id", "fallback_language_id");

CREATE INDEX IF NOT EXISTS "language_fallback_source_language_id_priority_idx"
  ON "language_fallback"("source_language_id", "priority");

CREATE INDEX IF NOT EXISTS "language_fallback_fallback_language_id_idx"
  ON "language_fallback"("fallback_language_id");

CREATE INDEX IF NOT EXISTS "language_fallback_deleted_at_idx"
  ON "language_fallback"("deleted_at");

ALTER TABLE "language_fallback"
  ADD CONSTRAINT "language_fallback_source_language_id_fkey"
  FOREIGN KEY ("source_language_id") REFERENCES "language"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "language_fallback"
  ADD CONSTRAINT "language_fallback_fallback_language_id_fkey"
  FOREIGN KEY ("fallback_language_id") REFERENCES "language"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
