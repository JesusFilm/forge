-- feat-459: make published profile lineage reconcilable without rewriting
-- immutable evidence or existing projection generations. This migration is
-- expand-only; it creates no eligibility decisions and performs no repair.

ALTER TYPE "RecommendationEligibilitySourceType" ADD VALUE IF NOT EXISTS 'selection';

ALTER TABLE "recommendation_eligibility_decision"
  ADD COLUMN "selection_id" text,
  ADD COLUMN "input_digest" char(64),
  ADD COLUMN "evidence_watermark" timestamptz;

-- Existing rows retain their verdict exactly. The compatibility digest only
-- gives them a stable revision identity until source evidence is classified
-- again by the complete envelope introduced with this feature.
UPDATE "recommendation_eligibility_decision"
SET "input_digest" = md5(
      concat_ws(E'\x1f', "source_type"::text, "source_key", "policy_version",
        "revision"::text, "state"::text, array_to_string("reason_codes", ','),
        array_to_string("eligible_scopes", ','), "decided_at"::text)
    ) || md5(
      concat_ws(E'\x1f', 'eligibility-v2', "source_key", "policy_version",
        "revision"::text, "expires_at"::text)
    )
WHERE "input_digest" IS NULL;

ALTER TABLE "recommendation_eligibility_decision"
  ALTER COLUMN "input_digest" SET NOT NULL,
  DROP CONSTRAINT "recommendation_eligibility_source_check",
  ADD CONSTRAINT "recommendation_eligibility_source_check" CHECK (
    ("source_type"::text = 'playback_outcome'
      AND "outcome_id" IS NOT NULL
      AND "content_action_id" IS NULL
      AND "selection_id" IS NULL)
    OR
    ("source_type"::text = 'content_action'
      AND "content_action_id" IS NOT NULL
      AND "outcome_id" IS NULL
      AND "selection_id" IS NULL)
    OR
    ("source_type"::text = 'selection'
      AND "selection_id" IS NOT NULL
      AND "outcome_id" IS NULL
      AND "content_action_id" IS NULL)
  ),
  ADD CONSTRAINT "recommendation_eligibility_input_digest_check" CHECK (
    "input_digest" ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT "recommendation_eligibility_watermark_check" CHECK (
    "evidence_watermark" IS NULL OR "evidence_watermark" <= "expires_at"
  ),
  ADD CONSTRAINT "recommendation_eligibility_selection_id_fkey"
    FOREIGN KEY ("selection_id") REFERENCES "recommendation_selection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "recommendation_eligibility_outcome_current_idx"
  ON "recommendation_eligibility_decision"("outcome_id", "is_current", "state")
  WHERE "outcome_id" IS NOT NULL;
CREATE INDEX "recommendation_eligibility_selection_current_idx"
  ON "recommendation_eligibility_decision"("selection_id", "is_current", "state")
  WHERE "selection_id" IS NOT NULL;

COMMENT ON COLUMN "recommendation_eligibility_decision"."input_digest" IS
  'SHA-256 identity of the bounded immutable classification envelope; exact replay returns the current revision.';
COMMENT ON COLUMN "recommendation_eligibility_decision"."evidence_watermark" IS
  'Newest committed source-evidence timestamp included in the classification envelope; no raw viewer identity.';

CREATE TABLE "recommendation_playback_transport_replay_receipt" (
  "id" text PRIMARY KEY,
  "episode_id" text NOT NULL,
  "capability_jti" varchar(191) NOT NULL,
  "event_id" varchar(191) NOT NULL,
  "payload_digest" char(64) NOT NULL,
  "replay_ordinal" integer NOT NULL,
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_transport_replay_episode_fkey"
    FOREIGN KEY ("episode_id")
    REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_transport_replay_episode_event_ordinal_key"
    UNIQUE ("episode_id", "event_id", "replay_ordinal"),
  CONSTRAINT "recommendation_transport_replay_digest_check" CHECK (
    "payload_digest" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "recommendation_transport_replay_ordinal_check" CHECK (
    "replay_ordinal" BETWEEN 1 AND 256
  ),
  CONSTRAINT "recommendation_transport_replay_window_check" CHECK (
    "observed_at" <= "expires_at"
  )
);

CREATE INDEX "recommendation_transport_replay_episode_observed_idx"
  ON "recommendation_playback_transport_replay_receipt"("episode_id", "observed_at");
CREATE INDEX "recommendation_transport_replay_expiry_idx"
  ON "recommendation_playback_transport_replay_receipt"("expires_at");

CREATE FUNCTION "guard_recommendation_transport_replay_receipt"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE episode_expiry timestamptz;
BEGIN
  SELECT episode."expires_at" INTO episode_expiry
  FROM "recommendation_playback_episode" episode
  WHERE episode."id" = NEW."episode_id";

  IF episode_expiry IS NULL OR NEW."expires_at" > episode_expiry THEN
    RAISE EXCEPTION 'transport replay receipt cannot outlive playback episode';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "recommendation_playback_fact" fact
    WHERE fact."episode_id" = NEW."episode_id"
      AND fact."capability_jti" = NEW."capability_jti"
      AND fact."event_id" = NEW."event_id"
      AND fact."payload_digest" = NEW."payload_digest"
  ) THEN
    RAISE EXCEPTION 'transport replay receipt requires an accepted playback fact';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'transport replay receipts are append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "recommendation_transport_replay_receipt_guard"
BEFORE INSERT OR UPDATE
ON "recommendation_playback_transport_replay_receipt"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_transport_replay_receipt"();

COMMENT ON TABLE "recommendation_playback_transport_replay_receipt" IS
  'Purpose: exact transport-retry attribution. Identity: private episode-scoped pseudonymous proof, never Admin output. Retention and deletion: expires no later than and cascades with the playback episode. Access: playback writes; integrity and aggregate reconciliation read. Ingestion health: accepted-fact trigger plus the 256-attempt capability budget. Fallback and rollback: missing proof fails closed; readers must roll back before this additive table is removed.';

ALTER TABLE "recommendation_profile_projection_contribution"
  ADD COLUMN "source_eligibility_decision_id" text,
  ADD COLUMN "source_eligibility_revision" integer,
  ADD CONSTRAINT "recommendation_profile_contribution_eligibility_fkey"
    FOREIGN KEY ("source_eligibility_decision_id")
    REFERENCES "recommendation_eligibility_decision"("id") ON DELETE SET NULL,
  ADD CONSTRAINT "recommendation_profile_contribution_eligibility_revision_check" CHECK (
    ("source_eligibility_decision_id" IS NULL AND "source_eligibility_revision" IS NULL)
    OR
    ("source_eligibility_decision_id" IS NOT NULL AND "source_eligibility_revision" >= 1)
  );

CREATE INDEX "recommendation_profile_contribution_eligibility_idx"
  ON "recommendation_profile_projection_contribution"(
    "source_eligibility_decision_id", "source_eligibility_revision"
  );

COMMENT ON COLUMN "recommendation_profile_projection_contribution"."source_eligibility_decision_id" IS
  'Exact append-only eligibility revision used by this immutable projection contribution; null legacy lineage fails closed at serving.';

ALTER TABLE "recommendation_profile_projection_run"
  ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0,
  ADD COLUMN "lease_expires_at" timestamptz,
  ADD COLUMN "last_transition_reason" varchar(64),
  ADD COLUMN "reconciliation_cause" varchar(64) NOT NULL DEFAULT 'projection_request',
  ADD COLUMN "expected_pointer_generation" integer,
  ADD COLUMN "expected_generation_id" text;

ALTER TABLE "recommendation_profile_projection_run"
  DROP CONSTRAINT "recommendation_profile_projection_run_scope_check",
  ADD CONSTRAINT "recommendation_profile_projection_run_scope_check" CHECK (
    ("scope" = 'durable' AND "profile_id" IS NOT NULL
      AND "privacy_generation" > 0)
    OR
    ("scope" = 'session' AND "profile_id" IS NULL
      AND "privacy_generation" IS NULL AND "session_digest" IS NOT NULL)
  );

UPDATE "recommendation_profile_projection_run"
SET "attempt_count" = 1,
    "lease_expires_at" = coalesce("heartbeat_at", "claimed_at", now()) + interval '5 minutes',
    "last_transition_reason" = 'legacy_claim_migrated'
WHERE "state" = 'claimed';

ALTER TABLE "recommendation_profile_projection_run"
  DROP CONSTRAINT "recommendation_profile_projection_run_claim_check",
  ADD CONSTRAINT "recommendation_profile_projection_run_claim_check" CHECK (
    ("state" = 'claimed'
      AND "claim_id" IS NOT NULL
      AND "claimed_at" IS NOT NULL
      AND "heartbeat_at" IS NOT NULL
      AND "lease_expires_at" IS NOT NULL
      AND "lease_expires_at" > "heartbeat_at"
      AND "attempt_count" BETWEEN 1 AND 3)
    OR "state" <> 'claimed'
  ),
  ADD CONSTRAINT "recommendation_profile_projection_run_attempt_check" CHECK (
    "attempt_count" BETWEEN 0 AND 3
  ),
  ADD CONSTRAINT "recommendation_profile_projection_run_expected_pointer_check" CHECK (
    ("expected_pointer_generation" IS NULL AND "expected_generation_id" IS NULL)
    OR
    ("expected_pointer_generation" = 0 AND "expected_generation_id" IS NULL)
    OR
    ("expected_pointer_generation" >= 1 AND "expected_generation_id" IS NOT NULL)
  );

DROP INDEX "recommendation_profile_projection_run_claim_idx";
CREATE INDEX "recommendation_profile_projection_run_lease_idx"
  ON "recommendation_profile_projection_run"(
    "state", "lease_expires_at", "attempt_count"
  );

COMMENT ON COLUMN "recommendation_profile_projection_run"."reconciliation_cause" IS
  'Bounded operational cause code. It contains no profile, session, source, or request identifier.';
COMMENT ON COLUMN "recommendation_profile_projection_run"."lease_expires_at" IS
  'Five-minute claim lease fenced by claim_id and generation; expired work may be atomically reclaimed up to three attempts.';
COMMENT ON COLUMN "recommendation_profile_projection_run"."expected_pointer_generation" IS
  'Compare-and-swap fence: 0 means the pointer must still be absent; null is reserved for legacy runs without pointer evidence.';
