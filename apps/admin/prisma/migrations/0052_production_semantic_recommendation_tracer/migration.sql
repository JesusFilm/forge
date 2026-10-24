-- feat-368 U1: additive recommendation-owned semantic delivery/evidence ledger.
-- N-1 applications do not reference these rows. Serving is seeded disabled.

CREATE TYPE "RecommendationRequestState" AS ENUM ('prepared', 'issued', 'issuance_failed');
CREATE TYPE "RecommendationDeliveryResult" AS ENUM ('served', 'fallback', 'empty', 'unavailable');
CREATE TYPE "RecommendationEpisodeState" AS ENUM ('pending', 'claimed', 'finalized', 'timed_out');
CREATE TYPE "RecommendationAuditKind" AS ENUM ('delivery_success', 'evidence_success', 'committed_rejection', 'write_failure', 'replay', 'late');
CREATE TYPE "RecommendationRetentionRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'skipped');

CREATE TABLE "recommendation_strategy_manifest" (
  "id" varchar(191) PRIMARY KEY,
  "strategy_version" varchar(64) NOT NULL,
  "contract_version" varchar(64) NOT NULL,
  "surface_version" varchar(64) NOT NULL,
  "generator" varchar(32) NOT NULL,
  "max_items" integer NOT NULL,
  "configuration" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recommendation_manifest_max_items_check" CHECK ("max_items" BETWEEN 1 AND 6),
  CONSTRAINT "recommendation_manifest_contract_key" UNIQUE ("strategy_version", "contract_version", "surface_version")
);

CREATE TABLE "recommendation_serving_control" (
  "id" varchar(64) PRIMARY KEY,
  "enabled" boolean NOT NULL DEFAULT false,
  "manifest_id" varchar(191) NOT NULL REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  "emergency_revoked_kids" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "reason_code" varchar(64) NOT NULL DEFAULT 'bootstrap_disabled',
  "version" integer NOT NULL DEFAULT 1,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "recommendation_serving_control_singleton_check" CHECK ("id" = 'recommendation-serving-control'),
  CONSTRAINT "recommendation_serving_control_version_check" CHECK ("version" > 0),
  CONSTRAINT "recommendation_serving_control_revoked_kids_check" CHECK (
    cardinality("emergency_revoked_kids") <= 32
    AND array_position("emergency_revoked_kids", NULL) IS NULL
  )
);

CREATE TABLE "recommendation_request" (
  "id" text PRIMARY KEY,
  "contract_version" varchar(64) NOT NULL,
  "surface_version" varchar(64) NOT NULL,
  "manifest_id" varchar(191) NOT NULL REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  "strategy_version" varchar(64) NOT NULL,
  "classifier_version" varchar(64) NOT NULL,
  "session_digest" char(64) NOT NULL,
  "seed_media_id" varchar(191) NOT NULL,
  "locale" varchar(32) NOT NULL,
  "expected_item_count" integer NOT NULL,
  "state" "RecommendationRequestState" NOT NULL DEFAULT 'prepared',
  "result" "RecommendationDeliveryResult" NOT NULL,
  "fallback_reason" varchar(64),
  "delivery_jti" varchar(191),
  "signing_kid" varchar(64),
  "generation" integer NOT NULL DEFAULT 1,
  "retrieval_latency_ms" integer,
  "response_bytes" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "issued_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_request_delivery_jti_key" UNIQUE ("delivery_jti"),
  CONSTRAINT "recommendation_request_session_digest_check" CHECK ("session_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_request_item_count_check" CHECK ("expected_item_count" BETWEEN 0 AND 6),
  CONSTRAINT "recommendation_request_generation_check" CHECK ("generation" > 0),
  CONSTRAINT "recommendation_request_latency_check" CHECK ("retrieval_latency_ms" IS NULL OR "retrieval_latency_ms" >= 0),
  CONSTRAINT "recommendation_request_response_bytes_check" CHECK ("response_bytes" IS NULL OR "response_bytes" BETWEEN 0 AND 65536),
  CONSTRAINT "recommendation_request_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "recommendation_request_issued_state_check" CHECK (
    (
      "state" = 'issued'
      AND "issued_at" IS NOT NULL
      AND "signing_kid" IS NOT NULL
      AND (
        (
          "result" = 'unavailable'
          AND "expected_item_count" = 0
          AND "delivery_jti" IS NULL
        )
        OR (
          "result" <> 'unavailable'
          AND "delivery_jti" IS NOT NULL
        )
      )
    )
    OR "state" <> 'issued'
  )
);
CREATE INDEX "recommendation_request_expiry_idx" ON "recommendation_request"("expires_at", "id");
CREATE INDEX "recommendation_request_created_idx" ON "recommendation_request"("created_at", "id");
CREATE INDEX "recommendation_request_session_created_idx" ON "recommendation_request"("session_digest", "created_at");
CREATE INDEX "recommendation_request_state_created_idx" ON "recommendation_request"("state", "created_at");

