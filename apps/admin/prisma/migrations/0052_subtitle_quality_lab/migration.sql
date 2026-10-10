-- Subtitle Quality Lab access boundary. This first slice is additive except
-- for extending the existing ManagerRole enum; it creates no reviewer account
-- and grants no language access by default.

ALTER TYPE "ManagerRole" ADD VALUE 'REVIEWER';

CREATE TYPE "SubtitleReviewRubricDimension" AS ENUM (
  'meaning_accuracy',
  'naturalness',
  'timing_readability',
  'scripture_theology'
);

CREATE TABLE "manager_reviewer_language_grant" (
  "id" TEXT NOT NULL,
  "manager_membership_id" TEXT NOT NULL,
  "language_id" TEXT NOT NULL,
  "target_proficiency_evidence" TEXT NOT NULL,
  "source_proficiency_evidence" TEXT,
  "permitted_rubric_dimensions" "SubtitleReviewRubricDimension"[] NOT NULL DEFAULT ARRAY[]::"SubtitleReviewRubricDimension"[],
  "scripture_specialist" BOOLEAN NOT NULL DEFAULT false,
  "theology_specialist" BOOLEAN NOT NULL DEFAULT false,
  "qualification_version" INTEGER NOT NULL DEFAULT 1,
  "granted_by_id" TEXT NOT NULL,
  "grant_reason" TEXT NOT NULL,
  "revoked_by_id" TEXT,
  "revocation_reason" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manager_reviewer_language_grant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "manager_access_audit_event" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "target_user_id" TEXT NOT NULL,
  "manager_membership_id" TEXT,
  "language_id" TEXT,
  "request_id" TEXT,
  "reason" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "manager_access_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manager_reviewer_language_grant_manager_membership_id_language_id_key"
  ON "manager_reviewer_language_grant"("manager_membership_id", "language_id");
CREATE INDEX "manager_reviewer_language_grant_language_id_revoked_at_idx"
  ON "manager_reviewer_language_grant"("language_id", "revoked_at");
CREATE INDEX "manager_reviewer_language_grant_manager_membership_id_revoked_at_idx"
  ON "manager_reviewer_language_grant"("manager_membership_id", "revoked_at");
CREATE INDEX "manager_access_audit_event_target_user_id_created_at_idx"
  ON "manager_access_audit_event"("target_user_id", "created_at");
CREATE INDEX "manager_access_audit_event_manager_membership_id_created_at_idx"
  ON "manager_access_audit_event"("manager_membership_id", "created_at");
CREATE INDEX "manager_access_audit_event_language_id_created_at_idx"
  ON "manager_access_audit_event"("language_id", "created_at");
CREATE INDEX "manager_access_audit_event_event_type_created_at_idx"
  ON "manager_access_audit_event"("event_type", "created_at");

ALTER TABLE "manager_reviewer_language_grant"
  ADD CONSTRAINT "manager_reviewer_language_grant_manager_membership_id_fkey"
  FOREIGN KEY ("manager_membership_id") REFERENCES "manager_membership"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "manager_reviewer_language_grant"
  ADD CONSTRAINT "manager_reviewer_language_grant_language_id_fkey"
  FOREIGN KEY ("language_id") REFERENCES "language"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "SubtitleEvalCorpusStatus" AS ENUM ('provisional', 'approved', 'superseded');
CREATE TYPE "SubtitleEvalSnapshotKind" AS ENUM ('source', 'reference');
CREATE TYPE "SubtitleEvalRunStatus" AS ENUM ('queued', 'running', 'completed', 'partial', 'failed');
CREATE TYPE "SubtitleEvalCellStatus" AS ENUM ('queued', 'running', 'completed', 'failed');
CREATE TYPE "SubtitleEvalArtifactKind" AS ENUM ('candidate_vtt', 'review_evidence', 'cell_report');
CREATE TYPE "SubtitleEvalProviderOperation" AS ENUM ('scripture_detection', 'translation', 'retiming', 'scripture_validation');
CREATE TYPE "SubtitleEvalProviderCallStatus" AS ENUM ('succeeded', 'failed', 'invalid_output');
CREATE TYPE "SubtitleEvalAssignmentKind" AS ENUM ('standard', 'specialist');
CREATE TYPE "SubtitleEvalAssignmentStatus" AS ENUM ('assigned', 'in_review', 'submitted', 'blocked', 'cancelled');
CREATE TYPE "SubtitleEvalReviewVerdict" AS ENUM ('pass', 'needs_changes', 'reference_questionable', 'specialist_review');
CREATE TYPE "SubtitleEvalIssueCode" AS ENUM (
  'mistranslation', 'omission', 'addition', 'terminology', 'grammar',
  'naturalness', 'tone_register', 'timing', 'line_break', 'reading_speed',
  'scripture', 'theology', 'reference_error', 'other'
);
CREATE TYPE "SubtitleEvalReferenceIssueStatus" AS ENUM ('open', 'accepted', 'rejected', 'superseded');
CREATE TYPE "SubtitleEvalChangedAxis" AS ENUM ('model', 'prompt_policy', 'workflow_policy', 'code_revision', 'runtime');
CREATE TYPE "SubtitleEvalCoverageLabel" AS ENUM ('sufficient', 'insufficient_evidence');

CREATE TABLE "subtitle_eval_corpus_snapshot" (
  "id" TEXT NOT NULL,
  "kind" "SubtitleEvalSnapshotKind" NOT NULL,
  "sha256" TEXT NOT NULL,
  "raw_sha256" TEXT NOT NULL,
  "clipped_sha256" TEXT,
  "object_key" TEXT NOT NULL,
  "byte_length" BIGINT NOT NULL,
  "media_type" TEXT NOT NULL DEFAULT 'text/vtt',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_corpus_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_corpus_version" (
  "id" TEXT NOT NULL,
  "identity_digest" TEXT NOT NULL,
  "manifest_digest" TEXT NOT NULL,
  "lock_digest" TEXT NOT NULL,
  "authority" TEXT NOT NULL,
  "status" "SubtitleEvalCorpusStatus" NOT NULL DEFAULT 'provisional',
  "certification" JSONB NOT NULL DEFAULT '{}',
  "approval_digest" TEXT,
  "approved_by_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "supersedes_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_corpus_version_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_corpus_cell" (
  "id" TEXT NOT NULL,
  "corpus_version_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "collection_key" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "edition_identity" TEXT NOT NULL,
  "source_language_id" TEXT NOT NULL,
  "source_language_slug" TEXT NOT NULL,
  "source_track_identity" TEXT NOT NULL,
  "target_language_id" TEXT NOT NULL,
  "target_language_slug" TEXT NOT NULL,
  "reference_track_identity" TEXT NOT NULL,
  "source_snapshot_id" TEXT NOT NULL,
  "reference_snapshot_id" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_corpus_cell_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_run" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_digest" TEXT NOT NULL,
  "operator_id" TEXT NOT NULL,
  "corpus_version_id" TEXT NOT NULL,
  "status" "SubtitleEvalRunStatus" NOT NULL DEFAULT 'queued',
  "requested_provider" TEXT NOT NULL,
  "requested_model" TEXT NOT NULL,
  "prompt_policy_id" TEXT NOT NULL,
  "workflow_policy_digest" TEXT NOT NULL,
  "code_revision" TEXT NOT NULL,
  "determinism" JSONB NOT NULL DEFAULT '{}',
  "concurrency" INTEGER NOT NULL,
  "timeout_seconds" INTEGER NOT NULL,
  "max_attempts" INTEGER NOT NULL,
  "estimated_spend_micros" BIGINT NOT NULL,
  "lease_generation" INTEGER NOT NULL DEFAULT 0,
  "lease_token_hash" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "terminal_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subtitle_eval_run_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_run_bounds_check" CHECK (
    "concurrency" BETWEEN 1 AND 3 AND
    "timeout_seconds" BETWEEN 60 AND 600 AND
    "max_attempts" BETWEEN 1 AND 2 AND
    "estimated_spend_micros" >= 0
  )
);

CREATE TABLE "subtitle_eval_run_cell" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "corpus_cell_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "target_language_id" TEXT NOT NULL,
  "target_language_slug" TEXT NOT NULL,
  "status" "SubtitleEvalCellStatus" NOT NULL DEFAULT 'queued',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "lease_generation" INTEGER NOT NULL DEFAULT 0,
  "lease_token_hash" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "result_digest" TEXT,
  "error_code" TEXT,
  "error_retryable" BOOLEAN,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subtitle_eval_run_cell_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_run_cell_attempt_count_check" CHECK ("attempt_count" BETWEEN 0 AND 2)
);

