-- Source-neutral playback evidence (feat-369).
--
-- Playback context is the raw lifecycle root. Recommendation lineage is
-- optional provenance: it is required only for recommendation-sourced
-- contexts and forbidden for every other source.

CREATE TYPE "RecommendationPlaybackSource" AS ENUM (
  'recommendation', 'search', 'share', 'acquisition', 'editorial', 'direct'
);

CREATE TABLE "recommendation_playback_context" (
  "id" text PRIMARY KEY,
  "contract_version" varchar(64) NOT NULL,
  "idempotency_key_digest" char(64) NOT NULL,
  "session_digest" char(64) NOT NULL,
  "media_id" varchar(191) NOT NULL,
  "source" "RecommendationPlaybackSource" NOT NULL,
  "source_ref_digest" char(64),
  "request_id" text,
  "item_id" text,
  "selection_id" text,
  "generation" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_playback_context_request_fkey"
    FOREIGN KEY ("request_id")
    REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_playback_context_item_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_playback_context_selection_fkey"
    FOREIGN KEY ("request_id", "item_id", "selection_id")
    REFERENCES "recommendation_selection"("request_id", "item_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_playback_context_idempotency_key"
    UNIQUE ("session_digest", "media_id", "idempotency_key_digest"),
  CONSTRAINT "recommendation_playback_context_digest_check" CHECK (
    "idempotency_key_digest" ~ '^[a-f0-9]{64}$'
    AND "session_digest" ~ '^[a-f0-9]{64}$'
    AND ("source_ref_digest" IS NULL OR "source_ref_digest" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "recommendation_playback_context_lineage_check" CHECK (
    (
      "source" = 'recommendation'
      AND "request_id" IS NOT NULL
      AND "item_id" IS NOT NULL
      AND "selection_id" IS NOT NULL
    ) OR (
      "source" <> 'recommendation'
      AND "request_id" IS NULL
      AND "item_id" IS NULL
      AND "selection_id" IS NULL
    )
  ),
  CONSTRAINT "recommendation_playback_context_lifecycle_check" CHECK (
    "generation" > 0 AND "created_at" < "expires_at"
  )
);
CREATE INDEX "recommendation_playback_context_created_idx"
  ON "recommendation_playback_context"("created_at", "id");
CREATE INDEX "recommendation_playback_context_source_created_idx"
  ON "recommendation_playback_context"("source", "created_at");
CREATE INDEX "recommendation_playback_context_request_idx"
  ON "recommendation_playback_context"("request_id");
CREATE INDEX "recommendation_playback_context_expiry_idx"
  ON "recommendation_playback_context"("expires_at", "id");

-- Backfill the new root without relying on extensions. PostgreSQL's built-in
-- md5() is used only to create deterministic opaque migration keys, not for
-- security or attribution.
INSERT INTO "recommendation_playback_context" (
  "id", "contract_version", "idempotency_key_digest", "session_digest",
  "media_id", "source", "source_ref_digest", "request_id", "item_id",
  "selection_id", "generation", "created_at", "expires_at"
)
SELECT
  'legacy-context:' || episode."id",
  'recommendation-playback-context-v1',
  md5(episode."id") || md5(episode."id" || ':playback-context'),
  episode."session_digest",
  episode."media_id",
  'recommendation'::"RecommendationPlaybackSource",
  md5(episode."selection_id") || md5(episode."selection_id" || ':source'),
  episode."request_id",
  episode."item_id",
  episode."selection_id",
  episode."generation",
  episode."created_at",
  episode."expires_at"
FROM "recommendation_playback_episode" episode;

ALTER TABLE "recommendation_playback_episode"
  ADD COLUMN "context_id" text;

UPDATE "recommendation_playback_episode"
SET "context_id" = 'legacy-context:' || "id";

-- N-1 application instances omit context_id. Bridge those inserts during the
-- rolling migration window while preserving their exact recommendation
-- lineage and immutable expiry.
CREATE FUNCTION "bridge_recommendation_playback_episode_context"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."context_id" IS NULL THEN
    IF NEW."request_id" IS NULL OR NEW."item_id" IS NULL OR NEW."selection_id" IS NULL THEN
      RAISE EXCEPTION 'playback context is required for source-neutral episodes';
    END IF;

    NEW."context_id" := 'legacy-context:' || NEW."id";
    INSERT INTO "recommendation_playback_context" (
      "id", "contract_version", "idempotency_key_digest", "session_digest",
      "media_id", "source", "source_ref_digest", "request_id", "item_id",
      "selection_id", "generation", "created_at", "expires_at"
    ) VALUES (
      NEW."context_id",
      'recommendation-playback-context-v1',
      md5(NEW."id") || md5(NEW."id" || ':playback-context'),
      NEW."session_digest",
      NEW."media_id",
      'recommendation',
      md5(NEW."selection_id") || md5(NEW."selection_id" || ':source'),
      NEW."request_id",
      NEW."item_id",
      NEW."selection_id",
      NEW."generation",
      NEW."created_at",
      NEW."expires_at"
    ) ON CONFLICT ("id") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_episode_context_bridge"
BEFORE INSERT ON "recommendation_playback_episode"
FOR EACH ROW EXECUTE FUNCTION "bridge_recommendation_playback_episode_context"();

ALTER TABLE "recommendation_playback_episode"
  ALTER COLUMN "context_id" SET NOT NULL,
  ALTER COLUMN "request_id" DROP NOT NULL,
  ALTER COLUMN "item_id" DROP NOT NULL,
  ALTER COLUMN "selection_id" DROP NOT NULL,
  ADD CONSTRAINT "recommendation_episode_context_fkey"
    FOREIGN KEY ("context_id")
    REFERENCES "recommendation_playback_context"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_episode_recommendation_lineage_check" CHECK (
    ("request_id" IS NULL AND "item_id" IS NULL AND "selection_id" IS NULL)
    OR
    ("request_id" IS NOT NULL AND "item_id" IS NOT NULL AND "selection_id" IS NOT NULL)
  );
CREATE UNIQUE INDEX "recommendation_episode_context_key"
  ON "recommendation_playback_episode"("context_id");

-- Session intent can now originate from a qualified playback outcome as well
-- as the legacy recommendation selection. Keep the existing enum label for
-- wire/storage compatibility while preserving exact source lineage.
ALTER TABLE "recommendation_profile_projection_contribution"
  DROP CONSTRAINT "recommendation_profile_contribution_kind_check",
  ADD CONSTRAINT "recommendation_profile_contribution_kind_check" CHECK (
    (
      "kind" = 'qualified_outcome'
      AND "source_selection_id" IS NULL AND "privacy_generation" > 0
      AND "source_outcome_id" IS NOT NULL
      AND "eligibility_policy_version" IS NOT NULL
      AND "outcome_classifier_version" IS NOT NULL AND "weight" > 0
    ) OR (
      "kind" = 'session_selection' AND "privacy_generation" IS NULL
      AND "weight" > 0 AND (
        (
          "source_selection_id" IS NOT NULL
          AND "source_outcome_id" IS NULL
          AND "eligibility_policy_version" IS NULL
          AND "outcome_classifier_version" IS NULL
        ) OR (
          "source_selection_id" IS NULL
          AND "source_outcome_id" IS NOT NULL
          AND "eligibility_policy_version" IS NOT NULL
          AND "outcome_classifier_version" IS NOT NULL
        )
      )
    ) OR (
      "kind" IN ('explicit_preference', 'negative_evidence')
      AND "source_outcome_id" IS NULL AND "source_selection_id" IS NULL
    )
  );

-- Facts and outcomes belong to the episode. Optional recommendation columns
-- remain denormalized provenance for compatibility and indexed diagnostics.
ALTER TABLE "recommendation_playback_fact"
  DROP CONSTRAINT "recommendation_fact_episode_lineage_fkey",
  ALTER COLUMN "request_id" DROP NOT NULL,
  ALTER COLUMN "item_id" DROP NOT NULL,
  ADD CONSTRAINT "recommendation_fact_episode_fkey"
    FOREIGN KEY ("episode_id")
    REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_fact_recommendation_lineage_check" CHECK (
    ("request_id" IS NULL AND "item_id" IS NULL)
    OR ("request_id" IS NOT NULL AND "item_id" IS NOT NULL)
  );

ALTER TABLE "recommendation_outcome_revision"
  DROP CONSTRAINT "recommendation_outcome_episode_lineage_fkey",
  DROP CONSTRAINT "recommendation_outcome_supersedes_lineage_fkey",
  ALTER COLUMN "request_id" DROP NOT NULL,
  ALTER COLUMN "item_id" DROP NOT NULL,
  ADD CONSTRAINT "recommendation_outcome_episode_fkey"
    FOREIGN KEY ("episode_id")
    REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_outcome_episode_id_key"
    UNIQUE ("episode_id", "id"),
  ADD CONSTRAINT "recommendation_outcome_supersedes_episode_key"
    UNIQUE ("episode_id", "supersedes_id"),
  ADD CONSTRAINT "recommendation_outcome_supersedes_episode_fkey"
    FOREIGN KEY ("episode_id", "supersedes_id")
    REFERENCES "recommendation_outcome_revision"("episode_id", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "recommendation_outcome_recommendation_lineage_check" CHECK (
    ("request_id" IS NULL AND "item_id" IS NULL)
    OR ("request_id" IS NOT NULL AND "item_id" IS NOT NULL)
  );

ALTER TABLE "recommendation_content_action"
  DROP CONSTRAINT "recommendation_content_action_episode_lineage_fkey",
  DROP CONSTRAINT "recommendation_content_action_lineage_check",
  ADD CONSTRAINT "recommendation_content_action_episode_fkey"
    FOREIGN KEY ("episode_id")
    REFERENCES "recommendation_playback_episode"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "recommendation_content_action_lineage_check" CHECK (
    (
      "request_id" IS NULL
      AND "item_id" IS NULL
      AND "candidate_generator" IS NULL
    ) OR (
      "request_id" IS NOT NULL
      AND (
        "item_id" IS NOT NULL
        OR (
          "episode_id" IS NULL
          AND "candidate_generator" IS NULL
        )
      )
    )
  );

-- Replace request-root guards only for rows now owned by a playback context.
DROP TRIGGER "recommendation_playback_episode_root_expiry_guard"
  ON "recommendation_playback_episode";
DROP TRIGGER "recommendation_playback_fact_root_expiry_guard"
  ON "recommendation_playback_fact";
DROP TRIGGER "recommendation_outcome_revision_root_expiry_guard"
  ON "recommendation_outcome_revision";

CREATE FUNCTION "enforce_recommendation_playback_context_expiry"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  context_row "recommendation_playback_context"%ROWTYPE;
BEGIN
  SELECT * INTO context_row
  FROM "recommendation_playback_context"
  WHERE "id" = NEW."context_id";

  IF context_row."id" IS NULL
    OR NEW."expires_at" <> context_row."expires_at"
    OR NEW."session_digest" <> context_row."session_digest"
    OR NEW."media_id" <> context_row."media_id"
    OR NEW."generation" <> context_row."generation"
    OR NEW."request_id" IS DISTINCT FROM context_row."request_id"
    OR NEW."item_id" IS DISTINCT FROM context_row."item_id"
    OR NEW."selection_id" IS DISTINCT FROM context_row."selection_id"
  THEN
    RAISE EXCEPTION 'playback episode must match immutable context';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_episode_context_guard"
BEFORE INSERT OR UPDATE OF context_id, expires_at, session_digest, media_id,
  generation, request_id, item_id, selection_id
ON "recommendation_playback_episode"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_playback_context_expiry"();

CREATE FUNCTION "enforce_recommendation_playback_episode_child"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  episode_row "recommendation_playback_episode"%ROWTYPE;
BEGIN
  SELECT * INTO episode_row
  FROM "recommendation_playback_episode"
  WHERE "id" = NEW."episode_id";

  IF episode_row."id" IS NULL
    OR NEW."expires_at" <> episode_row."expires_at"
    OR NEW."request_id" IS DISTINCT FROM episode_row."request_id"
    OR NEW."item_id" IS DISTINCT FROM episode_row."item_id"
  THEN
    RAISE EXCEPTION 'playback child must match immutable episode lineage';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_fact_episode_guard"
BEFORE INSERT OR UPDATE OF episode_id, expires_at, request_id, item_id
ON "recommendation_playback_fact"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_playback_episode_child"();
CREATE TRIGGER "recommendation_outcome_episode_guard"
BEFORE INSERT OR UPDATE OF episode_id, expires_at, request_id, item_id
ON "recommendation_outcome_revision"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_playback_episode_child"();

CREATE FUNCTION "enforce_recommendation_content_action_episode"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  episode_row "recommendation_playback_episode"%ROWTYPE;
BEGIN
  IF NEW."episode_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO episode_row
  FROM "recommendation_playback_episode"
  WHERE "id" = NEW."episode_id";

  IF episode_row."id" IS NULL
    OR NEW."expires_at" <> episode_row."expires_at"
    OR NEW."session_digest" <> episode_row."session_digest"
    OR NEW."target_media_id" <> episode_row."media_id"
    OR NEW."request_id" IS DISTINCT FROM episode_row."request_id"
    OR NEW."item_id" IS DISTINCT FROM episode_row."item_id"
  THEN
    RAISE EXCEPTION 'content action must match playback episode';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_content_action_episode_guard"
BEFORE INSERT OR UPDATE OF episode_id, expires_at, session_digest,
  target_media_id, request_id, item_id
ON "recommendation_content_action"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_content_action_episode"();

CREATE FUNCTION "guard_recommendation_playback_context"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recommendation playback context is immutable';
END;
$$;
CREATE TRIGGER "recommendation_playback_context_immutability_guard"
BEFORE UPDATE ON "recommendation_playback_context"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_playback_context"();

-- Playback rejection/conflict/budget rows may be context-owned. Delivery
-- rows keep their request root, so exactly one raw root is required.
ALTER TABLE "recommendation_evidence_audit"
  ALTER COLUMN "request_id" DROP NOT NULL,
  ADD COLUMN "context_id" text REFERENCES "recommendation_playback_context"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_evidence_audit_root_check" CHECK (
    ("request_id" IS NOT NULL) <> ("context_id" IS NOT NULL)
  );
CREATE INDEX "recommendation_audit_context_idx"
  ON "recommendation_evidence_audit"("context_id");

ALTER TABLE "recommendation_conflict"
  ALTER COLUMN "request_id" DROP NOT NULL,
  ADD COLUMN "context_id" text REFERENCES "recommendation_playback_context"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_conflict_root_check" CHECK (
    ("request_id" IS NOT NULL) <> ("context_id" IS NOT NULL)
  );
