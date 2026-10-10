CREATE TABLE "workflow_worker_heartbeat" (
  "worker_id" TEXT NOT NULL,
  "service" TEXT NOT NULL DEFAULT 'admin',
  "status" TEXT NOT NULL DEFAULT 'online',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "current_job" TEXT,
  "current_run_id" TEXT,
  "details" JSONB NOT NULL DEFAULT '{}',

  CONSTRAINT "workflow_worker_heartbeat_pkey" PRIMARY KEY ("worker_id")
);

CREATE INDEX "workflow_worker_heartbeat_last_seen_at_idx"
  ON "workflow_worker_heartbeat"("last_seen_at");