CREATE TABLE "subtitle_eval_artifact" (
  "id" TEXT NOT NULL,
  "run_cell_id" TEXT NOT NULL,
  "kind" "SubtitleEvalArtifactKind" NOT NULL,
  "sha256" TEXT NOT NULL,
  "object_key" TEXT NOT NULL,
  "byte_length" BIGINT NOT NULL,
  "media_type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_artifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_artifact_byte_length_check" CHECK ("byte_length" >= 0)
);

CREATE TABLE "subtitle_eval_machine_assessment" (
  "id" TEXT NOT NULL,
  "run_cell_id" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "metrics" JSONB NOT NULL,
  "advisory_risk_flags" JSONB NOT NULL DEFAULT '[]',
  "usage" JSONB NOT NULL DEFAULT '{}',
  "reproducibility_limits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "provider_request_id" TEXT,
  "provider_response_id" TEXT,
  "resolved_model" TEXT,
  "assessment_digest" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_machine_assessment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_provider_call" (
  "id" TEXT NOT NULL,
  "run_cell_id" TEXT NOT NULL,
  "lease_generation" INTEGER NOT NULL,
  "call_sequence" INTEGER NOT NULL,
  "operation" "SubtitleEvalProviderOperation" NOT NULL,
  "chunk_index" INTEGER,
  "operation_attempt" INTEGER NOT NULL,
  "status" "SubtitleEvalProviderCallStatus" NOT NULL,
  "request_digest" TEXT NOT NULL,
  "provider_request_id" TEXT,
  "provider_response_id" TEXT,
  "requested_model" TEXT NOT NULL,
  "resolved_model" TEXT,
  "usage" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_provider_call_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_provider_call_bounds_check" CHECK (
    "lease_generation" > 0 AND
    "call_sequence" BETWEEN 1 AND 1000 AND
    ("chunk_index" IS NULL OR "chunk_index" BETWEEN 0 AND 1000) AND
    "operation_attempt" BETWEEN 0 AND 10
  )
);

