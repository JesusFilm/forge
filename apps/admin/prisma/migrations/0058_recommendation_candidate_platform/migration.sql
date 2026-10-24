-- feat-382 / U15: durable, bounded semantic candidate-platform stage proof.
-- This is expand-only. N-1 applications ignore the new manifest and tables;
-- rollback is application-first by restoring the serving-control pointer to
-- semantic-transcript-pgvector-v1. Request-root purge cascades both tables.

CREATE TABLE "recommendation_candidate_run" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL,
  "purpose" varchar(64) NOT NULL,
  "context_version" varchar(64) NOT NULL,
  "generator_version" varchar(64) NOT NULL,
  "union_version" varchar(64) NOT NULL,
  "eligibility_version" varchar(64) NOT NULL,
  "ranker_version" varchar(64) NOT NULL,
  "composer_version" varchar(64) NOT NULL,
  "candidate_eligibility_parity" varchar(16) NOT NULL,
  "ranker_parity" varchar(16) NOT NULL,
  "baseline_digest" char(64),
  "platform_digest" char(64),
  "nominated_count" integer NOT NULL,
  "canonicalized_count" integer NOT NULL,
  "deduplicated_count" integer NOT NULL,
  "rejected_count" integer NOT NULL,
  "scored_count" integer NOT NULL,
  "ordered_count" integer NOT NULL,
  "composed_count" integer NOT NULL,
  "evidence_complete" boolean NOT NULL,
  "fallback_reason" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_candidate_run_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "recommendation_candidate_run_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_candidate_run_purpose_check" CHECK (
    "purpose" IN ('watch', 'find_to_share', 'course_build', 'experience_generation')
  ),
  CONSTRAINT "recommendation_candidate_run_parity_check" CHECK (
    "candidate_eligibility_parity" IN ('passed', 'failed', 'not_evaluated')
    AND "ranker_parity" IN ('passed', 'failed', 'not_evaluated')
  ),
  CONSTRAINT "recommendation_candidate_run_digest_check" CHECK (
    ("baseline_digest" IS NULL OR "baseline_digest" ~ '^[a-f0-9]{64}$')
    AND ("platform_digest" IS NULL OR "platform_digest" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "recommendation_candidate_run_count_check" CHECK (
    "nominated_count" BETWEEN 0 AND 64
    AND "canonicalized_count" BETWEEN 0 AND 64
    AND "deduplicated_count" BETWEEN 0 AND 64
    AND "rejected_count" BETWEEN 0 AND 64
    AND "scored_count" BETWEEN 0 AND 64
    AND "ordered_count" BETWEEN 0 AND 64
    AND "composed_count" BETWEEN 0 AND 6
  )
);
CREATE INDEX "recommendation_candidate_run_created_idx"
  ON "recommendation_candidate_run"("created_at", "id");
CREATE INDEX "recommendation_candidate_run_expiry_idx"
  ON "recommendation_candidate_run"("expires_at", "id");
CREATE TRIGGER "recommendation_candidate_run_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, request_id
ON "recommendation_candidate_run"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_root_expiry"();

CREATE TABLE "recommendation_candidate_stage_evidence" (
  "id" text PRIMARY KEY,
  "run_id" text NOT NULL,
  "stage" varchar(32) NOT NULL,
  "ordinal" integer NOT NULL,
  "candidate_key" varchar(191) NOT NULL,
  "target_media_id" varchar(191),
  "source_generator" varchar(64),
  "source_rank" integer,
  "source_score" double precision,
  "normalized_score" double precision,
  "rrf_score" double precision,
  "deterministic_score" double precision,
  "final_position" integer,
  "reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "source_evidence" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_candidate_stage_run_fkey"
    FOREIGN KEY ("run_id") REFERENCES "recommendation_candidate_run"("id")
    ON DELETE CASCADE,
  CONSTRAINT "recommendation_candidate_stage_ordinal_key"
    UNIQUE ("run_id", "stage", "ordinal"),
  CONSTRAINT "recommendation_candidate_stage_name_check" CHECK (
    "stage" IN (
      'nominated', 'canonicalized', 'deduplicated', 'rejected',
      'scored', 'ordered', 'composed'
    )
  ),
  CONSTRAINT "recommendation_candidate_stage_ordinal_check" CHECK (
    "ordinal" BETWEEN 0 AND 63
  ),
  CONSTRAINT "recommendation_candidate_stage_source_rank_check" CHECK (
    "source_rank" IS NULL OR "source_rank" BETWEEN 1 AND 64
  ),
  CONSTRAINT "recommendation_candidate_stage_source_score_check" CHECK (
    "source_score" IS NULL OR "source_score" BETWEEN -1 AND 1
  ),
  CONSTRAINT "recommendation_candidate_stage_normalized_score_check" CHECK (
    "normalized_score" IS NULL OR "normalized_score" BETWEEN 0 AND 1
  ),
  CONSTRAINT "recommendation_candidate_stage_rrf_score_check" CHECK (
    "rrf_score" IS NULL OR "rrf_score" BETWEEN 0 AND 1
  ),
  CONSTRAINT "recommendation_candidate_stage_deterministic_score_check" CHECK (
    "deterministic_score" IS NULL OR "deterministic_score" BETWEEN 0 AND 1
  ),
  CONSTRAINT "recommendation_candidate_stage_position_check" CHECK (
    "final_position" IS NULL OR "final_position" BETWEEN 0 AND 63
  ),
  CONSTRAINT "recommendation_candidate_stage_reasons_check" CHECK (
    cardinality("reason_codes") <= 16
    AND array_position("reason_codes", NULL) IS NULL
  ),
  CONSTRAINT "recommendation_candidate_stage_sources_check" CHECK (
    jsonb_typeof("source_evidence") = 'array'
    AND jsonb_array_length("source_evidence") <= 16
  )
);
CREATE INDEX "recommendation_candidate_stage_run_stage_idx"
  ON "recommendation_candidate_stage_evidence"("run_id", "stage", "ordinal");
CREATE INDEX "recommendation_candidate_stage_expiry_idx"
  ON "recommendation_candidate_stage_evidence"("expires_at", "id");

CREATE FUNCTION "enforce_recommendation_candidate_stage_expiry"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root_expiry timestamptz;
BEGIN
  SELECT request."expires_at" INTO root_expiry
  FROM "recommendation_candidate_run" run
  JOIN "recommendation_request" request ON request."id" = run."request_id"
  WHERE run."id" = NEW."run_id";
  IF root_expiry IS NULL OR NEW."expires_at" <> root_expiry THEN
    RAISE EXCEPTION 'recommendation candidate stage expiry must match request root';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_candidate_stage_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, run_id
ON "recommendation_candidate_stage_evidence"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_candidate_stage_expiry"();

COMMENT ON TABLE "recommendation_candidate_run" IS
  'Request-owned 29-day semantic candidate execution proof. Purpose: reconcile nomination, eligibility, deterministic ranking, composition, and safe fallback. Identity class: ephemeral recommendation request only. Access: authorized recommendation trace readers. Deletion: cascades with the request root. Ingestion health: evidence_complete plus stage counts. Rollback: restore semantic-transcript-pgvector-v1 serving control; retained runs remain inspectable.';
COMMENT ON TABLE "recommendation_candidate_stage_evidence" IS
  'Bounded 29-day per-stage candidate evidence with no viewer/session secret, raw vector, cookie, bearer, or profile input. Source evidence is capped at 16 compact provenance objects. Cascades through its request-owned candidate run.';

-- Published but not activated. U15 A/A fixtures and the production-vector
-- benchmark establish both independent parity gates before this immutable
-- manifest becomes eligible for an operator serving-control pointer change.
INSERT INTO "recommendation_strategy_manifest" (
  "id", "strategy_version", "contract_version", "surface_version",
  "generator", "max_items", "configuration", "enabled"
) VALUES (
  'semantic-candidate-platform-v1',
  'semantic-candidate-platform-v1',
  'semantic-recommendation-v1',
  'watch-below-player-v1',
  'semantic',
  6,
  '{
    "context":"recommendation-context-v1",
    "generator":"semantic-transcript-candidate-v1",
    "union":"canonical-video-union-v1",
    "eligibility":"watch-playable-locale-v1",
    "ranker":"semantic-deterministic-ranker-v1",
    "rrfBenchmark":"rrf-k60-v1",
    "composer":"minimal-playable-slate-v1",
    "candidateEligibilityParity":"passed",
    "rankerParity":"passed",
    "fallbackManifestId":"semantic-transcript-pgvector-v1",
    "completeServiceDeadlineMs":1500,
    "learningReads":false
  }'::jsonb,
  true
) ON CONFLICT ("id") DO NOTHING;