CREATE INDEX "recommendation_conflict_context_seen_idx"
  ON "recommendation_conflict"("context_id", "last_seen_at");

ALTER TABLE "recommendation_capability_submission_budget"
  ALTER COLUMN "request_id" DROP NOT NULL,
  ADD COLUMN "context_id" text REFERENCES "recommendation_playback_context"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "recommendation_capability_submission_budget_root_check" CHECK (
    ("request_id" IS NOT NULL) <> ("context_id" IS NOT NULL)
  );
CREATE INDEX "recommendation_capability_submission_budget_context_idx"
  ON "recommendation_capability_submission_budget"("context_id");

DROP TRIGGER "recommendation_evidence_audit_root_expiry_guard"
  ON "recommendation_evidence_audit";
DROP TRIGGER "recommendation_conflict_root_expiry_guard"
  ON "recommendation_conflict";
DROP TRIGGER "recommendation_capability_submission_budget_root_expiry_guard"
  ON "recommendation_capability_submission_budget";

CREATE FUNCTION "enforce_recommendation_evidence_root_expiry"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE root_expiry timestamptz;
BEGIN
  IF NEW."context_id" IS NOT NULL THEN
    SELECT "expires_at" INTO root_expiry
    FROM "recommendation_playback_context" WHERE "id" = NEW."context_id";
  ELSE
    SELECT "expires_at" INTO root_expiry
    FROM "recommendation_request" WHERE "id" = NEW."request_id";
  END IF;
  IF root_expiry IS NULL OR NEW."expires_at" <> root_expiry THEN
    RAISE EXCEPTION 'recommendation evidence expiry must match raw root';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_evidence_audit_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, request_id, context_id