CREATE TABLE "subtitle_eval_terminal_report" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "status" "SubtitleEvalRunStatus" NOT NULL,
  "report_digest" TEXT NOT NULL,
  "report_artifact_digest" TEXT,
  "corpus_identity_digest" TEXT NOT NULL,
  "source_reference_digests" JSONB NOT NULL,
  "provider_identities" JSONB NOT NULL,
  "runtime_identity" JSONB NOT NULL,
  "usage" JSONB NOT NULL DEFAULT '{}',
  "language_metrics" JSONB NOT NULL DEFAULT '[]',
  "collection_metrics" JSONB NOT NULL DEFAULT '[]',
  "artifact_inventory" JSONB NOT NULL DEFAULT '[]',
  "reproducibility_limits" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "partial_failures" JSONB NOT NULL DEFAULT '[]',
  "completed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_terminal_report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_terminal_report_status_check" CHECK ("status" IN ('completed', 'partial', 'failed'))
);

CREATE TABLE "subtitle_eval_rubric_version" (
  "id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "schema_digest" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_rubric_version_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_assignment" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT,
  "request_digest" TEXT,
  "run_cell_id" TEXT NOT NULL,
  "reviewer_membership_id" TEXT,
  "target_language_id" TEXT NOT NULL,
  "target_language_slug" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "kind" "SubtitleEvalAssignmentKind" NOT NULL DEFAULT 'standard',
  "status" "SubtitleEvalAssignmentStatus" NOT NULL DEFAULT 'assigned',
  "specialist_dimension" TEXT,
  "presentation_seed" TEXT,
  "qualification_version" INTEGER,
  "assigned_by_id" TEXT NOT NULL,
  "blocked_reason" TEXT,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "escalated_from_review_id" TEXT,
  CONSTRAINT "subtitle_eval_assignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_assignment_round_check" CHECK ("round" > 0)
);

