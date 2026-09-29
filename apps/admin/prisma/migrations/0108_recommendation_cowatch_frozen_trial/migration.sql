ALTER TABLE recommendation_shadow_evaluation ADD COLUMN cowatch_generation_id char(64);
CREATE OR REPLACE FUNCTION prevent_terminal_shadow_evaluation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cowatch_generation_id IS DISTINCT FROM OLD.cowatch_generation_id THEN
    RAISE EXCEPTION 'shadow evaluation graph identity is immutable';
  END IF;
  IF OLD.state = 'terminal' AND NOT (TG_OP = 'DELETE' AND OLD.expires_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'terminal recommendation shadow evaluations are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

ALTER TABLE recommendation_cowatch_generation
  ADD COLUMN lineage_version varchar(64) NOT NULL DEFAULT 'discovery-link-v1',
  ADD COLUMN invalidated_at timestamp(3),
  ADD COLUMN invalidation_reason varchar(96),
  ADD CONSTRAINT cowatch_lineage_version_check CHECK (lineage_version IN ('discovery-link-v1', 'durable-privacy-generation-v2'));
ALTER TABLE recommendation_cowatch_source_contribution ADD COLUMN viewer_privacy_generation integer;
CREATE INDEX recommendation_cowatch_source_outcome_idx ON recommendation_cowatch_source_contribution(outcome_id);
CREATE INDEX recommendation_cowatch_source_eligibility_idx ON recommendation_cowatch_source_contribution(eligibility_decision_id);
CREATE INDEX recommendation_cowatch_edge_live_idx ON recommendation_cowatch_edge
  (generation_id, source_media_id, eligible, confidence DESC, popularity_corrected_lift DESC, target_media_id);

CREATE TABLE recommendation_cowatch_trial_authority (
  generation_id char(64) PRIMARY KEY,
  revoked_at timestamp(3),
  raw_population_expires_at timestamp(3) NOT NULL,
  binding_digest char(64) NOT NULL,
  binding jsonb NOT NULL,
  mode varchar(64) NOT NULL DEFAULT 'frozen-source-controlled-trial-v1' CHECK (mode = 'frozen-source-controlled-trial-v1'),
  dependency_expires_at timestamp(3) NOT NULL,
  trial_valid_until timestamp(3) NOT NULL,
  qualified_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (dependency_expires_at > trial_valid_until AND trial_valid_until > qualified_at)
);
COMMENT ON TABLE recommendation_cowatch_trial_authority IS 'Immutable aggregate identity tombstone; one qualification per graph, no renewal. No graph FK. Retained through original raw-population expiry; never extends raw retention.';
CREATE INDEX recommendation_cowatch_authority_expiry_idx ON recommendation_cowatch_trial_authority(raw_population_expires_at);
CREATE FUNCTION cowatch_authority_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.raw_population_expires_at <= clock_timestamp() THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL AND (to_jsonb(NEW) - 'revoked_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'revoked_at') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'co-watch trial qualification cannot be renewed or changed';
END $$;
CREATE TRIGGER cowatch_authority_immutable BEFORE UPDATE OR DELETE ON recommendation_cowatch_trial_authority
  FOR EACH ROW EXECUTE FUNCTION cowatch_authority_immutable();

-- Each invalidation serializes with qualification's FOR UPDATE graph lock.
-- No global row is touched. Reverse source indexes bound lookup to references
-- of the changed dependency; singleton sources participate equally.
CREATE FUNCTION invalidate_cowatch_generations(ids char(64)[], reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE graph_id char(64);
BEGIN
  FOR graph_id IN SELECT DISTINCT unnest(ids) ORDER BY 1 LOOP
    UPDATE recommendation_cowatch_generation SET invalidated_at = clock_timestamp(), invalidation_reason = reason
      WHERE id = graph_id AND invalidated_at IS NULL;
  END LOOP;
END $$;
CREATE FUNCTION invalidate_cowatch_episode(episode_id_value text, reason text) RETURNS void LANGUAGE sql AS $$
  SELECT invalidate_cowatch_generations(ARRAY(
    SELECT source.generation_id FROM recommendation_cowatch_source_contribution source
    JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
    WHERE outcome.episode_id = episode_id_value
  ), reason);
$$;
-- Removing private lineage must not turn a retained episode anonymous after
-- discovery-link cleanup. Unconditional suppression avoids racing link cleanup.
CREATE FUNCTION suppress_cowatch_retained_outcome(outcome_id_value text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO recommendation_cowatch_suppression(episode_id, expires_at)
    SELECT DISTINCT episode.id, episode.expires_at
    FROM recommendation_cowatch_source_contribution source
    JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
    JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
    WHERE source.outcome_id = outcome_id_value AND source.viewer_profile_id IS NOT NULL
    ON CONFLICT (episode_id) DO NOTHING;
$$;
CREATE FUNCTION cowatch_dependency_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_value jsonb; episode_value text; ids char(64)[];
BEGIN
  row_value := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_TABLE_NAME = 'recommendation_outcome_revision' THEN
    IF TG_OP = 'DELETE' THEN PERFORM suppress_cowatch_retained_outcome(row_value->>'id'); END IF;
    SELECT ARRAY(
      SELECT source.generation_id FROM recommendation_cowatch_source_contribution source WHERE source.outcome_id = row_value->>'id'
      UNION
      SELECT source.generation_id FROM recommendation_outcome_revision outcome
      JOIN recommendation_cowatch_source_contribution source ON source.outcome_id = outcome.id
      WHERE outcome.episode_id = row_value->>'episode_id' AND outcome.classifier_version = row_value->>'classifier_version'
        AND outcome.revision < (row_value->>'revision')::integer
    ) INTO ids;
    PERFORM invalidate_cowatch_generations(ids, 'outcome_revision_changed');
  ELSIF TG_TABLE_NAME = 'recommendation_playback_episode' THEN
    PERFORM invalidate_cowatch_episode(row_value->>'id', 'episode_changed');
  ELSIF TG_TABLE_NAME = 'recommendation_playback_fact' THEN
    PERFORM invalidate_cowatch_episode(row_value->>'episode_id', 'episode_fact_changed');
  ELSIF TG_TABLE_NAME = 'recommendation_cowatch_suppression' THEN
    PERFORM invalidate_cowatch_episode(row_value->>'episode_id', 'privacy_suppressed');
  ELSIF TG_TABLE_NAME = 'recommendation_eligibility_decision' THEN
    SELECT ARRAY(SELECT generation_id FROM recommendation_cowatch_source_contribution WHERE eligibility_decision_id = row_value->>'id') INTO ids;
    PERFORM invalidate_cowatch_generations(ids, 'eligibility_changed');
  ELSIF TG_TABLE_NAME = 'recommendation_promotion_slate_fence' THEN
    SELECT ARRAY(SELECT source.generation_id FROM recommendation_cowatch_source_contribution source
      JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
      WHERE outcome.request_id = row_value->>'request_id') INTO ids;
    PERFORM invalidate_cowatch_generations(ids, 'promotion_fenced');
  ELSE
    IF TG_TABLE_NAME = 'recommendation_cowatch_source_contribution' AND TG_OP = 'DELETE' AND (row_value->>'viewer_profile_id') IS NOT NULL THEN
      PERFORM suppress_cowatch_retained_outcome(row_value->>'outcome_id');
    END IF;
    PERFORM invalidate_cowatch_generations(ARRAY[(row_value->>'generation_id')::char(64)], 'graph_lineage_changed');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER cowatch_outcome_changed AFTER INSERT ON recommendation_outcome_revision FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_outcome_removed BEFORE UPDATE OR DELETE ON recommendation_outcome_revision FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_episode_changed BEFORE UPDATE OF state, finalized_at, media_id, session_digest, claimed_at, created_at, next_fact_sequence, conflict_count, replay_count, expires_at OR DELETE ON recommendation_playback_episode FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_fact_changed BEFORE INSERT OR UPDATE OR DELETE ON recommendation_playback_fact FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_eligibility_changed BEFORE UPDATE OR DELETE ON recommendation_eligibility_decision FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_suppression_changed AFTER INSERT ON recommendation_cowatch_suppression FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_promotion_fence_changed AFTER INSERT OR UPDATE ON recommendation_promotion_slate_fence FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_source_changed BEFORE UPDATE OR DELETE ON recommendation_cowatch_source_contribution FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_pair_changed BEFORE UPDATE OR DELETE ON recommendation_cowatch_contribution FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();
CREATE TRIGGER cowatch_edge_changed BEFORE UPDATE OR DELETE ON recommendation_cowatch_edge FOR EACH ROW EXECUTE FUNCTION cowatch_dependency_changed();

-- Bulk graph publication inserts precede qualification. Later inserts cannot
-- silently change an already-qualified graph; statement triggers amortize work.
CREATE FUNCTION cowatch_graph_appended() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM invalidate_cowatch_generations(ARRAY(SELECT DISTINCT row.generation_id FROM cowatch_inserted row
    JOIN recommendation_cowatch_trial_authority authority USING (generation_id)), 'graph_appended');
  RETURN NULL;
END $$;
CREATE TRIGGER cowatch_source_appended AFTER INSERT ON recommendation_cowatch_source_contribution REFERENCING NEW TABLE AS cowatch_inserted FOR EACH STATEMENT EXECUTE FUNCTION cowatch_graph_appended();
CREATE TRIGGER cowatch_pair_appended AFTER INSERT ON recommendation_cowatch_contribution REFERENCING NEW TABLE AS cowatch_inserted FOR EACH STATEMENT EXECUTE FUNCTION cowatch_graph_appended();
CREATE TRIGGER cowatch_edge_appended AFTER INSERT ON recommendation_cowatch_edge REFERENCING NEW TABLE AS cowatch_inserted FOR EACH STATEMENT EXECUTE FUNCTION cowatch_graph_appended();

CREATE FUNCTION cowatch_profile_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ids char(64)[];
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state AND NEW.privacy_generation IS NOT DISTINCT FROM OLD.privacy_generation AND NEW.expires_at >= OLD.expires_at THEN RETURN NEW; END IF;
  -- BEFORE profile deletion/generation change: retain episode suppression even
  -- after short-lived discovery links have already been cleaned up.
  IF TG_OP = 'DELETE' OR NEW.state IS DISTINCT FROM OLD.state OR NEW.privacy_generation IS DISTINCT FROM OLD.privacy_generation THEN
    INSERT INTO recommendation_cowatch_suppression(episode_id, expires_at)
      SELECT DISTINCT episode.id, episode.expires_at FROM recommendation_cowatch_source_contribution source
      JOIN recommendation_outcome_revision outcome ON outcome.id = source.outcome_id
      JOIN recommendation_playback_episode episode ON episode.id = outcome.episode_id
      WHERE source.viewer_profile_id = OLD.id
      UNION
      SELECT DISTINCT episode.id, episode.expires_at FROM recommendation_profile_session_link link
      JOIN recommendation_playback_episode episode ON episode.session_digest = link.session_digest WHERE link.profile_id = OLD.id
      ON CONFLICT (episode_id) DO NOTHING;
  END IF;
  SELECT ARRAY(SELECT generation_id FROM recommendation_cowatch_source_contribution WHERE viewer_profile_id = OLD.id) INTO ids;
  PERFORM invalidate_cowatch_generations(ids, 'profile_privacy_changed');
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER cowatch_profile_changed BEFORE UPDATE OF privacy_generation, state, expires_at OR DELETE ON recommendation_profile FOR EACH ROW EXECUTE FUNCTION cowatch_profile_changed();

CREATE FUNCTION cowatch_generation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'invalidated_at' - 'invalidation_reason') IS DISTINCT FROM (to_jsonb(OLD) - 'invalidated_at' - 'invalidation_reason')
    OR (OLD.invalidated_at IS NOT NULL AND (NEW.invalidated_at IS DISTINCT FROM OLD.invalidated_at OR NEW.invalidation_reason IS DISTINCT FROM OLD.invalidation_reason)) THEN
    RAISE EXCEPTION 'co-watch generation is immutable and cannot be requalified';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cowatch_generation_immutable BEFORE UPDATE ON recommendation_cowatch_generation FOR EACH ROW EXECUTE FUNCTION cowatch_generation_immutable();

-- Preserve one-use identity when a graph is deleted early; a same-ID rebuild
-- cannot inherit authority or erase its prior qualification.
CREATE FUNCTION cowatch_generation_removed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE recommendation_cowatch_trial_authority SET revoked_at = clock_timestamp()
    WHERE generation_id = OLD.id AND revoked_at IS NULL;
  RETURN OLD;
END $$;
CREATE TRIGGER cowatch_generation_removed BEFORE DELETE ON recommendation_cowatch_generation FOR EACH ROW EXECUTE FUNCTION cowatch_generation_removed();

-- Privacy suppression is irrevocable for the retained raw episode lifetime.
-- Parent episode expiry/deletion may still cascade normally.
CREATE FUNCTION cowatch_suppression_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND (OLD.expires_at <= clock_timestamp() OR NOT EXISTS (SELECT 1 FROM recommendation_playback_episode WHERE id = OLD.episode_id)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'co-watch privacy suppression must survive its raw episode';
END $$;
CREATE TRIGGER cowatch_suppression_immutable BEFORE UPDATE OR DELETE ON recommendation_cowatch_suppression FOR EACH ROW EXECUTE FUNCTION cowatch_suppression_immutable();
