-- Owner-authorized direct release. Source retention and study contracts remain unchanged.
-- Empty authority table + inactive registry only; no approval or pointer activation.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;
CREATE TABLE recommendation_owner_release (
  id uuid PRIMARY KEY,
  pointer_generation integer NOT NULL CHECK (pointer_generation > 0),
  manifest_id varchar(191) NOT NULL REFERENCES recommendation_strategy_manifest(id) ON DELETE RESTRICT,
  manifest_digest char(64) NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  graph_generation_id char(64) NOT NULL,
  binding_digest char(64) NOT NULL CHECK (binding_digest ~ '^[a-f0-9]{64}$'),
  binding jsonb NOT NULL,
  qualified_at timestamp(3) NOT NULL,
  valid_until timestamp(3) NOT NULL,
  dependency_expires_at timestamp(3) NOT NULL,
  raw_population_expires_at timestamp(3) NOT NULL,
  approved_by_id varchar(191) NOT NULL CHECK (length(approved_by_id) > 0),
  approved_at timestamp(3) NOT NULL,
  expires_at timestamp(3) NOT NULL,
  revoked_at timestamp(3),
  revocation_reason varchar(64),
  CONSTRAINT recommendation_owner_release_graph_key UNIQUE(graph_generation_id),
  CONSTRAINT recommendation_owner_release_binding_check CHECK (
    graph_generation_id ~ '^[a-f0-9]{64}$' AND jsonb_typeof(binding) = 'object'
    AND octet_length(binding::text) <= 8192
    AND COALESCE(binding->>'policyVersion' = 'owner-approved-no-study-v1', false)
    AND COALESCE(binding->>'mode' = 'current-source-owner-live-v1', false)
    AND manifest_id = 'hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1'),
  CONSTRAINT recommendation_owner_release_expiry_check CHECK (
    valid_until > qualified_at AND approved_at < valid_until
    AND valid_until <= dependency_expires_at AND expires_at >= raw_population_expires_at
    AND expires_at > valid_until AND expires_at = approved_at + interval '2555 days'),
  CONSTRAINT recommendation_owner_release_revocation_check CHECK (
    (revoked_at IS NULL AND revocation_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL AND length(revocation_reason) > 0))
);
CREATE INDEX recommendation_owner_release_expiry_idx ON recommendation_owner_release(expires_at);
COMMENT ON TABLE recommendation_owner_release IS 'Immutable owner approval and exact source/configuration authority; usefulness unmeasured. Aggregate tombstone retained for 2555-day promotion audit. No source FK or retention extension.';
ALTER TABLE recommendation_promotion_pointer
  ADD COLUMN active_owner_release_id uuid REFERENCES recommendation_owner_release(id) ON DELETE RESTRICT,
  ADD COLUMN owner_influence_floor_generation integer NOT NULL DEFAULT 0
    CHECK (owner_influence_floor_generation >= 0 AND owner_influence_floor_generation <= generation);
ALTER TABLE recommendation_request
  ADD COLUMN owner_release_id uuid,
  ADD COLUMN owner_release_generation integer;
-- Nullable added fields make this metadata-only check valid for all existing rows.
ALTER TABLE recommendation_request ADD CONSTRAINT recommendation_request_owner_release_check CHECK (
  (owner_release_id IS NULL AND owner_release_generation IS NULL)
  OR (owner_release_id IS NOT NULL AND owner_release_generation IS NOT NULL AND owner_release_generation > 0 AND experiment_assignment_id IS NULL)
) NOT VALID;
ALTER TABLE recommendation_cowatch_trial_authority ADD COLUMN owner_influence_floor_generation integer NOT NULL DEFAULT 0 CHECK (owner_influence_floor_generation >= 0);
ALTER TABLE recommendation_promotion_pointer DROP CONSTRAINT recommendation_promotion_pointer_stage_check;
ALTER TABLE recommendation_promotion_pointer ADD CONSTRAINT recommendation_promotion_pointer_stage_check CHECK (
  (stage = 'control' AND active_manifest_id = last_known_good_manifest_id AND exposure_ceiling_bps = 0 AND active_approval_id IS NULL AND active_owner_release_id IS NULL)
  OR (stage = 'bounded' AND exposure_ceiling_bps > 0 AND exposure_ceiling_bps < 10000 AND active_approval_id IS NOT NULL AND active_owner_release_id IS NULL)
  OR (stage = 'permanent' AND exposure_ceiling_bps = 10000 AND active_approval_id IS NOT NULL AND active_owner_release_id IS NULL)
  OR (stage = 'owner_approved' AND exposure_ceiling_bps = 10000 AND active_approval_id IS NULL AND active_owner_release_id IS NOT NULL
    AND active_manifest_id = 'hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1')
);
CREATE FUNCTION guard_owner_influence_floor() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_influence_floor_generation < OLD.owner_influence_floor_generation THEN
    RAISE EXCEPTION 'owner influence floor cannot decrease';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER owner_influence_floor_monotonic BEFORE UPDATE ON recommendation_promotion_pointer FOR EACH ROW EXECUTE FUNCTION guard_owner_influence_floor();
CREATE FUNCTION protect_owner_release() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.expires_at <= clock_timestamp() AND OLD.raw_population_expires_at <= clock_timestamp() THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    AND NEW.revocation_reason IS NOT NULL
    AND (to_jsonb(NEW) - 'revoked_at' - 'revocation_reason') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revocation_reason') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'owner release is immutable and cannot be renewed';