CREATE TABLE "subtitle_eval_human_review" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "reviewer_membership_id" TEXT NOT NULL,
  "target_language_id" TEXT NOT NULL,
  "target_language_slug" TEXT NOT NULL,
  "rubric_version_id" TEXT NOT NULL,
  "meaning_accuracy_score" INTEGER NOT NULL,
  "naturalness_score" INTEGER NOT NULL,
  "timing_readability_score" INTEGER NOT NULL,
  "scripture_theology_score" INTEGER,
  "verdict" "SubtitleEvalReviewVerdict" NOT NULL,
  "issue_codes" "SubtitleEvalIssueCode"[] NOT NULL DEFAULT ARRAY[]::"SubtitleEvalIssueCode"[],
  "critical_meaning_loss" BOOLEAN NOT NULL DEFAULT false,
  "critical_harmful" BOOLEAN NOT NULL DEFAULT false,
  "critical_scripture_risk" BOOLEAN NOT NULL DEFAULT false,
  "track_assessments" JSONB NOT NULL,
  "questionable_track" TEXT,
  "notes" TEXT,
  "corrections" JSONB NOT NULL DEFAULT '[]',
  "body_digest" TEXT NOT NULL,
  "assertion_nonce_hash" TEXT NOT NULL,
  "supersedes_review_id" TEXT,
  "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_human_review_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subtitle_eval_human_review_questionable_track_check" CHECK (
    "questionable_track" IS NULL OR "questionable_track" IN ('A', 'B')
  ),
  CONSTRAINT "subtitle_eval_human_review_scores_check" CHECK (
    "meaning_accuracy_score" BETWEEN 1 AND 5 AND
    "naturalness_score" BETWEEN 1 AND 5 AND
    "timing_readability_score" BETWEEN 1 AND 5 AND
    ("scripture_theology_score" IS NULL OR "scripture_theology_score" BETWEEN 1 AND 5)
  )
);

CREATE TABLE "subtitle_eval_reference_issue" (
  "id" TEXT NOT NULL,
  "review_id" TEXT NOT NULL,
  "corpus_cell_id" TEXT NOT NULL,
  "status" "SubtitleEvalReferenceIssueStatus" NOT NULL DEFAULT 'open',
  "disposition_reason" TEXT,
  "disposition_by_id" TEXT,
  "disposition_at" TIMESTAMP(3),
  "corrected_corpus_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_reference_issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_comparison" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "request_digest" TEXT NOT NULL,
  "baseline_report_id" TEXT NOT NULL,
  "candidate_report_id" TEXT NOT NULL,
  "changed_axis" "SubtitleEvalChangedAxis" NOT NULL,
  "identity_differences" JSONB NOT NULL,
  "descriptive_deltas" JSONB NOT NULL,
  "unmatched_cells" JSONB NOT NULL,
  "matched_cell_count" INTEGER NOT NULL,
  "matched_collection_count" INTEGER NOT NULL,
  "coverage_label" "SubtitleEvalCoverageLabel" NOT NULL,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_comparison_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_experiment_narrative" (
  "id" TEXT NOT NULL,
  "comparison_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "hypothesis" TEXT NOT NULL,
  "conclusion" TEXT,
  "rationale" TEXT,
  "follow_up_action" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_experiment_narrative_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subtitle_eval_assertion_nonce" (
  "nonce_hash" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_assertion_nonce_pkey" PRIMARY KEY ("nonce_hash")
);

CREATE TABLE "subtitle_eval_delegation_nonce" (
  "nonce_hash" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_delegation_nonce_pkey" PRIMARY KEY ("nonce_hash")
);

