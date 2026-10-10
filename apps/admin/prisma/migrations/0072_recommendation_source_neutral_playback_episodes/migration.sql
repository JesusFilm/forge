-- Make the existing playback episode ledger the source-neutral Watch root.
-- Recommendation lineage remains immutable when present but is no longer
-- fabricated for direct, search, share, acquisition, or editorial arrivals.
ALTER TABLE "recommendation_playback_episode"
  ADD COLUMN "context_version" varchar(64) NOT NULL DEFAULT 'playback-context-v1',
  ADD COLUMN "discovery_source" varchar(32) NOT NULL DEFAULT 'direct',
  ADD COLUMN "provenance" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "claim_nonce_digest" char(64),
  ADD COLUMN "handoff_expires_at" timestamptz,
  ADD COLUMN "replay_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "conflict_count" integer NOT NULL DEFAULT 0;

UPDATE "recommendation_playback_episode" episode
SET "discovery_source" = 'recommendation',
    "claim_nonce_digest" = selection."claim_nonce_digest",
    "handoff_expires_at" = selection."handoff_expires_at"
FROM "recommendation_selection" selection
WHERE episode."selection_id" = selection."id";

ALTER TABLE "recommendation_playback_episode"
  ALTER COLUMN "request_id" DROP NOT NULL,
  ALTER COLUMN "item_id" DROP NOT NULL,
  ALTER COLUMN "selection_id" DROP NOT NULL,
  ADD CONSTRAINT "recommendation_episode_claim_nonce_key"
    UNIQUE ("claim_nonce_digest"),
  ADD CONSTRAINT "recommendation_episode_claim_nonce_check" CHECK (
    "state" <> 'pending'
    OR (
      "claim_nonce_digest" IS NOT NULL
      AND "handoff_expires_at" IS NOT NULL
    )
    OR (
      "request_id" IS NOT NULL
      AND "claim_nonce_digest" IS NULL
      AND "handoff_expires_at" IS NULL
    )
  ),
  ADD CONSTRAINT "recommendation_episode_discovery_source_check" CHECK (
    "discovery_source" IN ('direct', 'recommendation', 'search', 'share', 'acquisition', 'editorial')
  ),
  ADD CONSTRAINT "recommendation_episode_lineage_shape_check" CHECK (
    ("request_id" IS NULL AND "item_id" IS NULL AND "selection_id" IS NULL)
    OR ("request_id" IS NOT NULL AND "item_id" IS NOT NULL AND "selection_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "recommendation_episode_source_lineage_check" CHECK (
    ("request_id" IS NULL AND "discovery_source" <> 'recommendation')
    OR ("request_id" IS NOT NULL AND "discovery_source" = 'recommendation')
  ),
  ADD CONSTRAINT "recommendation_episode_integrity_count_check" CHECK (
    "replay_count" BETWEEN 0 AND 1000
    AND "conflict_count" BETWEEN 0 AND 1000
  );

UPDATE recommendation_playback_episode episode
SET conflict_count = LEAST(conflicts.conflict_count, 1000)
FROM (
  SELECT capability_jti, sum(attempts)::integer AS conflict_count
  FROM recommendation_conflict
  GROUP BY capability_jti
) conflicts
WHERE episode.capability_jti = conflicts.capability_jti;

-- During a rolling deployment, the previous writer can still insert a linked
-- pending episode without the new provenance fields. Normalize that trusted
-- lineage before constraints run, while rejecting standalone attribution.
CREATE OR REPLACE FUNCTION "normalize_recommendation_episode_source"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."request_id" IS NOT NULL THEN
    NEW."discovery_source" := 'recommendation';
  ELSIF NEW."discovery_source" = 'recommendation' THEN
    RAISE EXCEPTION 'standalone playback episode cannot claim recommendation discovery';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "recommendation_episode_source_normalize"
BEFORE INSERT OR UPDATE OF "request_id", "discovery_source"
ON "recommendation_playback_episode"
FOR EACH ROW EXECUTE FUNCTION "normalize_recommendation_episode_source"();

COMMENT ON COLUMN "recommendation_playback_episode"."discovery_source"
  IS 'Source-neutral discovery provenance; never a playback collection or downstream eligibility gate.';

CREATE OR REPLACE FUNCTION "enforce_recommendation_root_expiry"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE root_expiry timestamptz;
BEGIN
  IF NEW."request_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "expires_at" INTO root_expiry
  FROM "recommendation_request"
  WHERE "id" = NEW."request_id";
  IF root_expiry IS NULL OR NEW."expires_at" <> root_expiry THEN
    RAISE EXCEPTION 'recommendation child expiry must match request root';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "recommendation_playback_fact"
  DROP CONSTRAINT "recommendation_fact_episode_lineage_fkey",
  ALTER COLUMN "request_id" DROP NOT NULL,
  ALTER COLUMN "item_id" DROP NOT NULL,
  ADD CONSTRAINT "recommendation_fact_episode_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_fact_lineage_shape_check" CHECK (
    ("request_id" IS NULL AND "item_id" IS NULL)
    OR ("request_id" IS NOT NULL AND "item_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "recommendation_fact_episode_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "episode_id")
    REFERENCES "recommendation_playback_episode"("request_id", "item_id", "id") ON DELETE CASCADE;

ALTER TABLE "recommendation_outcome_revision"
  DROP CONSTRAINT "recommendation_outcome_episode_lineage_fkey",
  DROP CONSTRAINT "recommendation_outcome_supersedes_lineage_fkey",
  ALTER COLUMN "request_id" DROP NOT NULL,
  ALTER COLUMN "item_id" DROP NOT NULL,
  ADD COLUMN "active_intervals" jsonb,
  ADD CONSTRAINT "recommendation_outcome_episode_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_outcome_lineage_shape_check" CHECK (
    ("request_id" IS NULL AND "item_id" IS NULL)
    OR ("request_id" IS NOT NULL AND "item_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "recommendation_outcome_episode_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "episode_id")
    REFERENCES "recommendation_playback_episode"("request_id", "item_id", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_outcome_episode_id_key"
    UNIQUE ("episode_id", "id"),
  ADD CONSTRAINT "recommendation_outcome_supersedes_fkey"
    FOREIGN KEY ("supersedes_id") REFERENCES "recommendation_outcome_revision"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "recommendation_outcome_supersedes_episode_fkey"
    FOREIGN KEY ("episode_id", "supersedes_id")
    REFERENCES "recommendation_outcome_revision"("episode_id", "id") ON DELETE RESTRICT;

ALTER TABLE "recommendation_content_action"
  DROP CONSTRAINT "recommendation_content_action_episode_lineage_fkey",
  ADD CONSTRAINT "recommendation_content_action_episode_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "recommendation_playback_episode"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "recommendation_content_action_episode_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "episode_id")
    REFERENCES "recommendation_playback_episode"("request_id", "item_id", "id") ON DELETE SET NULL;

ALTER TABLE "recommendation_capability_submission_budget"
  DROP CONSTRAINT "recommendation_capability_submission_budget_request_id_fkey",
  ALTER COLUMN "request_id" DROP NOT NULL,
  ADD COLUMN "episode_id" text;

UPDATE "recommendation_capability_submission_budget" budget
SET "episode_id" = episode."id",
    "request_id" = NULL
FROM "recommendation_playback_episode" episode
WHERE budget."capability_jti" = episode."capability_jti";

ALTER TABLE "recommendation_capability_submission_budget"
  ADD CONSTRAINT "recommendation_capability_submission_budget_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_capability_submission_budget_episode_id_fkey"
    FOREIGN KEY ("episode_id") REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_capability_submission_budget_owner_check" CHECK (
    ("request_id" IS NOT NULL AND "episode_id" IS NULL)
    OR ("request_id" IS NULL AND "episode_id" IS NOT NULL)
  );

CREATE INDEX "recommendation_capability_submission_budget_episode_idx"
  ON "recommendation_capability_submission_budget"("episode_id");
CREATE INDEX "recommendation_episode_source_created_idx"
  ON "recommendation_playback_episode"("discovery_source", "created_at", "id");
CREATE INDEX "recommendation_episode_created_idx"
  ON "recommendation_playback_episode"("created_at", "id");
CREATE INDEX "recommendation_episode_finalized_idx"
  ON "recommendation_playback_episode"("finalized_at", "id");
CREATE INDEX "recommendation_outcome_classifier_created_idx"
  ON "recommendation_outcome_revision"("classifier_version", "created_at", "episode_id", "revision");

CREATE TABLE "playback_proxy_evaluation" (
  "id" text PRIMARY KEY,
  "proxy_version" varchar(64) NOT NULL,
  "revision" integer NOT NULL,
  "window_start" timestamptz NOT NULL,
  "window_end" timestamptz NOT NULL,
  "sample_count" integer NOT NULL,
  "paired_count" integer NOT NULL,
  "missing_count" integer NOT NULL,
  "agreement_rate" double precision,
  "active_qualified_rate" double precision,
  "legacy_qualified_rate" double precision,
  "late_revision_rate" double precision,
  "finalization_lag_p95_ms" integer,
  "duration_cohorts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "decision" varchar(48) NOT NULL,
  "reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "ranking_influence" boolean NOT NULL DEFAULT false,
  "input_digest" char(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "playback_proxy_evaluation_revision_key" UNIQUE ("proxy_version", "revision"),
  CONSTRAINT "playback_proxy_evaluation_window_check" CHECK ("window_start" < "window_end"),
  CONSTRAINT "playback_proxy_evaluation_count_check" CHECK (
    "revision" > 0 AND "sample_count" >= 0 AND "paired_count" >= 0
    AND "missing_count" >= 0 AND "paired_count" <= "sample_count"
    AND "missing_count" <= "sample_count"
  ),
  CONSTRAINT "playback_proxy_evaluation_rate_check" CHECK (
    ("agreement_rate" IS NULL OR "agreement_rate" BETWEEN 0 AND 1)
    AND ("active_qualified_rate" IS NULL OR "active_qualified_rate" BETWEEN 0 AND 1)
    AND ("legacy_qualified_rate" IS NULL OR "legacy_qualified_rate" BETWEEN 0 AND 1)
    AND ("late_revision_rate" IS NULL OR "late_revision_rate" BETWEEN 0 AND 1)
  ),
  CONSTRAINT "playback_proxy_evaluation_decision_check" CHECK (
    "decision" IN ('eligible_for_shadow_evaluation', 'revise', 'retire', 'inconclusive')
  ),
  CONSTRAINT "playback_proxy_evaluation_no_live_rank_check" CHECK ("ranking_influence" = false),
  CONSTRAINT "playback_proxy_evaluation_digest_check" CHECK ("input_digest" ~ '^[a-f0-9]{64}$')
);

CREATE INDEX "playback_proxy_evaluation_created_idx"
  ON "playback_proxy_evaluation"("proxy_version", "created_at");

ALTER TABLE "recommendation_trace_access_audit"
  ADD COLUMN "episode_id" text;

ALTER TABLE "recommendation_trace_access_audit"
  ADD CONSTRAINT "recommendation_trace_access_episode_fkey"
  FOREIGN KEY ("episode_id") REFERENCES "recommendation_playback_episode"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "recommendation_trace_access_episode_idx"
  ON "recommendation_trace_access_audit"("episode_id");

CREATE OR REPLACE FUNCTION "consume_recommendation_episode_capability_submissions"(
  root_request_id text,
  root_episode_id text,
  token_jti varchar(191),
  submission_attempts integer,
  submission_limit integer,
  root_expires_at timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE next_attempts integer;
BEGIN
  IF submission_attempts < 1 OR submission_limit <> 256 THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "recommendation_playback_episode"
    WHERE "id" = root_episode_id
      AND "request_id" IS NOT DISTINCT FROM root_request_id
      AND "capability_jti" = token_jti
      AND "expires_at" = root_expires_at
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "recommendation_capability_submission_budget" (
    "capability_jti", "request_id", "episode_id", "attempts", "expires_at"
  ) VALUES (
    token_jti, NULL, root_episode_id, submission_attempts, root_expires_at
  )
  ON CONFLICT ("capability_jti") DO UPDATE
  SET "attempts" = "recommendation_capability_submission_budget"."attempts" + submission_attempts,
      "updated_at" = now()
  WHERE "recommendation_capability_submission_budget"."episode_id" = root_episode_id
    AND "recommendation_capability_submission_budget"."expires_at" = root_expires_at
    AND "recommendation_capability_submission_budget"."attempts" + submission_attempts <= submission_limit
  RETURNING "attempts" INTO next_attempts;

  IF next_attempts IS NULL AND root_request_id IS NOT NULL THEN
    INSERT INTO "recommendation_evidence_audit" (
      "id", "request_id", "kind", "reason_code", "count", "expires_at"
    ) VALUES (
      'episode-submission-budget:' || token_jti,
      root_request_id,
      'committed_rejection',
      'episode_submission_budget_exceeded',
      submission_attempts,
      root_expires_at
    )
    ON CONFLICT ("id") DO UPDATE
    SET "count" = LEAST(
          "recommendation_evidence_audit"."count"::bigint + submission_attempts::bigint,
          2147483647
        )::integer,
        "occurred_at" = now()
    WHERE "recommendation_evidence_audit"."request_id" = root_request_id
      AND "recommendation_evidence_audit"."reason_code" = 'episode_submission_budget_exceeded';
  END IF;
  RETURN next_attempts;
END;
$$;