END $$;
CREATE TRIGGER owner_release_immutable BEFORE UPDATE OR DELETE ON recommendation_owner_release FOR EACH ROW EXECUTE FUNCTION protect_owner_release();
CREATE FUNCTION fence_owner_release_graph() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE recommendation_owner_release SET revoked_at = COALESCE(OLD.invalidated_at, clock_timestamp()), revocation_reason = 'graph_deleted'
      WHERE graph_generation_id = OLD.id AND revoked_at IS NULL;
    RETURN OLD;
  END IF;
  IF NEW.invalidated_at IS NOT NULL AND OLD.invalidated_at IS NULL THEN
    UPDATE recommendation_owner_release SET revoked_at = NEW.invalidated_at, revocation_reason = COALESCE(NEW.invalidation_reason, 'graph_invalidated')
      WHERE graph_generation_id = NEW.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER owner_release_graph_removed BEFORE DELETE ON recommendation_cowatch_generation FOR EACH ROW EXECUTE FUNCTION fence_owner_release_graph();
CREATE TRIGGER owner_release_graph_invalidated AFTER UPDATE ON recommendation_cowatch_generation FOR EACH ROW EXECUTE FUNCTION fence_owner_release_graph();
-- A direct authority freezes the same exact graph population as trial/composition authority.
CREATE OR REPLACE FUNCTION cowatch_graph_appended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM invalidate_cowatch_generations(ARRAY(
    SELECT DISTINCT row.generation_id FROM cowatch_inserted row
    WHERE EXISTS (SELECT 1 FROM recommendation_cowatch_trial_authority authority WHERE authority.generation_id = row.generation_id)
      OR EXISTS (SELECT 1 FROM recommendation_composition_protocol protocol WHERE protocol.config->>'cowatchGenerationId' = row.generation_id)
      OR EXISTS (SELECT 1 FROM recommendation_owner_release release WHERE release.graph_generation_id = row.generation_id)
  ), 'graph_appended');
  RETURN NULL;
END $$;

INSERT INTO recommendation_strategy_manifest (id,strategy_version,contract_version,surface_version,generator,max_items,configuration,enabled) VALUES (
'hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1','hybrid-profile-viewing-mode-cowatch-mmr-owner-live-v1','semantic-recommendation-v1','watch-below-player-v1','hybrid',6,'{"context":"recommendation-context-v1","generators":[{"generator":"semantic","version":"semantic-transcript-candidate-v1"},{"generator":"multi-interest-profile","version":"multi-interest-profile-candidate-v1"},{"generator":"directional-cowatch","version":"directional-cowatch-shadow-v1"}],"profileProjection":"multi-interest-profile-projection-v1","profileClustering":"deterministic-farthest-first-medoids-v1","union":"canonical-video-union-v1","eligibility":"watch-playable-locale-v1","ranker":"source-rank-hybrid-ranker-v1","rankerFormula":"rrf-k60-primary-plus-5-percent-secondary-v1","composer":"source-interest-theme-mmr-v1","fallbackManifestId":"hybrid-profile-viewing-mode-v1","shadowDecisionRequired":null,"completeServiceDeadlineMs":1500,"learningReads":"published-projections-only","executionPolicy":"profile-viewing-mode-cowatch-mmr-owner-live-v1","viewingModeProjection":"sound-off-viewing-v1","viewingModeRanker":"viewing-mode-affinity-v1","viewingModeFallback":"ordinary-relevance-if-unavailable","operationalFallback":{"effectiveManifestId":"hybrid-profile-viewing-mode-v1","reasonCode":"cowatch_mmr_incumbent_fallback","executionModes":["hybrid_personalized","viewing_mode_personalized","semantic_fallback","curated_fallback"],"results":["fallback","empty"],"semanticGenerator":"semantic-transcript-candidate-v1","curatedGenerator":"seeded-curated-empty-fallback-v1","curatedRanker":"source-rank-hybrid-ranker-v1","curatedInventory":"approved-locale-audio-pool-only","eligibility":"watch-playable-locale-v1"},"nominationBudgets":{"maximum":64,"semantic":36,"cowatch":12,"profile":"remaining-capacity","interleave":"semantic-profile-cowatch-v1"},"generatorSet":"semantic-profile-cowatch-generators-v1","composition":{"composerVersion":"source-interest-theme-mmr-v1","weights":{"relevance":0.75,"themeSimilarity":-0.2,"source":0.025,"interest":0.025},"candidateLimit":64,"positionLimit":6,"supportedInputs":["source","interest","theme","recent_history"],"excludedInputs":["editorial_adapter","series","speaker"],"history":"request_window_reconstruction","missingInputDisposition":"deterministic_fallback"},"graphPolicy":"current-source-owner-live-v1","effectAttribution":"not-measured-owner-authorized","shadowPopulation":null,"authorityPolicy":"owner-approved-no-study-v1","graphMaximumAgeMs":86400000,"refresh":"explicit-new-generation-and-owner-release","usefulness":"not-measured-owner-authorized","population":{"locale":"en","audioLanguageSlug":"english","traffic":"eligible-human","profile":"current-active-durable-generation","projection":"published-unexpired-durable-positive-interests","clientDeliveryContract":"cowatch-mmr-v1"}}'::jsonb,true);
COMMIT;
-- Existing rows received two NULL columns atomically; all new/updated rows
-- enforce the pair check. Keep NOT VALID to avoid an unnecessary retained-table scan.
RESET lock_timeout;
RESET statement_timeout;
