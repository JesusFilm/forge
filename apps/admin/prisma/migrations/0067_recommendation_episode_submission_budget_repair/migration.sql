-- Repair databases that applied the original 0052 recommendation migration
-- before the episode-scoped atomic submission budget function was added.
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