CREATE TABLE "recommendation_served_item" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "position" integer NOT NULL,
  "target_media_id" varchar(191) NOT NULL,
  "canonical_href" varchar(1024) NOT NULL,
  "candidate_generator" varchar(64) NOT NULL,
  "candidate_provenance" jsonb NOT NULL,
  "presentation" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "capability_jti" varchar(191),
  "signing_kid" varchar(64),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_item_request_position_key" UNIQUE ("request_id", "position"),
  CONSTRAINT "recommendation_item_request_id_key" UNIQUE ("request_id", "id"),
  CONSTRAINT "recommendation_item_capability_jti_key" UNIQUE ("capability_jti"),
  CONSTRAINT "recommendation_item_position_check" CHECK ("position" BETWEEN 0 AND 5)
);
CREATE INDEX "recommendation_item_target_created_idx" ON "recommendation_served_item"("target_media_id", "created_at");
CREATE INDEX "recommendation_item_expiry_idx" ON "recommendation_served_item"("expires_at");

CREATE TABLE "recommendation_rendered_fact" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "capability_jti" varchar(191) NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "payload_digest" char(64) NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_render_item_request_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_render_item_key" UNIQUE ("item_id"),
  CONSTRAINT "recommendation_render_item_request_key" UNIQUE ("request_id", "item_id"),
  CONSTRAINT "recommendation_render_capability_key" UNIQUE ("capability_jti"),
  CONSTRAINT "recommendation_render_event_key" UNIQUE ("capability_jti", "event_id"),
  CONSTRAINT "recommendation_render_digest_check" CHECK ("payload_digest" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "recommendation_rendered_fact_expires_at_idx" ON "recommendation_rendered_fact"("expires_at");
CREATE INDEX "recommendation_render_request_idx" ON "recommendation_rendered_fact"("request_id");

CREATE TABLE "recommendation_impression" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "capability_jti" varchar(191) NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "payload_digest" char(64) NOT NULL,
  "visibility_policy" varchar(64) NOT NULL,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_impression_item_request_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_impression_item_key" UNIQUE ("item_id"),
  CONSTRAINT "recommendation_impression_item_request_key" UNIQUE ("request_id", "item_id"),
  CONSTRAINT "recommendation_impression_capability_key" UNIQUE ("capability_jti"),
  CONSTRAINT "recommendation_impression_event_key" UNIQUE ("capability_jti", "event_id"),
  CONSTRAINT "recommendation_impression_digest_check" CHECK ("payload_digest" ~ '^[a-f0-9]{64}$')
);
CREATE INDEX "recommendation_impression_expires_at_idx" ON "recommendation_impression"("expires_at");
CREATE INDEX "recommendation_impression_request_idx" ON "recommendation_impression"("request_id");

