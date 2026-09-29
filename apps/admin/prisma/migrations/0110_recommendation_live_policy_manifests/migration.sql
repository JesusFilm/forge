-- Exact static execution definitions only; no enrollment, approval or serving pointer.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '2s';
INSERT INTO recommendation_strategy_manifest
  (id, strategy_version, contract_version, surface_version, generator, max_items, configuration, enabled)
VALUES
  ('hybrid-profile-viewing-mode-v1', 'hybrid-profile-viewing-mode-v1', 'semantic-recommendation-v1', 'watch-below-player-v1', 'hybrid', 6, '{"context":"recommendation-context-v1","generators":[{"generator":"semantic","version":"semantic-transcript-candidate-v1"},{"generator":"multi-interest-profile","version":"multi-interest-profile-candidate-v1"}],"profileProjection":"multi-interest-profile-projection-v1","profileClustering":"deterministic-farthest-first-medoids-v1","union":"canonical-video-union-v1","eligibility":"watch-playable-locale-v1","ranker":"source-rank-hybrid-ranker-v1","rankerFormula":"rrf-k60-primary-plus-5-percent-secondary-v1","composer":"recent-video-refill-composer-v1","fallbackManifestId":"semantic-transcript-pgvector-v1","shadowDecisionRequired":"promote_to_experiment","completeServiceDeadlineMs":1500,"learningReads":"published-projections-only","executionPolicy":"profile-viewing-mode-incumbent-v1","viewingModeProjection":"sound-off-viewing-v1","viewingModeRanker":"viewing-mode-affinity-v1","viewingModeFallback":"ordinary-relevance-if-unavailable","operationalFallback":{"effectiveManifestId":"hybrid-profile-viewing-mode-v1","reasonCode":"incumbent_operational_fallback","executionModes":["hybrid_personalized","viewing_mode_personalized","semantic_fallback","curated_fallback"],"results":["fallback","empty"],"semanticGenerator":"semantic-transcript-candidate-v1","curatedGenerator":"seeded-curated-empty-fallback-v1","curatedRanker":"source-rank-hybrid-ranker-v1","curatedInventory":"approved-locale-audio-pool-only","eligibility":"watch-playable-locale-v1"},"nominationBudgets":{"maximum":64,"semantic":36,"profile":"remaining-capacity","interleave":"semantic-profile-v1"}}'::jsonb, true),
  ('hybrid-profile-viewing-mode-aa-v1', 'hybrid-profile-viewing-mode-aa-v1', 'semantic-recommendation-v1', 'watch-below-player-v1', 'hybrid', 6, '{"context":"recommendation-context-v1","generators":[{"generator":"semantic","version":"semantic-transcript-candidate-v1"},{"generator":"multi-interest-profile","version":"multi-interest-profile-candidate-v1"}],"profileProjection":"multi-interest-profile-projection-v1","profileClustering":"deterministic-farthest-first-medoids-v1","union":"canonical-video-union-v1","eligibility":"watch-playable-locale-v1","ranker":"source-rank-hybrid-ranker-v1","rankerFormula":"rrf-k60-primary-plus-5-percent-secondary-v1","composer":"recent-video-refill-composer-v1","fallbackManifestId":"semantic-transcript-pgvector-v1","shadowDecisionRequired":"promote_to_experiment","completeServiceDeadlineMs":1500,"learningReads":"published-projections-only","executionPolicy":"profile-viewing-mode-incumbent-v1","viewingModeProjection":"sound-off-viewing-v1","viewingModeRanker":"viewing-mode-affinity-v1","viewingModeFallback":"ordinary-relevance-if-unavailable","operationalFallback":{"effectiveManifestId":"hybrid-profile-viewing-mode-v1","reasonCode":"incumbent_operational_fallback","executionModes":["hybrid_personalized","viewing_mode_personalized","semantic_fallback","curated_fallback"],"results":["fallback","empty"],"semanticGenerator":"semantic-transcript-candidate-v1","curatedGenerator":"seeded-curated-empty-fallback-v1","curatedRanker":"source-rank-hybrid-ranker-v1","curatedInventory":"approved-locale-audio-pool-only","eligibility":"watch-playable-locale-v1"},"nominationBudgets":{"maximum":64,"semantic":36,"profile":"remaining-capacity","interleave":"semantic-profile-v1"},"behaviorallyEquivalentTo":"hybrid-profile-viewing-mode-v1"}'::jsonb, true),
  ('hybrid-profile-viewing-mode-cowatch-mmr-v1', 'hybrid-profile-viewing-mode-cowatch-mmr-v1', 'semantic-recommendation-v1', 'watch-below-player-v1', 'hybrid', 6, '{"context":"recommendation-context-v1","generators":[{"generator":"semantic","version":"semantic-transcript-candidate-v1"},{"generator":"multi-interest-profile","version":"multi-interest-profile-candidate-v1"},{"generator":"directional-cowatch","version":"directional-cowatch-shadow-v1"}],"profileProjection":"multi-interest-profile-projection-v1","profileClustering":"deterministic-farthest-first-medoids-v1","union":"canonical-video-union-v1","eligibility":"watch-playable-locale-v1","ranker":"source-rank-hybrid-ranker-v1","rankerFormula":"rrf-k60-primary-plus-5-percent-secondary-v1","composer":"source-interest-theme-mmr-v1","fallbackManifestId":"hybrid-profile-viewing-mode-v1","shadowDecisionRequired":"promote_to_experiment","completeServiceDeadlineMs":1500,"learningReads":"published-projections-only","executionPolicy":"profile-viewing-mode-cowatch-mmr-trial-v1","viewingModeProjection":"sound-off-viewing-v1","viewingModeRanker":"viewing-mode-affinity-v1","viewingModeFallback":"ordinary-relevance-if-unavailable","operationalFallback":{"effectiveManifestId":"hybrid-profile-viewing-mode-v1","reasonCode":"cowatch_mmr_incumbent_fallback","executionModes":["hybrid_personalized","viewing_mode_personalized","semantic_fallback","curated_fallback"],"results":["fallback","empty"],"semanticGenerator":"semantic-transcript-candidate-v1","curatedGenerator":"seeded-curated-empty-fallback-v1","curatedRanker":"source-rank-hybrid-ranker-v1","curatedInventory":"approved-locale-audio-pool-only","eligibility":"watch-playable-locale-v1"},"nominationBudgets":{"maximum":64,"semantic":36,"cowatch":12,"profile":"remaining-capacity","interleave":"semantic-profile-cowatch-v1"},"generatorSet":"semantic-profile-cowatch-generators-v1","composition":{"composerVersion":"source-interest-theme-mmr-v1","weights":{"relevance":0.75,"themeSimilarity":-0.2,"source":0.025,"interest":0.025},"candidateLimit":64,"positionLimit":6,"supportedInputs":["source","interest","theme","recent_history"],"excludedInputs":["editorial_adapter","series","speaker"],"history":"request_window_reconstruction","missingInputDisposition":"deterministic_fallback"},"graphPolicy":"frozen-source-controlled-trial-v1","effectAttribution":"combined-cowatch-and-mmr-only","shadowPopulation":{"samplingVersion":"stable-durable-en-request-hash-v1","requestState":"issued","locale":"en","audioLanguageSlug":"english","profile":"current-active-durable-generation","projection":"published-unexpired-durable-positive-interests","eligibilityTiming":"before-stable-hash-sampling"}}'::jsonb, true);

