-- feat-386 / U19: bounded multi-interest profile candidates in shadow.
-- Expand-only. The exact manifest is published for U16 evaluation but no
-- serving-control, promotion pointer, experiment, request, or Watch row is
-- changed, so N-1 and live semantic delivery remain untouched.

CREATE TYPE "RecommendationProfileProjectionScope" AS ENUM ('durable', 'session');
CREATE TYPE "RecommendationProfileProjectionState" AS ENUM ('building', 'published', 'failed', 'fenced');
CREATE TYPE "RecommendationProfileProjectionRunState" AS ENUM ('pending', 'claimed', 'completed', 'failed', 'fenced');
CREATE TYPE "RecommendationProfileInterestKind" AS ENUM ('durable', 'session');
CREATE TYPE "RecommendationProfileContributionKind" AS ENUM (
  'qualified_outcome', 'session_selection', 'explicit_preference', 'negative_evidence'
);

CREATE TABLE "recommendation_profile_projection_generation" (
  "id" text PRIMARY KEY,
  "manifest_id" varchar(191) NOT NULL,
  "scope" "RecommendationProfileProjectionScope" NOT NULL,
  "profile_id" text,
  "privacy_generation" integer,
  "session_digest" char(64),
  "generation" integer NOT NULL,
  "state" "RecommendationProfileProjectionState" NOT NULL DEFAULT 'building',
  "projection_version" varchar(64) NOT NULL,
  "clustering_version" varchar(64) NOT NULL,
  "eligibility_policy_version" varchar(64) NOT NULL,
  "outcome_classifier_version" varchar(64) NOT NULL,
  "input_window_start" timestamptz NOT NULL,
  "input_window_end" timestamptz NOT NULL,
  "input_watermark" timestamptz,
  "input_digest" char(64) NOT NULL,
  "contribution_count" integer NOT NULL DEFAULT 0,
  "durable_interest_count" integer NOT NULL DEFAULT 0,
  "session_intent_present" boolean NOT NULL DEFAULT false,
  "explicit_preference_count" integer NOT NULL DEFAULT 0,
  "negative_evidence_count" integer NOT NULL DEFAULT 0,
  "coverage" double precision NOT NULL DEFAULT 0,
  "stability" double precision NOT NULL DEFAULT 0,
  "cohort_quality" double precision NOT NULL DEFAULT 0,
  "failure_reason" varchar(64),
  "purpose" varchar(64) NOT NULL DEFAULT 'profile_candidate_shadow',
  "identity_class" varchar(64) NOT NULL DEFAULT 'private_pseudonymous_projection',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_profile_projection_service',
  "ingestion_health" varchar(64) NOT NULL DEFAULT 'workflow_generation_fenced',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'cascade_profile_or_session_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'semantic_control',
  "retention_days" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_profile_projection_manifest_fkey"
    FOREIGN KEY ("manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_profile_projection_profile_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_projection_scope_check" CHECK (
    (
      "scope" = 'durable' AND "profile_id" IS NOT NULL
      AND "privacy_generation" > 0 AND "session_digest" IS NULL
      AND "retention_days" = 180
    ) OR (
      "scope" = 'session' AND "profile_id" IS NULL
      AND "privacy_generation" IS NULL AND "session_digest" IS NOT NULL
      AND "retention_days" = 1
    )
  ),
  CONSTRAINT "recommendation_profile_projection_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_profile_projection_window_check" CHECK (
    "input_window_start" < "input_window_end" AND "expires_at" > "created_at"
  ),
  CONSTRAINT "recommendation_profile_projection_digest_check" CHECK (
    "input_digest" ~ '^[a-f0-9]{64}$'
    AND ("session_digest" IS NULL OR "session_digest" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "recommendation_profile_projection_counts_check" CHECK (
    "contribution_count" BETWEEN 0 AND 64
    AND "durable_interest_count" BETWEEN 0 AND 4
    AND "explicit_preference_count" BETWEEN 0 AND 16
    AND "negative_evidence_count" BETWEEN 0 AND 16
  ),
  CONSTRAINT "recommendation_profile_projection_metrics_check" CHECK (
    "coverage" BETWEEN 0 AND 1 AND "stability" BETWEEN 0 AND 1
    AND "cohort_quality" BETWEEN 0 AND 1
  ),
  CONSTRAINT "recommendation_profile_projection_state_check" CHECK (
    ("state" = 'building' AND "published_at" IS NULL AND "failure_reason" IS NULL)
    OR ("state" = 'published' AND "published_at" IS NOT NULL AND "failure_reason" IS NULL)
    OR ("state" IN ('failed', 'fenced') AND "published_at" IS NULL AND "failure_reason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "recommendation_profile_projection_durable_generation_key"
  ON "recommendation_profile_projection_generation"("profile_id", "privacy_generation", "generation")
  WHERE "scope" = 'durable';
CREATE UNIQUE INDEX "recommendation_profile_projection_session_generation_key"
  ON "recommendation_profile_projection_generation"("session_digest", "generation")
  WHERE "scope" = 'session';
CREATE UNIQUE INDEX "recommendation_profile_projection_durable_input_key"
  ON "recommendation_profile_projection_generation"("profile_id", "privacy_generation", "input_digest")
  WHERE "scope" = 'durable';
CREATE UNIQUE INDEX "recommendation_profile_projection_session_input_key"
  ON "recommendation_profile_projection_generation"("session_digest", "input_digest")
  WHERE "scope" = 'session';
CREATE INDEX "recommendation_profile_projection_profile_generation_idx"
  ON "recommendation_profile_projection_generation"("profile_id", "privacy_generation", "state", "generation" DESC);
CREATE INDEX "recommendation_profile_projection_session_generation_idx"
  ON "recommendation_profile_projection_generation"("session_digest", "state", "generation" DESC);
CREATE INDEX "recommendation_profile_projection_state_created_idx"
  ON "recommendation_profile_projection_generation"("state", "created_at");
CREATE INDEX "recommendation_profile_projection_expiry_idx"
  ON "recommendation_profile_projection_generation"("expires_at");

CREATE TABLE "recommendation_profile_interest" (
  "id" text PRIMARY KEY,
  "generation_id" text NOT NULL,
  "kind" "RecommendationProfileInterestKind" NOT NULL,
  "interest_ordinal" integer NOT NULL,
  "medoid_media_id" varchar(191) NOT NULL,
  "medoid_source_digest" char(64) NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "weight" double precision NOT NULL,
  "support_count" integer NOT NULL,
  "stability" double precision NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_profile_interest_generation_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "recommendation_profile_projection_generation"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_interest_generation_kind_ordinal_key"
    UNIQUE ("generation_id", "kind", "interest_ordinal"),
  CONSTRAINT "recommendation_profile_interest_ordinal_check" CHECK (
    ("kind" = 'durable' AND "interest_ordinal" BETWEEN 0 AND 3)
    OR ("kind" = 'session' AND "interest_ordinal" = 0)
  ),
  CONSTRAINT "recommendation_profile_interest_metrics_check" CHECK (
    "weight" BETWEEN 0 AND 1 AND "support_count" BETWEEN 1 AND 64
    AND "stability" BETWEEN 0 AND 1
  ),
  CONSTRAINT "recommendation_profile_interest_digest_check" CHECK (
    "medoid_source_digest" ~ '^[a-f0-9]{64}$'
  )
);
CREATE INDEX "recommendation_profile_interest_generation_kind_idx"
  ON "recommendation_profile_interest"("generation_id", "kind", "interest_ordinal");
CREATE INDEX "recommendation_profile_interest_expiry_idx"
  ON "recommendation_profile_interest"("expires_at");

CREATE TABLE "recommendation_profile_projection_contribution" (
  "id" text PRIMARY KEY,
  "generation_id" text NOT NULL,
  "kind" "RecommendationProfileContributionKind" NOT NULL,
  "source_id_digest" char(64) NOT NULL,
  "source_outcome_id" text,
  "source_selection_id" text,
  "target_media_id" varchar(191) NOT NULL,
  "interest_ordinal" integer,
  "weight" double precision NOT NULL,
  "eligibility_policy_version" varchar(64),
  "outcome_classifier_version" varchar(64),
  "privacy_generation" integer,
  "occurred_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_profile_contribution_generation_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "recommendation_profile_projection_generation"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_contribution_outcome_fkey"
    FOREIGN KEY ("source_outcome_id") REFERENCES "recommendation_outcome_revision"("id") ON DELETE SET NULL,
  CONSTRAINT "recommendation_profile_contribution_selection_fkey"
    FOREIGN KEY ("source_selection_id") REFERENCES "recommendation_selection"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_contribution_generation_source_key"
    UNIQUE ("generation_id", "kind", "source_id_digest"),
  CONSTRAINT "recommendation_profile_contribution_digest_check" CHECK (
    "source_id_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "recommendation_profile_contribution_weight_check" CHECK (
    "weight" BETWEEN -1 AND 1
  ),
  CONSTRAINT "recommendation_profile_contribution_kind_check" CHECK (
    (
      "kind" = 'qualified_outcome'
      AND "source_selection_id" IS NULL AND "privacy_generation" > 0
      AND "eligibility_policy_version" IS NOT NULL
      AND "outcome_classifier_version" IS NOT NULL AND "weight" > 0
    ) OR (
      "kind" = 'session_selection' AND "source_selection_id" IS NOT NULL
      AND "source_outcome_id" IS NULL AND "privacy_generation" IS NULL
      AND "weight" > 0
    ) OR (
      "kind" IN ('explicit_preference', 'negative_evidence')
      AND "source_outcome_id" IS NULL AND "source_selection_id" IS NULL
    )
  ),
  CONSTRAINT "recommendation_profile_contribution_interest_check" CHECK (
    "interest_ordinal" IS NULL OR "interest_ordinal" BETWEEN 0 AND 3
  )
);
CREATE INDEX "recommendation_profile_contribution_outcome_idx"
  ON "recommendation_profile_projection_contribution"("source_outcome_id");
CREATE INDEX "recommendation_profile_contribution_selection_idx"
  ON "recommendation_profile_projection_contribution"("source_selection_id");
CREATE INDEX "recommendation_profile_contribution_expiry_idx"
  ON "recommendation_profile_projection_contribution"("expires_at");

CREATE TABLE "recommendation_profile_projection_pointer" (
  "scope_digest" char(64) PRIMARY KEY,
  "scope" "RecommendationProfileProjectionScope" NOT NULL,
  "profile_id" text,
  "privacy_generation" integer,
  "session_digest" char(64),
  "generation_id" text NOT NULL UNIQUE,
  "pointer_generation" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recommendation_profile_projection_pointer_profile_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_projection_pointer_generation_fkey"
    FOREIGN KEY ("generation_id") REFERENCES "recommendation_profile_projection_generation"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_projection_pointer_digest_check" CHECK (
    "scope_digest" ~ '^[a-f0-9]{64}$'
    AND ("session_digest" IS NULL OR "session_digest" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "recommendation_profile_projection_pointer_scope_check" CHECK (
    ("scope" = 'durable' AND "profile_id" IS NOT NULL AND "privacy_generation" > 0 AND "session_digest" IS NULL)
    OR ("scope" = 'session' AND "profile_id" IS NULL AND "privacy_generation" IS NULL AND "session_digest" IS NOT NULL)
  ),
  CONSTRAINT "recommendation_profile_projection_pointer_generation_check" CHECK ("pointer_generation" > 0)
);
CREATE INDEX "recommendation_profile_projection_pointer_profile_idx"
  ON "recommendation_profile_projection_pointer"("profile_id", "privacy_generation");
CREATE INDEX "recommendation_profile_projection_pointer_session_idx"
  ON "recommendation_profile_projection_pointer"("session_digest");

CREATE TABLE "recommendation_profile_projection_run" (
  "id" text PRIMARY KEY,
  "scope" "RecommendationProfileProjectionScope" NOT NULL,
  "profile_id" text,
  "privacy_generation" integer,
  "session_digest" char(64),
  "state" "RecommendationProfileProjectionRunState" NOT NULL DEFAULT 'pending',
  "generation" integer NOT NULL DEFAULT 1,
  "claim_id" uuid,
  "claimed_at" timestamptz,
  "heartbeat_at" timestamptz,
  "workflow_run_id" varchar(191),
  "projection_id" text,
  "failure_reason" varchar(64),
  "purpose" varchar(64) NOT NULL DEFAULT 'profile_projection_workflow',
  "identity_class" varchar(64) NOT NULL DEFAULT 'private_pseudonymous_workflow',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_profile_projection_service',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'cascade_profile_or_session_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'semantic_control',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_profile_projection_run_profile_fkey"
    FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_profile_projection_run_projection_fkey"
    FOREIGN KEY ("projection_id") REFERENCES "recommendation_profile_projection_generation"("id") ON DELETE SET NULL,
  CONSTRAINT "recommendation_profile_projection_run_scope_check" CHECK (
    ("scope" = 'durable' AND "profile_id" IS NOT NULL AND "privacy_generation" > 0 AND "session_digest" IS NOT NULL)
    OR ("scope" = 'session' AND "profile_id" IS NULL AND "privacy_generation" IS NULL AND "session_digest" IS NOT NULL)
  ),
  CONSTRAINT "recommendation_profile_projection_run_digest_check" CHECK (
    "session_digest" IS NULL OR "session_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "recommendation_profile_projection_run_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_profile_projection_run_claim_check" CHECK (
    ("state" = 'claimed' AND "claim_id" IS NOT NULL AND "claimed_at" IS NOT NULL AND "heartbeat_at" IS NOT NULL)
    OR "state" <> 'claimed'
  ),
  CONSTRAINT "recommendation_profile_projection_run_terminal_check" CHECK (
    ("state" = 'completed' AND "projection_id" IS NOT NULL AND "completed_at" IS NOT NULL AND "failure_reason" IS NULL)
    OR ("state" IN ('failed', 'fenced') AND "completed_at" IS NOT NULL AND "failure_reason" IS NOT NULL)
    OR "state" IN ('pending', 'claimed')
  )
);
CREATE INDEX "recommendation_profile_projection_run_claim_idx"
  ON "recommendation_profile_projection_run"("state", "heartbeat_at");
CREATE INDEX "recommendation_profile_projection_run_profile_idx"
  ON "recommendation_profile_projection_run"("profile_id", "privacy_generation", "state");
CREATE INDEX "recommendation_profile_projection_run_session_idx"
  ON "recommendation_profile_projection_run"("session_digest", "state");
CREATE INDEX "recommendation_profile_projection_run_scope_wake_idx"
  ON "recommendation_profile_projection_run"(
    "profile_id", "privacy_generation", "session_digest", "created_at" DESC
  ) WHERE "state" IN ('pending', 'claimed', 'completed');
CREATE INDEX "recommendation_profile_projection_run_expiry_idx"
  ON "recommendation_profile_projection_run"("expires_at");

CREATE FUNCTION "enforce_recommendation_profile_projection_child_expiry"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_expiry timestamptz;
BEGIN
  SELECT "expires_at" INTO generation_expiry
  FROM "recommendation_profile_projection_generation"
  WHERE "id" = NEW."generation_id";
  IF generation_expiry IS NULL OR NEW."expires_at" > generation_expiry THEN
    RAISE EXCEPTION 'profile projection child expiry cannot outlive generation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_profile_interest_expiry_guard"
BEFORE INSERT OR UPDATE OF "expires_at", "generation_id"
ON "recommendation_profile_interest" FOR EACH ROW
EXECUTE FUNCTION "enforce_recommendation_profile_projection_child_expiry"();
CREATE TRIGGER "recommendation_profile_contribution_expiry_guard"
BEFORE INSERT OR UPDATE OF "expires_at", "generation_id"
ON "recommendation_profile_projection_contribution" FOR EACH ROW
EXECUTE FUNCTION "enforce_recommendation_profile_projection_child_expiry"();

CREATE FUNCTION "prevent_recommendation_profile_projection_child_update"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published profile projection children are immutable';
END;
$$;
CREATE TRIGGER "recommendation_profile_interest_immutable"
BEFORE UPDATE ON "recommendation_profile_interest" FOR EACH ROW
EXECUTE FUNCTION "prevent_recommendation_profile_projection_child_update"();
CREATE TRIGGER "recommendation_profile_contribution_immutable"
BEFORE UPDATE ON "recommendation_profile_projection_contribution" FOR EACH ROW
EXECUTE FUNCTION "prevent_recommendation_profile_projection_child_update"();

CREATE FUNCTION "enforce_recommendation_profile_projection_pointer"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE generation_row "recommendation_profile_projection_generation"%ROWTYPE;
BEGIN
  SELECT * INTO generation_row FROM "recommendation_profile_projection_generation"
  WHERE "id" = NEW."generation_id";
  IF generation_row."state" <> 'published'
    OR generation_row."scope" <> NEW."scope"
    OR generation_row."profile_id" IS DISTINCT FROM NEW."profile_id"
    OR generation_row."privacy_generation" IS DISTINCT FROM NEW."privacy_generation"
    OR generation_row."session_digest" IS DISTINCT FROM NEW."session_digest" THEN
    RAISE EXCEPTION 'profile projection pointer must reference its exact published scope';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_profile_projection_pointer_guard"
BEFORE INSERT OR UPDATE ON "recommendation_profile_projection_pointer"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_profile_projection_pointer"();

CREATE FUNCTION "prevent_terminal_recommendation_profile_projection_mutation"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD."state" IN ('published', 'failed', 'fenced') THEN
    RAISE EXCEPTION 'terminal profile projection generations are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_profile_projection_terminal_immutable"
BEFORE UPDATE OR DELETE ON "recommendation_profile_projection_generation"
FOR EACH ROW EXECUTE FUNCTION "prevent_terminal_recommendation_profile_projection_mutation"();

INSERT INTO "recommendation_strategy_manifest" (
  "id", "strategy_version", "contract_version", "surface_version",
  "generator", "max_items", "configuration", "enabled"
) VALUES (
  'multi-interest-profile-shadow-v1',
  'multi-interest-profile-shadow-v1',
  'semantic-recommendation-v1',
  'watch-below-player-v1',
  'profile',
  6,
  '{
    "context":"recommendation-profile-context-v1",
    "projection":"multi-interest-profile-projection-v1",
    "clustering":"deterministic-farthest-first-medoids-v1",
    "generator":"multi-interest-profile-candidate-v1",
    "union":"canonical-video-union-v1",
    "eligibility":"watch-playable-locale-v1",
    "ranker":"semantic-deterministic-ranker-v1",
    "composer":"minimal-playable-slate-v1",
    "fallbackManifestId":"semantic-transcript-pgvector-v1",
    "completeServiceDeadlineMs":1500,
    "shadowOnly":true,
    "learningReads":"published-projections-only"
  }'::jsonb,
  true
) ON CONFLICT ("id") DO NOTHING;

COMMENT ON TABLE "recommendation_profile_projection_generation" IS
  'Private bounded immutable profile projection. Durable scope requires consent generation and 180-day cap; session scope stores only a one-way digest for 24 hours. Exact contribution lineage supports replay, revision, erasure, and generation fencing. Live serving cannot read U19 rows.';
COMMENT ON TABLE "recommendation_profile_interest" IS
  'Private medoid vectors for up to four distinct durable interests plus one separately derived session-intent vector. Admin exposes aggregate ordinals and quality only.';
COMMENT ON TABLE "recommendation_profile_projection_contribution" IS
  'Private exact contribution lineage. Selection is session-only; only qualified, current profile-eligible outcomes may be durable positive influence.';
COMMENT ON TABLE "recommendation_profile_projection_pointer" IS
  'Atomic pointer to one fully published exact-scope generation. Reset, withdrawal, deletion and expiry cascade/fence future influence.';
COMMENT ON TABLE "recommendation_profile_projection_run" IS
  'Private durable workflow claim created before dispatch. Generation and privacy fences make replay safe; failure leaves observable operational truth while semantic remains fallback.';
