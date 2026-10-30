CREATE TABLE "core_sync_phase_execution" (
  "id" TEXT PRIMARY KEY,
  "sync_run_id" TEXT NOT NULL,
  "phase" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "claim_token" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "core_sync_phase_execution_state_check" CHECK ("state" IN ('PENDING','RUNNING','COMPLETE','FAILED'))
);
CREATE UNIQUE INDEX "core_sync_phase_execution_sync_run_id_phase_key" ON "core_sync_phase_execution"("sync_run_id", "phase");
CREATE INDEX "core_sync_phase_execution_state_created_at_idx" ON "core_sync_phase_execution"("state", "created_at");

CREATE TABLE "watch_catalog_publication" (
  "id" TEXT PRIMARY KEY,
  "requested_version" INTEGER NOT NULL DEFAULT 0,
  "search_version" INTEGER NOT NULL DEFAULT 0,
  "web_version" INTEGER NOT NULL DEFAULT 0,
  "base_generation_id" TEXT,
  "generation_id" VARCHAR(128),
  "ranking_revision" TEXT,
  "source_digest" TEXT,
  "last_requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_published_at" TIMESTAMP(3),
  "retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "watch_catalog_publication_generation_id_fkey" FOREIGN KEY ("generation_id") REFERENCES "watch_search_candidate_generation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "watch_catalog_publication_versions_check" CHECK ("requested_version" >= "search_version" AND "requested_version" >= "web_version")
);