CREATE TABLE "recommendation_selection" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "capability_jti" varchar(191) NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "payload_digest" char(64) NOT NULL,
  "tab_digest" char(64),
  "claim_nonce_digest" char(64) NOT NULL,
  "handoff_expires_at" timestamptz NOT NULL,
  "claimed_at" timestamptz,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_selection_item_request_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_selection_item_key" UNIQUE ("item_id"),
  CONSTRAINT "recommendation_selection_item_request_key" UNIQUE ("request_id", "item_id"),
  CONSTRAINT "recommendation_selection_request_item_id_key" UNIQUE ("request_id", "item_id", "id"),
  CONSTRAINT "recommendation_selection_capability_key" UNIQUE ("capability_jti"),
  CONSTRAINT "recommendation_selection_claim_nonce_key" UNIQUE ("claim_nonce_digest"),
  CONSTRAINT "recommendation_selection_event_key" UNIQUE ("capability_jti", "event_id"),
  CONSTRAINT "recommendation_selection_payload_digest_check" CHECK ("payload_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_selection_tab_digest_check" CHECK ("tab_digest" IS NULL OR "tab_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_selection_claim_digest_check" CHECK ("claim_nonce_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_selection_handoff_expiry_check" CHECK ("handoff_expires_at" <= "expires_at")
);
CREATE INDEX "recommendation_selection_handoff_idx" ON "recommendation_selection"("claim_nonce_digest", "handoff_expires_at");
CREATE INDEX "recommendation_selection_expires_at_idx" ON "recommendation_selection"("expires_at");
CREATE INDEX "recommendation_selection_request_idx" ON "recommendation_selection"("request_id");

CREATE TABLE "recommendation_playback_episode" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "selection_id" text NOT NULL,
  "media_id" varchar(191) NOT NULL,
  "session_digest" char(64) NOT NULL,
  "state" "RecommendationEpisodeState" NOT NULL DEFAULT 'pending',
  "capability_jti" varchar(191),
  "signing_kid" varchar(64),
  "active_until" timestamptz NOT NULL,
  "hard_until" timestamptz NOT NULL,
  "finalization_due_at" timestamptz,
  "next_fact_sequence" integer NOT NULL DEFAULT 1,
  "generation" integer NOT NULL DEFAULT 1,
  "claimed_at" timestamptz,
  "finalized_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_episode_item_request_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_episode_selection_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "selection_id")
    REFERENCES "recommendation_selection"("request_id", "item_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_episode_selection_key" UNIQUE ("selection_id"),
  CONSTRAINT "recommendation_episode_selection_lineage_key" UNIQUE ("request_id", "item_id", "selection_id"),
  CONSTRAINT "recommendation_episode_request_item_id_key" UNIQUE ("request_id", "item_id", "id"),
  CONSTRAINT "recommendation_episode_capability_key" UNIQUE ("capability_jti"),
  CONSTRAINT "recommendation_episode_session_digest_check" CHECK ("session_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_episode_horizon_check" CHECK ("active_until" < "hard_until" AND "hard_until" <= "expires_at"),
  CONSTRAINT "recommendation_episode_sequence_check" CHECK ("next_fact_sequence" > 0),
  CONSTRAINT "recommendation_episode_generation_check" CHECK ("generation" > 0)
);
CREATE INDEX "recommendation_episode_state_deadline_idx" ON "recommendation_playback_episode"("state", "active_until");
CREATE INDEX "recommendation_episode_finalization_due_idx"
  ON "recommendation_playback_episode" ("finalization_due_at", "id")
  INCLUDE ("generation", "active_until", "expires_at")
  WHERE "finalization_due_at" IS NOT NULL;
CREATE INDEX "recommendation_playback_episode_expires_at_idx" ON "recommendation_playback_episode"("expires_at");
CREATE INDEX "recommendation_episode_request_idx" ON "recommendation_playback_episode"("request_id");

CREATE TABLE "recommendation_playback_fact" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "episode_id" text NOT NULL,
  "capability_jti" varchar(191) NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "payload_digest" char(64) NOT NULL,
  "sequence" integer NOT NULL,
  "kind" varchar(64) NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "late" boolean NOT NULL DEFAULT false,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_fact_item_request_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_fact_episode_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "episode_id")
    REFERENCES "recommendation_playback_episode"("request_id", "item_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_fact_episode_event_key" UNIQUE ("episode_id", "event_id"),
  CONSTRAINT "recommendation_fact_episode_sequence_key" UNIQUE ("episode_id", "sequence"),
  CONSTRAINT "recommendation_fact_digest_check" CHECK ("payload_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_fact_sequence_check" CHECK ("sequence" > 0)
);
CREATE INDEX "recommendation_fact_request_received_idx" ON "recommendation_playback_fact"("request_id", "received_at");
CREATE INDEX "recommendation_playback_fact_expires_at_idx" ON "recommendation_playback_fact"("expires_at");

CREATE TABLE "recommendation_outcome_revision" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "episode_id" text NOT NULL,
  "classifier_version" varchar(64) NOT NULL,
  "fact_watermark" integer NOT NULL,
  "input_digest" char(64) NOT NULL,
  "revision" integer NOT NULL,
  "supersedes_id" text,
  "qualified_view" boolean NOT NULL,
  "view_quality_weight" double precision,
  "view_quality_weight_reason" varchar(64),
  "reasons" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "learning_eligible" boolean NOT NULL DEFAULT false,
  "generation" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_outcome_item_request_fkey"
    FOREIGN KEY ("request_id", "item_id")
    REFERENCES "recommendation_served_item"("request_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_outcome_episode_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "episode_id")
    REFERENCES "recommendation_playback_episode"("request_id", "item_id", "id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_outcome_supersedes_lineage_fkey"
    FOREIGN KEY ("request_id", "item_id", "episode_id", "supersedes_id")
    REFERENCES "recommendation_outcome_revision"("request_id", "item_id", "episode_id", "id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_outcome_supersedes_key" UNIQUE ("supersedes_id"),
  CONSTRAINT "recommendation_outcome_supersedes_lineage_key" UNIQUE ("request_id", "item_id", "episode_id", "supersedes_id"),
  CONSTRAINT "recommendation_outcome_lineage_id_key" UNIQUE ("request_id", "item_id", "episode_id", "id"),
  CONSTRAINT "recommendation_outcome_episode_revision_key" UNIQUE ("episode_id", "revision"),
  CONSTRAINT "recommendation_outcome_input_key" UNIQUE ("episode_id", "classifier_version", "fact_watermark", "input_digest"),
  CONSTRAINT "recommendation_outcome_digest_check" CHECK ("input_digest" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "recommendation_outcome_revision_check" CHECK ("revision" > 0 AND "fact_watermark" >= 0 AND "generation" > 0),
  CONSTRAINT "recommendation_outcome_learning_check" CHECK ("learning_eligible" = false),
  CONSTRAINT "recommendation_legacy_weight_check" CHECK (
    "classifier_version" <> 'legacy-position-v0'
    OR ("view_quality_weight" IS NULL AND "view_quality_weight_reason" = 'continuous_weight_not_available')
  )
);
CREATE INDEX "recommendation_outcome_revision_expires_at_idx" ON "recommendation_outcome_revision"("expires_at");
CREATE INDEX "recommendation_outcome_request_idx" ON "recommendation_outcome_revision"("request_id");

CREATE TABLE "recommendation_evidence_audit" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "kind" "RecommendationAuditKind" NOT NULL,
  "reason_code" varchar(64) NOT NULL,
  "count" integer NOT NULL DEFAULT 1,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_evidence_audit_count_check" CHECK ("count" BETWEEN 1 AND 2147483647)
);
CREATE INDEX "recommendation_audit_kind_occurred_idx" ON "recommendation_evidence_audit"("kind", "occurred_at");
CREATE INDEX "recommendation_evidence_audit_expires_at_idx" ON "recommendation_evidence_audit"("expires_at");
CREATE INDEX "recommendation_audit_request_idx" ON "recommendation_evidence_audit"("request_id");

CREATE TABLE "recommendation_conflict" (
  "id" text PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "capability_jti" varchar(191) NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "accepted_payload_digest" char(64) NOT NULL,
  "rejected_payload_digest" char(64) NOT NULL,
  "attempts" integer NOT NULL DEFAULT 1,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_conflict_identity_key" UNIQUE ("capability_jti", "event_id"),
  CONSTRAINT "recommendation_conflict_digest_check" CHECK (
    "accepted_payload_digest" ~ '^[a-f0-9]{64}$'
    AND "rejected_payload_digest" ~ '^[a-f0-9]{64}$'
    AND "accepted_payload_digest" <> "rejected_payload_digest"
  ),
  CONSTRAINT "recommendation_conflict_attempts_check" CHECK ("attempts" BETWEEN 1 AND 1000)
);
CREATE INDEX "recommendation_conflict_request_seen_idx" ON "recommendation_conflict"("request_id", "last_seen_at");
CREATE INDEX "recommendation_conflict_expires_at_idx" ON "recommendation_conflict"("expires_at");

CREATE TABLE "recommendation_capability_submission_budget" (
  "capability_jti" varchar(191) PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  "attempts" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_capability_submission_attempts_check" CHECK ("attempts" BETWEEN 1 AND 256)
);
CREATE INDEX "recommendation_capability_submission_budget_expires_at_idx"
ON "recommendation_capability_submission_budget"("expires_at");
CREATE INDEX "recommendation_capability_submission_budget_request_idx"
ON "recommendation_capability_submission_budget"("request_id");

CREATE TABLE "recommendation_retention_run" (
  "id" text PRIMARY KEY,
  "status" "RecommendationRetentionRunStatus" NOT NULL DEFAULT 'running',
  "batch_size" integer NOT NULL,
  "roots_deleted" integer NOT NULL DEFAULT 0,
  "row_counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "oldest_expired_at_after" timestamptz,
  "reason_code" varchar(64),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_retention_batch_check" CHECK ("batch_size" BETWEEN 1 AND 5000),
  CONSTRAINT "recommendation_retention_roots_check" CHECK ("roots_deleted" >= 0)
);
CREATE INDEX "recommendation_retention_status_completed_idx" ON "recommendation_retention_run"("status", "completed_at");
CREATE INDEX "recommendation_retention_run_expires_at_idx" ON "recommendation_retention_run"("expires_at");

CREATE TABLE "recommendation_trace_access_audit" (
  "id" text PRIMARY KEY,
  "request_id" text REFERENCES "recommendation_request"("id") ON DELETE SET NULL,
  "actor_digest" char(64) NOT NULL CHECK ("actor_digest" ~ '^[a-f0-9]{64}$'),
  "reason_code" varchar(64) NOT NULL,
  "accessed_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL
);
CREATE INDEX "recommendation_trace_access_audit_request_id_idx" ON "recommendation_trace_access_audit"("request_id");
CREATE INDEX "recommendation_trace_access_audit_expires_at_idx" ON "recommendation_trace_access_audit"("expires_at");

-- The request root owns immutable raw retention. Every child insertion/update
-- must carry exactly the root expires_at; a late writer cannot extend it.
CREATE FUNCTION "enforce_recommendation_root_expiry"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE root_expiry timestamptz;
BEGIN
  SELECT "expires_at" INTO root_expiry
  FROM "recommendation_request"
  WHERE "id" = NEW."request_id";
  IF root_expiry IS NULL OR NEW."expires_at" <> root_expiry THEN
    RAISE EXCEPTION 'recommendation child expiry must match request root';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recommendation_served_item', 'recommendation_rendered_fact',
    'recommendation_impression', 'recommendation_selection',
    'recommendation_playback_episode', 'recommendation_playback_fact',
    'recommendation_outcome_revision', 'recommendation_evidence_audit',
    'recommendation_conflict',
    'recommendation_capability_submission_budget'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE OF expires_at, request_id ON %I FOR EACH ROW EXECUTE FUNCTION enforce_recommendation_root_expiry()',
      table_name || '_root_expiry_guard', table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION "guard_recommendation_request_expiry"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."expires_at" <> OLD."expires_at" OR NEW."generation" <> OLD."generation" THEN
    RAISE EXCEPTION 'recommendation request lifecycle is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_request_lifecycle_guard"
BEFORE UPDATE ON "recommendation_request"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_request_expiry"();

CREATE FUNCTION "guard_recommendation_handoff_claim"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."claimed_at" IS NOT NULL AND NEW."claimed_at" IS DISTINCT FROM OLD."claimed_at" THEN
    RAISE EXCEPTION 'recommendation handoff is one use';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "recommendation_selection_claim_guard"
BEFORE UPDATE ON "recommendation_selection"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_handoff_claim"();

CREATE FUNCTION "guard_recommendation_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'recommendation fact/revision is append only';
END;
$$;
CREATE TRIGGER "recommendation_playback_fact_append_only_guard"
BEFORE UPDATE ON "recommendation_playback_fact"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_append_only"();
CREATE TRIGGER "recommendation_outcome_revision_append_only_guard"
BEFORE UPDATE ON "recommendation_outcome_revision"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_append_only"();

-- Deferred commit-time completeness: a prepared request cannot escape its
-- transaction with a partial/non-contiguous item set.
CREATE FUNCTION "check_recommendation_request_items_complete"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_request_id text;
DECLARE target_request_ids text[];
DECLARE expected_count integer;
DECLARE actual_count integer;
DECLARE min_position integer;
DECLARE max_position integer;
BEGIN
  IF TG_TABLE_NAME = 'recommendation_request' THEN
    target_request_ids := ARRAY[NEW."id"];
  ELSIF TG_OP = 'DELETE' THEN
    target_request_ids := ARRAY[OLD."request_id"];
  ELSIF TG_OP = 'UPDATE' AND OLD."request_id" IS DISTINCT FROM NEW."request_id" THEN
    target_request_ids := ARRAY[OLD."request_id", NEW."request_id"];
  ELSE
    target_request_ids := ARRAY[NEW."request_id"];
  END IF;

  FOREACH target_request_id IN ARRAY target_request_ids LOOP
    SELECT "expected_item_count" INTO expected_count
    FROM "recommendation_request" WHERE "id" = target_request_id;
    CONTINUE WHEN expected_count IS NULL;
    SELECT count(*), min("position"), max("position")
    INTO actual_count, min_position, max_position
    FROM "recommendation_served_item" WHERE "request_id" = target_request_id;
    IF actual_count <> expected_count
      OR (expected_count > 0 AND (min_position <> 0 OR max_position <> expected_count - 1)) THEN
      RAISE EXCEPTION 'recommendation request item set is incomplete';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "recommendation_request_items_complete_guard"
AFTER INSERT OR UPDATE OF "expected_item_count" ON "recommendation_request"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_recommendation_request_items_complete"();
CREATE CONSTRAINT TRIGGER "recommendation_item_set_complete_guard"
AFTER INSERT OR UPDATE OR DELETE ON "recommendation_served_item"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "check_recommendation_request_items_complete"();

-- One bounded conflict row under concurrent mismatched replay.
CREATE FUNCTION "upsert_recommendation_conflict"(
  conflict_id text,
  root_request_id text,
  token_jti varchar(191),
  browser_event_id varchar(191),
  accepted_digest char(64),
  rejected_digest char(64),
  root_expires_at timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE next_attempts integer;
BEGIN
  INSERT INTO "recommendation_conflict" (
    "id", "request_id", "capability_jti", "event_id",
    "accepted_payload_digest", "rejected_payload_digest", "expires_at"
  ) VALUES (
    conflict_id, root_request_id, token_jti, browser_event_id,
    accepted_digest, rejected_digest, root_expires_at
  )
  ON CONFLICT ("capability_jti", "event_id") DO UPDATE
  SET "attempts" = LEAST("recommendation_conflict"."attempts" + 1, 1000),
      "last_seen_at" = now()
  RETURNING "attempts" INTO next_attempts;
  RETURN next_attempts;
END;
$$;

-- Fixed event-attempt budget shared by render, impression, and selection for
-- one delivery capability. The conditional upsert is one atomic operation, so
-- concurrent clients and fresh event ids cannot exceed the 32-attempt bound.
CREATE FUNCTION "consume_recommendation_capability_submissions"(
  root_request_id text,
  token_jti varchar(191),
  submission_attempts integer,
  submission_limit integer,
  root_expires_at timestamptz
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE next_attempts integer;
BEGIN
  IF submission_attempts < 1 OR submission_limit <> 32 THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "recommendation_served_item"
    WHERE "request_id" = root_request_id
      AND "capability_jti" = token_jti
      AND "expires_at" = root_expires_at
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "recommendation_capability_submission_budget" (
    "capability_jti", "request_id", "attempts", "expires_at"
  ) VALUES (
    token_jti, root_request_id, submission_attempts, root_expires_at
  )
  ON CONFLICT ("capability_jti") DO UPDATE
  SET "attempts" = "recommendation_capability_submission_budget"."attempts" + submission_attempts,
      "updated_at" = now()
  WHERE "recommendation_capability_submission_budget"."request_id" = root_request_id
    AND "recommendation_capability_submission_budget"."expires_at" = root_expires_at
    AND "recommendation_capability_submission_budget"."attempts" + submission_attempts <= submission_limit
  RETURNING "attempts" INTO next_attempts;
  IF next_attempts IS NULL THEN
    INSERT INTO "recommendation_evidence_audit" (
      "id", "request_id", "kind", "reason_code", "count", "expires_at"
    ) VALUES (
      'delivery-submission-budget:' || token_jti,
      root_request_id,
      'committed_rejection',
      'delivery_submission_budget_exceeded',
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
      AND "recommendation_evidence_audit"."reason_code" = 'delivery_submission_budget_exceeded';
  END IF;
  RETURN next_attempts;
END;
$$;

-- Episode capabilities accept at most 128 durable facts. Allow one retry per
-- fact while bounding replay/conflict amplification independently of event id.
CREATE FUNCTION "consume_recommendation_episode_capability_submissions"(
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
      AND "request_id" = root_request_id
      AND "capability_jti" = token_jti
      AND "expires_at" = root_expires_at
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO "recommendation_capability_submission_budget" (
    "capability_jti", "request_id", "attempts", "expires_at"
  ) VALUES (
    token_jti, root_request_id, submission_attempts, root_expires_at
  )
  ON CONFLICT ("capability_jti") DO UPDATE
  SET "attempts" = "recommendation_capability_submission_budget"."attempts" + submission_attempts,
      "updated_at" = now()
  WHERE "recommendation_capability_submission_budget"."request_id" = root_request_id
    AND "recommendation_capability_submission_budget"."expires_at" = root_expires_at
    AND "recommendation_capability_submission_budget"."attempts" + submission_attempts <= submission_limit
  RETURNING "attempts" INTO next_attempts;
  IF next_attempts IS NULL THEN
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

INSERT INTO "recommendation_strategy_manifest" (
  "id", "strategy_version", "contract_version", "surface_version",
  "generator", "max_items", "configuration", "enabled"
) VALUES (
  'semantic-transcript-pgvector-v1',
  'semantic-transcript-pgvector-v1',
  'semantic-recommendation-v1',
  'watch-below-player-v1',
  'semantic',
  6,
  '{"retriever":"sceneRecommendations-compatible","learningReads":false}'::jsonb,
  true
) ON CONFLICT ("id") DO NOTHING;

INSERT INTO "recommendation_serving_control" (
  "id", "enabled", "manifest_id", "emergency_revoked_kids", "reason_code"
) VALUES (
  'recommendation-serving-control', false,
  'semantic-transcript-pgvector-v1', ARRAY[]::text[], 'bootstrap_disabled'
) ON CONFLICT ("id") DO NOTHING;
