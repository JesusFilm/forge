-- Durable Admin-owned SEO experiment ledger. This migration is additive and
-- intentionally creates no schedules or provider credentials; automation stays
-- OFF until an operator changes the persisted singleton mode.

CREATE TYPE "SeoAutomationMode" AS ENUM ('off', 'dry_run', 'live');
CREATE TYPE "SeoRunStatus" AS ENUM ('running', 'completed', 'partial', 'failed');
CREATE TYPE "SeoEvidenceProvider" AS ENUM ('gsc', 'ga4', 'firecrawl', 'direct_page', 'grounded_search');
CREATE TYPE "SeoProposalLane" AS ENUM ('editorial', 'engineering', 'rollback');
CREATE TYPE "SeoProposalStatus" AS ENUM ('proposed', 'approved', 'rejected', 'expired', 'stale', 'materialized');
CREATE TYPE "SeoDecisionAction" AS ENUM ('approve', 'reject', 'review_lesson', 'reconcile_ticket');
CREATE TYPE "SeoMaterializationStatus" AS ENUM ('draft_created', 'ticket_pending', 'ticket_created', 'manual_reconcile', 'stale');
CREATE TYPE "SeoExperimentStatus" AS ENUM ('awaiting_activation', 'measuring', 'beneficial', 'neutral', 'harmful', 'inconclusive', 'rollback_proposed');
CREATE TYPE "SeoEvaluationKind" AS ENUM ('activation', 'interim', 'final');
CREATE TYPE "SeoTicketOutboxStatus" AS ENUM ('pending', 'claimed', 'created', 'retryable', 'manual_reconcile', 'failed');
CREATE TYPE "SeoLessonStatus" AS ENUM ('pending_review', 'active', 'superseded', 'retired');

CREATE TABLE "seo_automation_state" (
  "key" TEXT NOT NULL DEFAULT 'global',
  "mode" "SeoAutomationMode" NOT NULL DEFAULT 'off',
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_automation_state_pkey" PRIMARY KEY ("key")
);