CREATE TABLE "subtitle_eval_audit_event" (
  "id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "actor_id" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "request_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subtitle_eval_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subtitle_eval_corpus_snapshot_object_key_key" ON "subtitle_eval_corpus_snapshot"("object_key");
CREATE UNIQUE INDEX "subtitle_eval_corpus_snapshot_kind_sha256_key" ON "subtitle_eval_corpus_snapshot"("kind", "sha256");
CREATE UNIQUE INDEX "subtitle_eval_corpus_version_identity_digest_key" ON "subtitle_eval_corpus_version"("identity_digest");
CREATE INDEX "subtitle_eval_corpus_version_status_created_at_idx" ON "subtitle_eval_corpus_version"("status", "created_at");
CREATE UNIQUE INDEX "subtitle_eval_corpus_cell_corpus_version_id_case_id_target_language_id_key" ON "subtitle_eval_corpus_cell"("corpus_version_id", "case_id", "target_language_id");
CREATE INDEX "subtitle_eval_corpus_cell_target_language_id_collection_key_idx" ON "subtitle_eval_corpus_cell"("target_language_id", "collection_key");
CREATE UNIQUE INDEX "subtitle_eval_run_idempotency_key_key" ON "subtitle_eval_run"("idempotency_key");
CREATE INDEX "subtitle_eval_run_status_created_at_idx" ON "subtitle_eval_run"("status", "created_at");
CREATE INDEX "subtitle_eval_run_operator_id_status_created_at_idx" ON "subtitle_eval_run"("operator_id", "status", "created_at");
CREATE UNIQUE INDEX "subtitle_eval_run_cell_idempotency_key_key" ON "subtitle_eval_run_cell"("idempotency_key");
CREATE UNIQUE INDEX "subtitle_eval_run_cell_run_id_corpus_cell_id_key" ON "subtitle_eval_run_cell"("run_id", "corpus_cell_id");
CREATE INDEX "subtitle_eval_run_cell_run_id_status_idx" ON "subtitle_eval_run_cell"("run_id", "status");
CREATE INDEX "subtitle_eval_run_cell_target_language_id_status_idx" ON "subtitle_eval_run_cell"("target_language_id", "status");
CREATE INDEX "subtitle_eval_artifact_object_key_idx" ON "subtitle_eval_artifact"("object_key");
CREATE UNIQUE INDEX "subtitle_eval_artifact_run_cell_id_kind_key" ON "subtitle_eval_artifact"("run_cell_id", "kind");
CREATE INDEX "subtitle_eval_artifact_kind_sha256_idx" ON "subtitle_eval_artifact"("kind", "sha256");
CREATE UNIQUE INDEX "subtitle_eval_machine_assessment_run_cell_id_key" ON "subtitle_eval_machine_assessment"("run_cell_id");
CREATE UNIQUE INDEX "subtitle_eval_provider_call_run_cell_id_lease_generation_call_sequence_key" ON "subtitle_eval_provider_call"("run_cell_id", "lease_generation", "call_sequence");
CREATE INDEX "subtitle_eval_provider_call_run_cell_id_lease_generation_idx" ON "subtitle_eval_provider_call"("run_cell_id", "lease_generation");
CREATE UNIQUE INDEX "subtitle_eval_terminal_report_run_id_key" ON "subtitle_eval_terminal_report"("run_id");
CREATE INDEX "subtitle_eval_terminal_report_status_completed_at_idx" ON "subtitle_eval_terminal_report"("status", "completed_at");
CREATE UNIQUE INDEX "subtitle_eval_rubric_version_version_key" ON "subtitle_eval_rubric_version"("version");
CREATE UNIQUE INDEX "subtitle_eval_rubric_version_schema_digest_key" ON "subtitle_eval_rubric_version"("schema_digest");
CREATE UNIQUE INDEX "subtitle_eval_assignment_idempotency_key_key" ON "subtitle_eval_assignment"("idempotency_key");
CREATE UNIQUE INDEX "subtitle_eval_assignment_run_cell_id_reviewer_membership_id_round_key" ON "subtitle_eval_assignment"("run_cell_id", "reviewer_membership_id", "round");
CREATE UNIQUE INDEX "subtitle_eval_assignment_escalated_from_review_id_key" ON "subtitle_eval_assignment"("escalated_from_review_id");
CREATE INDEX "subtitle_eval_assignment_reviewer_membership_id_status_assigned_at_idx" ON "subtitle_eval_assignment"("reviewer_membership_id", "status", "assigned_at");
CREATE INDEX "subtitle_eval_assignment_target_language_id_status_idx" ON "subtitle_eval_assignment"("target_language_id", "status");
CREATE UNIQUE INDEX "subtitle_eval_human_review_idempotency_key_key" ON "subtitle_eval_human_review"("idempotency_key");
CREATE UNIQUE INDEX "subtitle_eval_human_review_assertion_nonce_hash_key" ON "subtitle_eval_human_review"("assertion_nonce_hash");
CREATE UNIQUE INDEX "subtitle_eval_human_review_supersedes_review_id_key" ON "subtitle_eval_human_review"("supersedes_review_id");
CREATE INDEX "subtitle_eval_human_review_assignment_id_submitted_at_idx" ON "subtitle_eval_human_review"("assignment_id", "submitted_at");
CREATE INDEX "subtitle_eval_human_review_reviewer_membership_id_submitted_at_idx" ON "subtitle_eval_human_review"("reviewer_membership_id", "submitted_at");
CREATE UNIQUE INDEX "subtitle_eval_reference_issue_review_id_key" ON "subtitle_eval_reference_issue"("review_id");
CREATE INDEX "subtitle_eval_reference_issue_status_created_at_idx" ON "subtitle_eval_reference_issue"("status", "created_at");
CREATE INDEX "subtitle_eval_reference_issue_corpus_cell_id_status_idx" ON "subtitle_eval_reference_issue"("corpus_cell_id", "status");
CREATE UNIQUE INDEX "subtitle_eval_comparison_idempotency_key_key" ON "subtitle_eval_comparison"("idempotency_key");
CREATE INDEX "subtitle_eval_comparison_baseline_report_id_candidate_report_id_idx" ON "subtitle_eval_comparison"("baseline_report_id", "candidate_report_id");
CREATE UNIQUE INDEX "subtitle_eval_experiment_narrative_comparison_id_version_key" ON "subtitle_eval_experiment_narrative"("comparison_id", "version");
CREATE INDEX "subtitle_eval_assertion_nonce_expires_at_idx" ON "subtitle_eval_assertion_nonce"("expires_at");
CREATE INDEX "subtitle_eval_delegation_nonce_expires_at_idx" ON "subtitle_eval_delegation_nonce"("expires_at");
CREATE INDEX "subtitle_eval_audit_event_entity_type_entity_id_created_at_idx" ON "subtitle_eval_audit_event"("entity_type", "entity_id", "created_at");
CREATE INDEX "subtitle_eval_audit_event_actor_id_created_at_idx" ON "subtitle_eval_audit_event"("actor_id", "created_at");

ALTER TABLE "subtitle_eval_corpus_version" ADD CONSTRAINT "subtitle_eval_corpus_version_supersedes_version_id_fkey" FOREIGN KEY ("supersedes_version_id") REFERENCES "subtitle_eval_corpus_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_corpus_cell" ADD CONSTRAINT "subtitle_eval_corpus_cell_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "subtitle_eval_corpus_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_corpus_cell" ADD CONSTRAINT "subtitle_eval_corpus_cell_source_language_id_fkey" FOREIGN KEY ("source_language_id") REFERENCES "language"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_corpus_cell" ADD CONSTRAINT "subtitle_eval_corpus_cell_target_language_id_fkey" FOREIGN KEY ("target_language_id") REFERENCES "language"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_corpus_cell" ADD CONSTRAINT "subtitle_eval_corpus_cell_source_snapshot_id_fkey" FOREIGN KEY ("source_snapshot_id") REFERENCES "subtitle_eval_corpus_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_corpus_cell" ADD CONSTRAINT "subtitle_eval_corpus_cell_reference_snapshot_id_fkey" FOREIGN KEY ("reference_snapshot_id") REFERENCES "subtitle_eval_corpus_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_run" ADD CONSTRAINT "subtitle_eval_run_corpus_version_id_fkey" FOREIGN KEY ("corpus_version_id") REFERENCES "subtitle_eval_corpus_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_run_cell" ADD CONSTRAINT "subtitle_eval_run_cell_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "subtitle_eval_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_run_cell" ADD CONSTRAINT "subtitle_eval_run_cell_corpus_cell_id_fkey" FOREIGN KEY ("corpus_cell_id") REFERENCES "subtitle_eval_corpus_cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_run_cell" ADD CONSTRAINT "subtitle_eval_run_cell_target_language_id_fkey" FOREIGN KEY ("target_language_id") REFERENCES "language"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_artifact" ADD CONSTRAINT "subtitle_eval_artifact_run_cell_id_fkey" FOREIGN KEY ("run_cell_id") REFERENCES "subtitle_eval_run_cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_machine_assessment" ADD CONSTRAINT "subtitle_eval_machine_assessment_run_cell_id_fkey" FOREIGN KEY ("run_cell_id") REFERENCES "subtitle_eval_run_cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_provider_call" ADD CONSTRAINT "subtitle_eval_provider_call_run_cell_id_fkey" FOREIGN KEY ("run_cell_id") REFERENCES "subtitle_eval_run_cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_terminal_report" ADD CONSTRAINT "subtitle_eval_terminal_report_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "subtitle_eval_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_assignment" ADD CONSTRAINT "subtitle_eval_assignment_run_cell_id_fkey" FOREIGN KEY ("run_cell_id") REFERENCES "subtitle_eval_run_cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_assignment" ADD CONSTRAINT "subtitle_eval_assignment_reviewer_membership_id_fkey" FOREIGN KEY ("reviewer_membership_id") REFERENCES "manager_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_assignment" ADD CONSTRAINT "subtitle_eval_assignment_target_language_id_fkey" FOREIGN KEY ("target_language_id") REFERENCES "language"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_human_review" ADD CONSTRAINT "subtitle_eval_human_review_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "subtitle_eval_assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_human_review" ADD CONSTRAINT "subtitle_eval_human_review_reviewer_membership_id_fkey" FOREIGN KEY ("reviewer_membership_id") REFERENCES "manager_membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_human_review" ADD CONSTRAINT "subtitle_eval_human_review_target_language_id_fkey" FOREIGN KEY ("target_language_id") REFERENCES "language"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_human_review" ADD CONSTRAINT "subtitle_eval_human_review_rubric_version_id_fkey" FOREIGN KEY ("rubric_version_id") REFERENCES "subtitle_eval_rubric_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_human_review" ADD CONSTRAINT "subtitle_eval_human_review_supersedes_review_id_fkey" FOREIGN KEY ("supersedes_review_id") REFERENCES "subtitle_eval_human_review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_assignment" ADD CONSTRAINT "subtitle_eval_assignment_escalated_from_review_id_fkey" FOREIGN KEY ("escalated_from_review_id") REFERENCES "subtitle_eval_human_review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_reference_issue" ADD CONSTRAINT "subtitle_eval_reference_issue_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "subtitle_eval_human_review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_reference_issue" ADD CONSTRAINT "subtitle_eval_reference_issue_corpus_cell_id_fkey" FOREIGN KEY ("corpus_cell_id") REFERENCES "subtitle_eval_corpus_cell"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_reference_issue" ADD CONSTRAINT "subtitle_eval_reference_issue_corrected_corpus_version_id_fkey" FOREIGN KEY ("corrected_corpus_version_id") REFERENCES "subtitle_eval_corpus_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_comparison" ADD CONSTRAINT "subtitle_eval_comparison_baseline_report_id_fkey" FOREIGN KEY ("baseline_report_id") REFERENCES "subtitle_eval_terminal_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_comparison" ADD CONSTRAINT "subtitle_eval_comparison_candidate_report_id_fkey" FOREIGN KEY ("candidate_report_id") REFERENCES "subtitle_eval_terminal_report"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subtitle_eval_experiment_narrative" ADD CONSTRAINT "subtitle_eval_experiment_narrative_comparison_id_fkey" FOREIGN KEY ("comparison_id") REFERENCES "subtitle_eval_comparison"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Machine and human evidence is append-only. Mutable coordination stays on
-- run/cell/assignment/issue rows; corrections append a new review row.
CREATE FUNCTION "subtitle_eval_reject_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'subtitle evaluation evidence is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subtitle_eval_terminal_report_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_terminal_report" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_corpus_snapshot_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_corpus_snapshot" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_corpus_cell_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_corpus_cell" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_artifact_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_artifact" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_rubric_version_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_rubric_version" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_comparison_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_comparison" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_machine_assessment_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_machine_assessment" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_provider_call_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_provider_call" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();

CREATE FUNCTION "subtitle_eval_guard_provider_call_before_terminal_report"() RETURNS trigger AS $$
DECLARE
  parent_run_id TEXT;
BEGIN
  SELECT parent_run."id" INTO parent_run_id
  FROM "subtitle_eval_run_cell" cell
  JOIN "subtitle_eval_run" parent_run ON parent_run."id" = cell."run_id"
  WHERE cell."id" = NEW."run_cell_id"
  FOR UPDATE OF parent_run;

  IF parent_run_id IS NULL THEN
    RAISE EXCEPTION 'subtitle evaluation provider evidence has no parent run';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "subtitle_eval_run_cell" cell
    JOIN "subtitle_eval_terminal_report" report ON report."run_id" = cell."run_id"
    WHERE cell."id" = NEW."run_cell_id"
  ) THEN
    RAISE EXCEPTION 'subtitle evaluation provider evidence is frozen after terminal report';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subtitle_eval_provider_call_before_terminal_report"
  BEFORE INSERT ON "subtitle_eval_provider_call"
  FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_guard_provider_call_before_terminal_report"();
