ALTER TABLE "documents"
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "raw_documents"
  ADD COLUMN "index_attempted_at" TIMESTAMPTZ,
  ADD COLUMN "index_attempted_model" TEXT;

CREATE TABLE "language_change_audits" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "run_id" TEXT NOT NULL,
  "document_id" UUID NOT NULL,
  "source_key" TEXT NOT NULL,
  "old_language" TEXT,
  "new_language" TEXT,
  "detector_model" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "language_change_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "language_change_audits_run_document_uq"
  ON "language_change_audits"("run_id", "document_id");
CREATE INDEX "language_change_audits_run_idx"
  ON "language_change_audits"("run_id");