ON "recommendation_evidence_audit"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_evidence_root_expiry"();
CREATE TRIGGER "recommendation_conflict_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, request_id, context_id
ON "recommendation_conflict"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_evidence_root_expiry"();
CREATE TRIGGER "recommendation_capability_submission_budget_root_expiry_guard"
BEFORE INSERT OR UPDATE OF expires_at, request_id, context_id
ON "recommendation_capability_submission_budget"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_evidence_root_expiry"();

ALTER TABLE "recommendation_trace_access_audit"
  ADD COLUMN "context_id" text REFERENCES "recommendation_playback_context"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "recommendation_trace_access_audit_root_check" CHECK (
    num_nonnulls("request_id", "context_id") <= 1
  );
CREATE INDEX "recommendation_trace_access_audit_context_id_idx"
  ON "recommendation_trace_access_audit"("context_id");

CREATE TABLE "recommendation_playback_evidence_control" (
  "id" varchar(64) PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT false,
  "reason_code" varchar(64) NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recommendation_playback_evidence_control_version_check"
    CHECK ("version" > 0)
);
INSERT INTO "recommendation_playback_evidence_control" (
  "id", "enabled", "reason_code", "version"
) VALUES (
  'recommendation-playback-evidence-control', false, 'bootstrap_disabled', 1
);

