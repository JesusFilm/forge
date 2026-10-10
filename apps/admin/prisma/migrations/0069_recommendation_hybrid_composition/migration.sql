-- Consent-aware hybrid semantic + profile recommendation contract.
-- Expand-only: old application versions ignore the additive columns and the
-- new immutable strategy. This migration grants no serving-control pointer,
-- experiment assignment, promotion pointer, or production exposure.

ALTER TABLE "recommendation_candidate_run"
  ADD COLUMN "requested_count" integer NOT NULL DEFAULT 6,
  ADD COLUMN "shortfall_reason" varchar(64);

ALTER TABLE "recommendation_candidate_run"
  ADD CONSTRAINT "recommendation_candidate_run_requested_count_check" CHECK (
    "requested_count" BETWEEN 0 AND 6
    AND "composed_count" <= "requested_count"
  ),
  ADD CONSTRAINT "recommendation_candidate_run_shortfall_check" CHECK (
    "shortfall_reason" IS NULL OR "shortfall_reason" IN (
      'insufficient_candidates',
      'seed_material_unavailable',
      'eligibility_exhausted',
      'deadline_exhausted'
    )
  );

ALTER TABLE "recommendation_personalization_decision"
  ADD COLUMN "execution_mode" varchar(32);

-- Historic profile_challenger rows deliberately retain NULL execution_mode.
-- That legacy assignment label described a profile-only slate and must never
-- be reinterpreted as evidence that the hybrid strategy executed.
ALTER TABLE "recommendation_personalization_decision"
  ADD CONSTRAINT "recommendation_personalization_execution_mode_check" CHECK (
    "execution_mode" IS NULL OR
    ("lane" = 'semantic_control' AND "execution_mode" = 'semantic_contextual') OR
    ("lane" = 'profile_challenger' AND "execution_mode" = 'hybrid_personalized') OR
    ("lane" = 'semantic_fallback' AND "execution_mode" = 'semantic_fallback')
  );

INSERT INTO "recommendation_strategy_manifest" (
  "id", "strategy_version", "contract_version", "surface_version",
  "generator", "max_items", "configuration", "enabled"
) VALUES (
  'semantic-profile-hybrid-v1',
  'semantic-profile-hybrid-v1',
  'semantic-recommendation-v1',
  'watch-below-player-v1',
  'hybrid',
  6,
  '{
    "context":"recommendation-context-v1",
    "generators":[
      {"generator":"semantic","version":"semantic-transcript-candidate-v1"},
      {"generator":"multi-interest-profile","version":"multi-interest-profile-candidate-v1"}
    ],
    "profileProjection":"multi-interest-profile-projection-v1",
    "profileClustering":"deterministic-farthest-first-medoids-v1",
    "union":"canonical-video-union-v1",
    "eligibility":"watch-playable-locale-v1",
    "ranker":"source-rank-hybrid-ranker-v1",
    "rankerFormula":"rrf-k60-primary-plus-5-percent-secondary-v1",
    "composer":"recent-video-refill-composer-v1",
    "fallbackManifestId":"semantic-transcript-pgvector-v1",
    "shadowDecisionRequired":"promote_to_experiment",
    "completeServiceDeadlineMs":1500,
    "learningReads":"published-projections-only"
  }'::jsonb,
  true
) ON CONFLICT ("id") DO NOTHING;

COMMENT ON COLUMN "recommendation_candidate_run"."requested_count" IS
  'Bounded requested slate size. Together with composed_count and shortfall_reason it records truthful fill without synthetic duplicates.';
COMMENT ON COLUMN "recommendation_personalization_decision"."execution_mode" IS
  'Actual execution shape. Nullable for historic rows; lane remains immutable experiment-assignment truth.';
COMMENT ON TABLE "recommendation_candidate_stage_evidence" IS
  'Bounded request-owned nomination, canonicalization, scoring, ordering, suppression/refill, and composition evidence. Source arrays contain generator provenance only, never cookies, profile/session ids, histories, or vectors.';
