CREATE TABLE "manager_automation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "definition" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active','paused')),
  "next_run_at" TIMESTAMP(3), "last_run_at" TIMESTAMP(3), "last_run_status" TEXT,
  "lease_token" TEXT, "lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "manager_automation_status_next_run_at_idx" ON "manager_automation"("status","next_run_at");
CREATE TABLE "manager_automation_run" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "automation_id" TEXT NOT NULL REFERENCES "manager_automation"("id") ON DELETE CASCADE,
  "active_automation_id" TEXT UNIQUE,
  "idempotency_key" TEXT, "lease_token" TEXT NOT NULL,
  "dispatch_started_at" TIMESTAMP(3),
  "scheduled" BOOLEAN NOT NULL DEFAULT false,
  "run_mode" TEXT NOT NULL CHECK ("run_mode" IN ('live','dry_run')),
  "status" TEXT NOT NULL DEFAULT 'running' CHECK ("status" IN ('running','success','partial','failed','no_op')),
  "scheduled_for" TIMESTAMP(3) NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3), "result" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("automation_id","idempotency_key")
);
CREATE INDEX "manager_automation_run_automation_id_started_at_idx" ON "manager_automation_run"("automation_id","started_at");
-- Refuse ambiguous legacy duplicates without changing historical jobs.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM manager_enrichment_job
    WHERE status IN ('pending','running') AND artifacts #>> '{automation,data,automationKey}' IS NOT NULL
    GROUP BY artifacts #>> '{automation,data,automationKey}' HAVING COUNT(*) > 1
  ) THEN RAISE EXCEPTION 'Active automation job keys are duplicated; reconcile the jobs before applying migration 0164'; END IF;
END $$;
CREATE UNIQUE INDEX "manager_enrichment_job_running_automation_key_idx"
  ON "manager_enrichment_job" ((artifacts #>> '{automation,data,automationKey}'))
  WHERE status IN ('pending','running') AND artifacts #>> '{automation,data,automationKey}' IS NOT NULL;
