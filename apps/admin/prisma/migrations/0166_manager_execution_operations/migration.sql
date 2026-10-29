-- All admission, completion, and ManagerJobService.update paths serialize on the
-- parent manager_enrichment_job row in one transaction. Claims never expire.
CREATE TABLE "manager_execution_run" (
  "job_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "input_digest" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_execution_run_pkey" PRIMARY KEY ("job_id", "run_id"),
  CONSTRAINT "manager_execution_run_job_id_fkey" FOREIGN KEY ("job_id")
    REFERENCES "manager_enrichment_job"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "manager_execution_run_input_digest_check"
    CHECK ("input_digest" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "manager_execution_operation" (
  "job_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "operation_digest" TEXT NOT NULL,
  "claim_token" TEXT NOT NULL,
  "result" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "manager_execution_operation_pkey" PRIMARY KEY ("job_id", "run_id", "operation_id"),
  CONSTRAINT "manager_execution_operation_job_id_run_id_fkey" FOREIGN KEY ("job_id", "run_id")
    REFERENCES "manager_execution_run"("job_id", "run_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "manager_execution_operation_id_check" CHECK (
    "operation_id" IN (
      'run-admission', 'audio-cleanup', 'apply-transcript-corrections', 'mux-publication',
      'mastra:source', 'mastra:correction', 'mastra:translation', 'mastra:chapters',
      'mastra:metadata', 'mastra:embeddings', 'mastra:scene-analysis'
    )
  ),
  CONSTRAINT "manager_execution_operation_digest_check"
    CHECK ("operation_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "manager_execution_operation_result_check" CHECK (
    ("completed_at" IS NULL AND "result" IS NULL) OR
    ("completed_at" IS NOT NULL AND "result" IS NOT NULL)
  )
);
CREATE INDEX "manager_execution_operation_job_id_completed_at_idx"
  ON "manager_execution_operation"("job_id", "completed_at");
