-- Keep operational navigation selections separate from attribution eligibility.
-- Only a committed visibility-qualified impression may advance this marker.
ALTER TABLE "recommendation_selection"
  ADD COLUMN "attribution_eligible_at" timestamptz,
  ADD CONSTRAINT "recommendation_selection_attribution_expiry_check"
    CHECK (
      "attribution_eligible_at" IS NULL
      OR "attribution_eligible_at" <= "expires_at"
    );

UPDATE "recommendation_selection" selection
SET "attribution_eligible_at" = GREATEST(
  selection."received_at",
  impression."received_at"
)
FROM "recommendation_impression" impression
WHERE impression."request_id" = selection."request_id"
  AND impression."item_id" = selection."item_id";

CREATE INDEX "recommendation_selection_attribution_idx"
  ON "recommendation_selection"("request_id", "attribution_eligible_at");

CREATE FUNCTION "guard_recommendation_selection_attribution"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD."attribution_eligible_at" IS NOT NULL
    AND NEW."attribution_eligible_at" IS DISTINCT FROM OLD."attribution_eligible_at"
  THEN
    RAISE EXCEPTION 'recommendation selection attribution is immutable once eligible';
  END IF;

  IF NEW."attribution_eligible_at" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM "recommendation_impression" impression
      WHERE impression."request_id" = NEW."request_id"
        AND impression."item_id" = NEW."item_id"
        AND impression."received_at" <= NEW."attribution_eligible_at"
    )
  THEN
    RAISE EXCEPTION 'recommendation selection attribution requires an eligible impression';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "recommendation_selection_attribution_guard"
BEFORE INSERT OR UPDATE OF "attribution_eligible_at"
ON "recommendation_selection"
FOR EACH ROW EXECUTE FUNCTION "guard_recommendation_selection_attribution"();

COMMENT ON COLUMN "recommendation_selection"."attribution_eligible_at"
  IS 'Commit watermark for CTR, experiment, promotion, and learning attribution; null selections remain navigation-only.';

-- Exact same-payload delivery replays are transport acknowledgement recovery,
-- not evidence-integrity velocity. Preserve their observability separately and
-- leave replay_count available for independently classified abusive behavior.
ALTER TABLE "recommendation_playback_episode"
  ADD COLUMN "transport_replay_count" integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT "recommendation_episode_transport_replay_count_check"
    CHECK ("transport_replay_count" BETWEEN 0 AND 1000);

UPDATE "recommendation_playback_episode"
SET "transport_replay_count" = "replay_count",
    "replay_count" = 0;

COMMENT ON COLUMN "recommendation_playback_episode"."transport_replay_count"
  IS 'Exact idempotent event re-deliveries after ambiguous transport acknowledgement; not an integrity conflict.';