CREATE TABLE "recommendation_playback_proxy_evaluation" (
  "id" text PRIMARY KEY,
  "revision" integer NOT NULL,
  "supersedes_id" text UNIQUE
    REFERENCES "recommendation_playback_proxy_evaluation"("id") ON DELETE SET NULL,
  "policy_version" varchar(64) NOT NULL DEFAULT 'active-watch-proxy-readiness-v1',
  "window_start" timestamptz NOT NULL,
  "window_end" timestamptz NOT NULL,
  "input_watermark" timestamptz NOT NULL,
  "input_digest" char(64) NOT NULL,
  "state" varchar(64) NOT NULL,
  "reason_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cohorts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "metrics" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "purpose" varchar(64) NOT NULL DEFAULT 'offline_playback_proxy_readiness',
  "identity_class" varchar(64) NOT NULL DEFAULT 'aggregate_no_viewer_identity',
  "access_class" varchar(64) NOT NULL DEFAULT 'recommendation_aggregate_readers',
  "deletion_behavior" varchar(64) NOT NULL DEFAULT 'scheduled_expiry',
  "fallback_behavior" varchar(64) NOT NULL DEFAULT 'no_serving_effect',
  "retention_days" integer NOT NULL DEFAULT 365,
  "evaluated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_playback_proxy_evaluation_input_key"
    UNIQUE ("input_watermark", "input_digest"),
  CONSTRAINT "recommendation_playback_proxy_evaluation_revision_check"
    CHECK ("revision" > 0),
  CONSTRAINT "recommendation_playback_proxy_evaluation_digest_check"
    CHECK ("input_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_playback_proxy_evaluation_state_check"
    CHECK ("state" IN ('inconclusive', 'revise', 'retire', 'eligible_for_shadow_evaluation')),
  CONSTRAINT "recommendation_playback_proxy_evaluation_lifecycle_check"
    CHECK (
      "window_start" < "window_end"
      AND "input_watermark" <= "evaluated_at"
      AND "evaluated_at" < "expires_at"
      AND "retention_days" = 365
    )
);
CREATE INDEX "recommendation_playback_proxy_evaluation_latest_idx"
  ON "recommendation_playback_proxy_evaluation"("evaluated_at" DESC, "revision" DESC);
CREATE INDEX "recommendation_playback_proxy_evaluation_expiry_idx"
  ON "recommendation_playback_proxy_evaluation"("expires_at");

CREATE FUNCTION "guard_recommendation_playback_proxy_evaluation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."supersedes_id" IS NULL
    AND OLD."supersedes_id" IS NOT NULL
    AND (to_jsonb(NEW) - 'supersedes_id') IS NOT DISTINCT FROM
        (to_jsonb(OLD) - 'supersedes_id')
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'recommendation playback proxy evaluation is immutable';
END;
$$;
CREATE TRIGGER "recommendation_playback_proxy_evaluation_immutability_guard"
BEFORE UPDATE ON "recommendation_playback_proxy_evaluation"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_playback_proxy_evaluation"();

-- Atomically bound source-neutral fact submission attempts. The capability
-- must be the one persisted on the episode belonging to this context.
CREATE FUNCTION "consume_recommendation_context_capability_submissions"(
  root_context_id text,
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
      AND "context_id" = root_context_id
      AND "capability_jti" = token_jti
      AND "expires_at" = root_expires_at
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "recommendation_capability_submission_budget" (
    "capability_jti", "context_id", "attempts", "expires_at"
  ) VALUES (
    token_jti, root_context_id, submission_attempts, root_expires_at
  )
  ON CONFLICT ("capability_jti") DO UPDATE
  SET "attempts" = "recommendation_capability_submission_budget"."attempts" + submission_attempts,
      "updated_at" = now()
  WHERE "recommendation_capability_submission_budget"."context_id" = root_context_id
    AND "recommendation_capability_submission_budget"."expires_at" = root_expires_at
    AND "recommendation_capability_submission_budget"."attempts" + submission_attempts <= submission_limit
  RETURNING "attempts" INTO next_attempts;

  IF next_attempts IS NULL THEN
    INSERT INTO "recommendation_evidence_audit" (
      "id", "context_id", "kind", "reason_code", "count", "expires_at"
    ) VALUES (
      'context-submission-budget:' || token_jti,
      root_context_id,
      'committed_rejection',
      'context_submission_budget_exceeded',
      submission_attempts,
      root_expires_at
    )
    ON CONFLICT ("id") DO UPDATE
    SET "count" = LEAST(
          "recommendation_evidence_audit"."count"::bigint + submission_attempts::bigint,
          2147483647
        )::integer,
        "occurred_at" = now()
    WHERE "recommendation_evidence_audit"."context_id" = root_context_id
      AND "recommendation_evidence_audit"."reason_code" = 'context_submission_budget_exceeded';
  END IF;
  RETURN next_attempts;
END;
$$;

CREATE FUNCTION "upsert_recommendation_context_conflict"(
  conflict_id text,
  root_context_id text,
  token_jti varchar(191),
  browser_event_id varchar(191),
  accepted_digest char(64),
  rejected_digest char(64),
  root_expires_at timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE next_attempts integer;
BEGIN
  INSERT INTO "recommendation_conflict" (
    "id", "context_id", "capability_jti", "event_id",
    "accepted_payload_digest", "rejected_payload_digest", "expires_at"
  ) VALUES (
    conflict_id, root_context_id, token_jti, browser_event_id,
    accepted_digest, rejected_digest, root_expires_at
  )
  ON CONFLICT ("capability_jti", "event_id") DO UPDATE
  SET "attempts" = LEAST("recommendation_conflict"."attempts" + 1, 1000),
      "last_seen_at" = now(),
      "rejected_payload_digest" = EXCLUDED."rejected_payload_digest"
  WHERE "recommendation_conflict"."context_id" = root_context_id
    AND "recommendation_conflict"."accepted_payload_digest" = accepted_digest
    AND "recommendation_conflict"."expires_at" = root_expires_at
  RETURNING "attempts" INTO next_attempts;
  RETURN next_attempts;
END;
$$;

COMMENT ON TABLE "recommendation_playback_context"
  IS 'Anonymous, source-neutral playback lifecycle root. Source is untrusted provenance and never a learning-weight input.';
COMMENT ON COLUMN "recommendation_playback_context"."source_ref_digest"
  IS 'Optional one-way source reference for diagnostics; never authoritative attribution.';