ALTER TABLE recommendation_personalization_decision
  DROP CONSTRAINT recommendation_personalization_execution_mode_check;
ALTER TABLE recommendation_personalization_decision
  ADD CONSTRAINT recommendation_personalization_execution_mode_check CHECK (
    execution_mode IS NULL OR
    (lane = 'semantic_control' AND execution_mode = 'semantic_contextual') OR
    (lane = 'profile_challenger' AND execution_mode IN
      ('hybrid_personalized', 'viewing_mode_personalized', 'cowatch_mmr_personalized')) OR
    (lane = 'semantic_fallback' AND execution_mode IN ('semantic_fallback', 'curated_fallback'))
  ) NOT VALID;
ALTER TABLE recommendation_personalization_decision
  DROP CONSTRAINT recommendation_personalization_projection_check;
ALTER TABLE recommendation_personalization_decision
  ADD CONSTRAINT recommendation_personalization_projection_check CHECK (
    (lane = 'profile_challenger'
      AND projection_scope IN ('session', 'durable')
      AND projection_version IS NOT NULL AND projection_generation_number > 0
      AND interest_count BETWEEN 1 AND 5
      AND (reason_code IS NULL
        OR (execution_mode IS NOT NULL AND execution_mode = 'viewing_mode_personalized' AND reason_code = 'viewing_mode_preference')
        OR (
        effective_manifest_id = 'hybrid-profile-viewing-mode-v1'
        AND execution_mode IS NOT NULL AND execution_mode IN ('hybrid_personalized', 'viewing_mode_personalized')
        AND reason_code IN ('incumbent_operational_fallback', 'cowatch_mmr_incumbent_fallback')
      )))
    OR (lane = 'profile_challenger' AND execution_mode = 'viewing_mode_personalized'
      AND projection_scope = 'durable' AND projection_generation_id IS NULL
      AND projection_version IS NULL AND projection_generation_number IS NULL
      AND interest_count = 0 AND reason_code IS NOT NULL
      AND (reason_code = 'viewing_mode_preference' OR (
        effective_manifest_id = 'hybrid-profile-viewing-mode-v1'
        AND reason_code IN ('incumbent_operational_fallback', 'cowatch_mmr_incumbent_fallback')
      )))
    OR (lane IN ('semantic_control', 'semantic_fallback')
      AND projection_generation_id IS NULL AND projection_scope IS NULL
      AND projection_version IS NULL AND projection_generation_number IS NULL
      AND interest_count = 0)
  ) NOT VALID;
COMMIT;

-- Release the metadata transaction's ACCESS EXCLUSIVE lock before scanning.
-- NOT VALID still checks all new/updated rows; the former validated constraints
-- imply these additive checks for existing rows. Validation takes SHARE UPDATE
-- EXCLUSIVE, which permits ordinary INSERT/UPDATE/DELETE traffic.
-- If a bounded validation times out after metadata committed, inspect both
-- pg_constraint.convalidated flags and run only the remaining VALIDATE below.
-- Recovery belongs to the normal migration deployer: verify the exact applied
-- metadata and migration checksum, retry only outstanding validations, then
-- resolve the failed migration only after both flags are true. Never replay
-- INSERT/metadata or bypass failed validation.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE recommendation_personalization_decision
  VALIDATE CONSTRAINT recommendation_personalization_execution_mode_check;
COMMIT;
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE recommendation_personalization_decision
  VALIDATE CONSTRAINT recommendation_personalization_projection_check;
COMMIT;