INSERT INTO "seo_automation_state" ("key", "mode", "updated_at")
VALUES ('global', 'off', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE "seo_run" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "mode" "SeoAutomationMode" NOT NULL,
  "status" "SeoRunStatus" NOT NULL DEFAULT 'running',
  "window_start" TIMESTAMP(3),
  "window_end" TIMESTAMP(3),
  "provider_coverage" JSONB NOT NULL DEFAULT '{}',
  "report" JSONB NOT NULL DEFAULT '{}',
  "eligible_count" INTEGER NOT NULL DEFAULT 0,
  "selected_count" INTEGER NOT NULL DEFAULT 0,
  "would_propose_count" INTEGER NOT NULL DEFAULT 0,
  "proposed_count" INTEGER NOT NULL DEFAULT 0,
  "materialization_count" INTEGER NOT NULL DEFAULT 0,
  "ticket_count" INTEGER NOT NULL DEFAULT 0,
  "experiment_count" INTEGER NOT NULL DEFAULT 0,
  "suppressed_operations" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_evidence_observation" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "observation_key" TEXT NOT NULL,
  "provider" "SeoEvidenceProvider" NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "scope" JSONB NOT NULL DEFAULT '{}',
  "payload" JSONB NOT NULL,
  "citations" JSONB NOT NULL DEFAULT '[]',
  "quality" JSONB NOT NULL DEFAULT '{}',
  "payload_digest" TEXT NOT NULL,
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_evidence_observation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_proposal" (
  "id" TEXT NOT NULL,
  "semantic_conflict_key" TEXT NOT NULL,
  "lane" "SeoProposalLane" NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "canonical_url" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "current_version" INTEGER NOT NULL DEFAULT 1,
  "status" "SeoProposalStatus" NOT NULL DEFAULT 'proposed',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_proposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_proposal_version" (
  "id" TEXT NOT NULL,
  "proposal_id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "payload_digest" TEXT NOT NULL,
  "canonical_identity_digest" TEXT NOT NULL,
  "base_content_hash" TEXT,
  "intent" TEXT NOT NULL,
  "expected_outcome" TEXT NOT NULL,
  "risk" TEXT NOT NULL,
  "verification_plan" TEXT NOT NULL,
  "rollback_plan" TEXT NOT NULL,
  "editorial_diff" JSONB,
  "engineering_brief" JSONB,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "caveats" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "affected_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "payload" JSONB NOT NULL,
  "pre_change_snapshot" JSONB NOT NULL,
  "treatment_snapshot" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_proposal_version_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_approval_nonce" (
  "id" TEXT NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "action" "SeoDecisionAction" NOT NULL,
  "proposal_version_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_approval_nonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_workload_assertion" (
  "id" TEXT NOT NULL,
  "jti_hash" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "request_digest" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_workload_assertion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_decision" (
  "id" TEXT NOT NULL,
  "proposal_version_id" TEXT NOT NULL,
  "action" "SeoDecisionAction" NOT NULL,
  "actor_id" TEXT NOT NULL,
  "overlap_acknowledged" BOOLEAN NOT NULL DEFAULT false,
  "overlap_count" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT,
  "confounders" JSONB NOT NULL DEFAULT '[]',
  "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_decision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_proposal_materialization" (
  "id" TEXT NOT NULL,
  "proposal_version_id" TEXT NOT NULL,
  "status" "SeoMaterializationStatus" NOT NULL,
  "content_revision_id" TEXT,
  "editor_path" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_proposal_materialization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_experiment" (
  "id" TEXT NOT NULL,
  "proposal_version_id" TEXT NOT NULL,
  "status" "SeoExperimentStatus" NOT NULL DEFAULT 'awaiting_activation',
  "pre_change_snapshot" JSONB NOT NULL,
  "treatment_snapshot" JSONB NOT NULL,
  "pre_change_hash" TEXT NOT NULL,
  "treatment_hash" TEXT NOT NULL,
  "observed_activation_hash" TEXT,
  "activated_at" TIMESTAMP(3),
  "measurement_starts_at" TIMESTAMP(3),
  "interim_due_at" TIMESTAMP(3),
  "final_due_at" TIMESTAMP(3),
  "evaluation_fence_generation" INTEGER NOT NULL DEFAULT 0,
  "evaluation_claim_token_hash" TEXT,
  "evaluation_claim_expires_at" TIMESTAMP(3),
  "confounders" JSONB NOT NULL DEFAULT '[]',
  "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_experiment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_evaluation_event" (
  "id" TEXT NOT NULL,
  "experiment_id" TEXT NOT NULL,
  "kind" "SeoEvaluationKind" NOT NULL,
  "outcome" TEXT NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "evidence_digest" TEXT NOT NULL,
  "confounders" JSONB NOT NULL DEFAULT '[]',
  "observed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seo_evaluation_event_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_ticket_outbox" (
  "id" TEXT NOT NULL,
  "proposal_version_id" TEXT NOT NULL,
  "status" "SeoTicketOutboxStatus" NOT NULL DEFAULT 'pending',
  "payload_digest" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "marker" TEXT NOT NULL,
  "fence_generation" INTEGER NOT NULL DEFAULT 0,
  "lease_token_hash" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3),
  "remote_id" TEXT,
  "remote_url" TEXT,
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_ticket_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_ticket_outbox_attempt" (
  "id" TEXT NOT NULL,
  "outbox_id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "detail" JSONB NOT NULL DEFAULT '{}',
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_ticket_outbox_attempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seo_lesson" (
  "id" TEXT NOT NULL,
  "experiment_id" TEXT NOT NULL,
  "status" "SeoLessonStatus" NOT NULL DEFAULT 'pending_review',
  "content" TEXT NOT NULL,
  "evidence_digest" TEXT NOT NULL,
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "confounders" JSONB NOT NULL DEFAULT '[]',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "seo_lesson_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seo_run_idempotency_key_key" ON "seo_run"("idempotency_key");
CREATE INDEX "seo_run_status_started_at_idx" ON "seo_run"("status", "started_at");
CREATE INDEX "seo_run_mode_started_at_idx" ON "seo_run"("mode", "started_at");
CREATE UNIQUE INDEX "seo_evidence_observation_run_id_observation_key_key" ON "seo_evidence_observation"("run_id", "observation_key");
CREATE INDEX "seo_evidence_observation_provider_retrieved_at_idx" ON "seo_evidence_observation"("provider", "retrieved_at");
CREATE INDEX "seo_evidence_observation_expires_at_idx" ON "seo_evidence_observation"("expires_at");
CREATE INDEX "seo_proposal_status_expires_at_created_at_idx" ON "seo_proposal"("status", "expires_at", "created_at");
CREATE INDEX "seo_proposal_semantic_conflict_key_status_idx" ON "seo_proposal"("semantic_conflict_key", "status");
CREATE INDEX "seo_proposal_target_type_target_id_locale_idx" ON "seo_proposal"("target_type", "target_id", "locale");
CREATE UNIQUE INDEX "seo_proposal_version_idempotency_key_key" ON "seo_proposal_version"("idempotency_key");
CREATE UNIQUE INDEX "seo_proposal_version_proposal_id_version_key" ON "seo_proposal_version"("proposal_id", "version");
CREATE UNIQUE INDEX "seo_proposal_version_proposal_id_payload_digest_key" ON "seo_proposal_version"("proposal_id", "payload_digest");
CREATE INDEX "seo_proposal_version_run_id_created_at_idx" ON "seo_proposal_version"("run_id", "created_at");
CREATE UNIQUE INDEX "seo_approval_nonce_nonce_hash_key" ON "seo_approval_nonce"("nonce_hash");
CREATE INDEX "seo_approval_nonce_proposal_version_id_consumed_at_idx" ON "seo_approval_nonce"("proposal_version_id", "consumed_at");
CREATE INDEX "seo_approval_nonce_expires_at_idx" ON "seo_approval_nonce"("expires_at");
CREATE UNIQUE INDEX "seo_workload_assertion_jti_hash_key" ON "seo_workload_assertion"("jti_hash");
CREATE INDEX "seo_workload_assertion_capability_consumed_at_idx" ON "seo_workload_assertion"("capability", "consumed_at");
CREATE INDEX "seo_workload_assertion_expires_at_idx" ON "seo_workload_assertion"("expires_at");
CREATE UNIQUE INDEX "seo_decision_proposal_version_id_key" ON "seo_decision"("proposal_version_id");
CREATE INDEX "seo_decision_action_decided_at_idx" ON "seo_decision"("action", "decided_at");
CREATE UNIQUE INDEX "seo_proposal_materialization_proposal_version_id_key" ON "seo_proposal_materialization"("proposal_version_id");
CREATE UNIQUE INDEX "seo_proposal_materialization_content_revision_id_key" ON "seo_proposal_materialization"("content_revision_id");
CREATE INDEX "seo_proposal_materialization_status_updated_at_idx" ON "seo_proposal_materialization"("status", "updated_at");
CREATE UNIQUE INDEX "seo_experiment_proposal_version_id_key" ON "seo_experiment"("proposal_version_id");
CREATE INDEX "seo_experiment_status_interim_due_at_idx" ON "seo_experiment"("status", "interim_due_at");
CREATE INDEX "seo_experiment_status_final_due_at_idx" ON "seo_experiment"("status", "final_due_at");
CREATE INDEX "seo_experiment_status_evaluation_claim_expires_at_idx" ON "seo_experiment"("status", "evaluation_claim_expires_at");
CREATE INDEX "seo_evaluation_event_experiment_id_kind_observed_at_idx" ON "seo_evaluation_event"("experiment_id", "kind", "observed_at");
CREATE UNIQUE INDEX "seo_ticket_outbox_proposal_version_id_key" ON "seo_ticket_outbox"("proposal_version_id");
CREATE UNIQUE INDEX "seo_ticket_outbox_marker_key" ON "seo_ticket_outbox"("marker");
CREATE INDEX "seo_ticket_outbox_status_next_attempt_at_created_at_idx" ON "seo_ticket_outbox"("status", "next_attempt_at", "created_at");
CREATE INDEX "seo_ticket_outbox_lease_expires_at_idx" ON "seo_ticket_outbox"("lease_expires_at");
CREATE INDEX "seo_ticket_outbox_attempt_outbox_id_attempted_at_idx" ON "seo_ticket_outbox_attempt"("outbox_id", "attempted_at");
CREATE INDEX "seo_ticket_outbox_attempt_expires_at_idx" ON "seo_ticket_outbox_attempt"("expires_at");
CREATE UNIQUE INDEX "seo_lesson_experiment_id_key" ON "seo_lesson"("experiment_id");
CREATE INDEX "seo_lesson_status_created_at_idx" ON "seo_lesson"("status", "created_at");

ALTER TABLE "seo_evidence_observation" ADD CONSTRAINT "seo_evidence_observation_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "seo_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seo_proposal_version" ADD CONSTRAINT "seo_proposal_version_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "seo_proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_proposal_version" ADD CONSTRAINT "seo_proposal_version_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "seo_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_approval_nonce" ADD CONSTRAINT "seo_approval_nonce_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "seo_proposal_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_decision" ADD CONSTRAINT "seo_decision_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "seo_proposal_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_proposal_materialization" ADD CONSTRAINT "seo_proposal_materialization_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "seo_proposal_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_proposal_materialization" ADD CONSTRAINT "seo_proposal_materialization_content_revision_id_fkey" FOREIGN KEY ("content_revision_id") REFERENCES "content_revision"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "seo_experiment" ADD CONSTRAINT "seo_experiment_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "seo_proposal_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_evaluation_event" ADD CONSTRAINT "seo_evaluation_event_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "seo_experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_ticket_outbox" ADD CONSTRAINT "seo_ticket_outbox_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "seo_proposal_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seo_ticket_outbox_attempt" ADD CONSTRAINT "seo_ticket_outbox_attempt_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "seo_ticket_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seo_lesson" ADD CONSTRAINT "seo_lesson_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "seo_experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
