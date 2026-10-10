CREATE TYPE "WorkflowRunStatus" AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped',
  'cancelled'
);

CREATE TYPE "WorkflowRunTrigger" AS ENUM (
  'manual',
  'scheduled',
  'graphql',
  'user',
  'system'
);

CREATE TABLE "workflow_run" (
  "id" TEXT NOT NULL,
  "runtime_run_id" TEXT,
  "workflow_key" TEXT NOT NULL,
  "workflow_name" TEXT,
  "trigger" "WorkflowRunTrigger" NOT NULL,
  "actor_id" TEXT,
  "subject_type" TEXT,
  "subject_id" TEXT,
  "status" "WorkflowRunStatus" NOT NULL DEFAULT 'queued',
  "summary" TEXT,
  "error" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "details" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "core_sync_run" (
  "id" TEXT NOT NULL,
  "workflow_run_id" TEXT NOT NULL,
  "skipped_lock" BOOLEAN NOT NULL DEFAULT false,
  "incremental" BOOLEAN NOT NULL,
  "created_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "deleted_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "phase_summary" JSONB NOT NULL DEFAULT '[]',
  "coverage_audit" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "core_sync_run_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_run_runtime_run_id_key"
  ON "workflow_run"("runtime_run_id");
CREATE INDEX "workflow_run_workflow_key_created_at_idx"
  ON "workflow_run"("workflow_key", "created_at");
CREATE INDEX "workflow_run_status_created_at_idx"
  ON "workflow_run"("status", "created_at");
CREATE INDEX "workflow_run_trigger_created_at_idx"
  ON "workflow_run"("trigger", "created_at");

CREATE UNIQUE INDEX "core_sync_run_workflow_run_id_key"
  ON "core_sync_run"("workflow_run_id");

ALTER TABLE "core_sync_run"
  ADD CONSTRAINT "core_sync_run_workflow_run_id_fkey"
  FOREIGN KEY ("workflow_run_id") REFERENCES "workflow_run"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