CREATE TRIGGER "subtitle_eval_human_review_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_human_review" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_experiment_narrative_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_experiment_narrative" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "subtitle_eval_audit_event_immutable" BEFORE UPDATE OR DELETE ON "subtitle_eval_audit_event" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();
CREATE TRIGGER "manager_access_audit_event_immutable" BEFORE UPDATE OR DELETE ON "manager_access_audit_event" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_reject_mutation"();

CREATE FUNCTION "subtitle_eval_guard_corpus_version_transition"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subtitle evaluation corpus versions cannot be deleted';
  END IF;
  IF NEW."id" <> OLD."id"
     OR NEW."identity_digest" <> OLD."identity_digest"
     OR NEW."manifest_digest" <> OLD."manifest_digest"
     OR NEW."lock_digest" <> OLD."lock_digest"
     OR NEW."authority" <> OLD."authority"
     OR NEW."supersedes_version_id" IS DISTINCT FROM OLD."supersedes_version_id"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'subtitle evaluation corpus identity is immutable';
  END IF;
  IF OLD."status" = 'provisional'
     AND NEW."status" = 'approved'
     AND OLD."approved_by_id" IS NULL
     AND OLD."approved_at" IS NULL
     AND OLD."approval_digest" IS NULL
     AND NEW."approved_by_id" IS NOT NULL
     AND NEW."approved_at" IS NOT NULL
     AND NEW."approval_digest" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'approved'
     AND NEW."status" = 'superseded'
     AND NEW."certification" = OLD."certification"
     AND NEW."approved_by_id" = OLD."approved_by_id"
     AND NEW."approved_at" = OLD."approved_at"
     AND NEW."approval_digest" = OLD."approval_digest" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid subtitle evaluation corpus version transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subtitle_eval_corpus_version_transition" BEFORE UPDATE OR DELETE ON "subtitle_eval_corpus_version" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_guard_corpus_version_transition"();

