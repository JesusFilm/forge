-- U2 expands immutable outcomes so legacy-position-v0 and
-- active-watch-proxy-v1 keep independent, append-only revision chains.
ALTER TABLE "recommendation_outcome_revision"
  ADD COLUMN "active_playback_milliseconds" integer,
  ADD COLUMN "duration_seconds" double precision,
  ADD COLUMN "duration_cohort" varchar(16),
  ADD COLUMN "active_coverage" varchar(16);

ALTER TABLE "recommendation_outcome_revision"
  DROP CONSTRAINT "recommendation_outcome_episode_revision_key",
  ADD CONSTRAINT "recommendation_outcome_episode_classifier_revision_key"
    UNIQUE ("episode_id", "classifier_version", "revision"),
  ADD CONSTRAINT "recommendation_outcome_active_proxy_check" CHECK (
    "classifier_version" <> 'active-watch-proxy-v1'
    OR (
      "active_playback_milliseconds" IS NOT NULL
      AND "active_playback_milliseconds" >= 0
      AND ("duration_seconds" IS NULL OR "duration_seconds" > 0)
      AND "duration_cohort" IN ('short', 'medium', 'long', 'unknown')
      AND "active_coverage" IN ('complete', 'partial', 'missing')
      AND "view_quality_weight" IS NOT NULL
      AND "view_quality_weight" >= 0
      AND "view_quality_weight" <= 1
      AND "view_quality_weight_reason" IN (
        'active_fraction_of_duration',
        'active_time_against_30_seconds_without_duration'
      )
      AND "learning_eligible" = false
    )
  );

COMMENT ON COLUMN "recommendation_outcome_revision"."active_playback_milliseconds"
  IS 'Derived union of bounded observable foreground-playing intervals; never an attention claim.';
COMMENT ON COLUMN "recommendation_outcome_revision"."active_coverage"
  IS 'complete, partial, or missing measurement coverage for active-watch-proxy-v1.';