CREATE FUNCTION "subtitle_eval_guard_assignment_request_identity"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subtitle evaluation assignments cannot be deleted';
  END IF;
  IF NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."request_digest" IS DISTINCT FROM OLD."request_digest" THEN
    RAISE EXCEPTION 'subtitle evaluation assignment request identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subtitle_eval_assignment_request_identity" BEFORE UPDATE OR DELETE ON "subtitle_eval_assignment" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_guard_assignment_request_identity"();

-- Execution status, leases, attempts, and timestamps remain mutable, but the
-- request identity that makes a run reproducible must never drift underneath
-- its cells, terminal report, or comparisons.
CREATE FUNCTION "subtitle_eval_guard_run_request_identity"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subtitle evaluation runs cannot be deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."request_digest" IS DISTINCT FROM OLD."request_digest"
     OR NEW."operator_id" IS DISTINCT FROM OLD."operator_id"
     OR NEW."corpus_version_id" IS DISTINCT FROM OLD."corpus_version_id"
     OR NEW."requested_provider" IS DISTINCT FROM OLD."requested_provider"
     OR NEW."requested_model" IS DISTINCT FROM OLD."requested_model"
     OR NEW."prompt_policy_id" IS DISTINCT FROM OLD."prompt_policy_id"
     OR NEW."workflow_policy_digest" IS DISTINCT FROM OLD."workflow_policy_digest"
     OR NEW."code_revision" IS DISTINCT FROM OLD."code_revision"
     OR NEW."determinism" IS DISTINCT FROM OLD."determinism"
     OR NEW."concurrency" IS DISTINCT FROM OLD."concurrency"
     OR NEW."timeout_seconds" IS DISTINCT FROM OLD."timeout_seconds"
     OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts"
     OR NEW."estimated_spend_micros" IS DISTINCT FROM OLD."estimated_spend_micros"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'subtitle evaluation run request identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subtitle_eval_run_request_identity" BEFORE UPDATE OR DELETE ON "subtitle_eval_run" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_guard_run_request_identity"();

CREATE FUNCTION "subtitle_eval_guard_run_cell_binding_identity"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subtitle evaluation run cells cannot be deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."run_id" IS DISTINCT FROM OLD."run_id"
     OR NEW."corpus_cell_id" IS DISTINCT FROM OLD."corpus_cell_id"
     OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
     OR NEW."target_language_id" IS DISTINCT FROM OLD."target_language_id"
     OR NEW."target_language_slug" IS DISTINCT FROM OLD."target_language_slug"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'subtitle evaluation run cell binding identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "subtitle_eval_run_cell_binding_identity" BEFORE UPDATE OR DELETE ON "subtitle_eval_run_cell" FOR EACH ROW EXECUTE FUNCTION "subtitle_eval_guard_run_cell_binding_identity"();
