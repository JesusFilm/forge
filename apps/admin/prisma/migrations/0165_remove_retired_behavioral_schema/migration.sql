-- Contract release: every HTTP/worker replica must already run the U1
-- application cleanup before this predeploy migration is allowed to run.
-- The accepted row drain is historical evidence, not permission to drop new
-- rows. Lock and recheck the exact retired set in the same transaction.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $$
DECLARE prior_transaction_timeout interval := current_setting('transaction_timeout')::interval;
BEGIN
  -- PostgreSQL does not reschedule an already-active transaction timer when
  -- its positive setting changes. Retain a stricter existing timer; otherwise
  -- explicitly enable a five-second cap before acquiring any table locks.
  IF prior_transaction_timeout = interval '0 seconds'
    OR prior_transaction_timeout > interval '5 seconds'
  THEN
    PERFORM set_config('transaction_timeout', '0', true);
    PERFORM set_config('transaction_timeout', '5s', true);
  END IF;
  IF NOT pg_try_advisory_xact_lock(368000001) THEN
    RAISE EXCEPTION 'behavioral schema retirement refused: retention is active';
  END IF;
END $$;

-- Block ledger admissions until commit. The runtime table receives the same
-- write fence below before its terminal-state query.
LOCK TABLE workflow_run IN SHARE MODE;

-- Fence retained writers before taking their retired dependencies. This also
-- closes the gap between reference admission and removal of the three FKs.
LOCK TABLE recommendation_personalization_decision,
  recommendation_experiment_assignment, recommendation_shadow_run,
  recommendation_outcome_revision, recommendation_playback_episode,
  recommendation_playback_fact, recommendation_eligibility_decision,
  recommendation_promotion_slate_fence, recommendation_composition_observation
  IN ACCESS EXCLUSIVE MODE;
LOCK TABLE recommendation_cowatch_refresh_attempt,
  recommendation_cowatch_refresh_grant, recommendation_profile_interest,
  recommendation_profile_projection_contribution,
  recommendation_profile_projection_pointer, recommendation_profile_projection_run,
  recommendation_consent_receipt, recommendation_consent_transition,
  recommendation_profile_session_link, recommendation_viewing_mode_evidence,
  recommendation_profile_projection_generation, recommendation_profile_vector_snapshot,
  recommendation_cowatch_edge, recommendation_cowatch_contribution,
  recommendation_cowatch_source_contribution, recommendation_cowatch_suppression,
  recommendation_cowatch_trial_authority, recommendation_cowatch_generation,
  recommendation_profile IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE table_name text; populated boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'recommendation_cowatch_refresh_attempt',
    'recommendation_cowatch_refresh_grant',
    'recommendation_profile_interest',
    'recommendation_profile_projection_contribution',
    'recommendation_profile_projection_pointer',
    'recommendation_profile_projection_run',
    'recommendation_consent_receipt',
    'recommendation_consent_transition',
    'recommendation_profile_session_link',
    'recommendation_viewing_mode_evidence',
    'recommendation_profile_projection_generation',
    'recommendation_profile_vector_snapshot',
    'recommendation_cowatch_edge',
    'recommendation_cowatch_contribution',
    'recommendation_cowatch_source_contribution',
    'recommendation_cowatch_suppression',
    'recommendation_cowatch_trial_authority',
    'recommendation_cowatch_generation',
    'recommendation_profile'
  ] LOOP
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I)', table_name) INTO populated;
    IF populated THEN
      RAISE EXCEPTION 'behavioral schema retirement refused: % is not empty', table_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM recommendation_personalization_decision WHERE projection_generation_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM recommendation_experiment_assignment WHERE profile_id IS NOT NULL)
    OR EXISTS (SELECT 1 FROM recommendation_shadow_run WHERE projection_profile_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'behavioral schema retirement refused: historical references remain attached';
  END IF;
END $$;

-- Workflow owns its runtime schema outside Prisma. A new empty installation
-- has no such schema yet; an installation with retired ledgers must have the
-- runtime linkage available. Keep the indexed positive-status admission from
-- the retired operator, including its closed enum contract.
DO $$
DECLARE blocked boolean;
BEGIN
  IF to_regclass('workflow.workflow_runs') IS NULL THEN
    IF EXISTS (SELECT 1 FROM workflow_run WHERE workflow_key IN (
      'recommendation-profile-projection',
      'recommendation-profile-reconciliation-scheduler',
      'recommendation-cowatch-refresh-scheduler',
      'recommendation-shadow-evaluation',
      'recommendation-experiment-evaluation'
    )) THEN
      RAISE EXCEPTION 'behavioral schema retirement refused: workflow runtime unavailable';
    END IF;
    RETURN;
  END IF;
  EXECUTE 'LOCK TABLE workflow.workflow_runs IN SHARE MODE';
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = to_regclass('workflow.workflow_runs')
      AND a.attname = 'status' AND a.attnotnull AND NOT a.attisdropped
      AND t.typtype = 'e'
      AND ARRAY(SELECT e.enumlabel::text FROM pg_enum e
        WHERE e.enumtypid = t.oid ORDER BY e.enumsortorder)
        = ARRAY['pending', 'running', 'completed', 'failed', 'cancelled']
  ) THEN
    RAISE EXCEPTION 'behavioral schema retirement refused: workflow status contract changed';
  END IF;
  EXECUTE $runtime$
    WITH retired(workflow_key, runtime_name) AS (VALUES
      ('recommendation-profile-projection', 'workflow//./src/workflows/recommendationProfileProjection//runRecommendationProfileProjection'),
      ('recommendation-profile-reconciliation-scheduler', 'workflow//./src/workflows/recommendationProfileReconciliation//runRecommendationProfileReconciliationScheduler'),
      ('recommendation-cowatch-refresh-scheduler', 'workflow//./src/workflows/recommendationCowatchRefresh//runRecommendationCowatchRefreshScheduler'),
      ('recommendation-shadow-evaluation', 'workflow//./src/workflows/recommendationShadowEvaluation//runRecommendationShadowEvaluation'),
      ('recommendation-experiment-evaluation', 'workflow//./src/workflows/recommendationExperimentEvaluation//runRecommendationExperimentEvaluation')
    ) SELECT
      EXISTS (SELECT 1 FROM workflow.workflow_runs runtime
        WHERE runtime.status IN ('pending', 'running')
          AND runtime.name IN (SELECT runtime_name FROM retired))
      OR EXISTS (SELECT 1 FROM workflow_run ledger JOIN retired USING (workflow_key)
        LEFT JOIN workflow.workflow_runs runtime ON runtime.id = ledger.runtime_run_id
        WHERE ledger.runtime_run_id IS NULL OR runtime.id IS NULL
          OR runtime.name IS DISTINCT FROM retired.runtime_name
          OR runtime.status IN ('pending', 'running'))
  $runtime$ INTO blocked;
  IF blocked THEN
    RAISE EXCEPTION 'behavioral schema retirement refused: behavioral workflow is nonterminal or unlinked';
  END IF;
END $$;

-- Preserve historical scalar columns and all other FK/check behavior. These
-- three references can never acquire a new retired target after the drop.
ALTER TABLE recommendation_personalization_decision
  DROP CONSTRAINT recommendation_personalization_projection_fkey,
  ADD CONSTRAINT recommendation_personalization_retired_projection_check
    CHECK (projection_generation_id IS NULL) NOT VALID;
ALTER TABLE recommendation_experiment_assignment
  DROP CONSTRAINT recommendation_experiment_assignment_profile_fkey,
  ADD CONSTRAINT recommendation_experiment_assignment_retired_profile_check
    CHECK (profile_id IS NULL) NOT VALID;
ALTER TABLE recommendation_shadow_run
  DROP CONSTRAINT recommendation_shadow_run_profile_fkey,
  ADD CONSTRAINT recommendation_shadow_run_retired_profile_check
    CHECK (projection_profile_id IS NULL) NOT VALID;
-- NOT VALID avoids another historical scan: admission above already checked
-- every existing reference under exclusive locks, and new writes are checked.

DROP TRIGGER cowatch_outcome_changed ON recommendation_outcome_revision;
DROP TRIGGER cowatch_outcome_removed ON recommendation_outcome_revision;
DROP TRIGGER cowatch_episode_changed ON recommendation_playback_episode;
DROP TRIGGER cowatch_fact_changed ON recommendation_playback_fact;
DROP TRIGGER cowatch_eligibility_changed ON recommendation_eligibility_decision;
DROP TRIGGER cowatch_promotion_fence_changed ON recommendation_promotion_slate_fence;

-- Retained observations keep their authority and immutability checks. New
-- observations cannot bind retired behavioral products; historical rows stay.
CREATE OR REPLACE FUNCTION composition_observation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root recommendation_shadow_run; contract recommendation_composition_protocol;
  request_root recommendation_request; evaluation_root recommendation_shadow_evaluation;
  root_request_id text; root_profile_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'composition observation is immutable'; END IF;
  SELECT request_id, projection_profile_id INTO root_request_id, root_profile_id
    FROM recommendation_shadow_run WHERE id = NEW.run_id;
  IF root_profile_id IS NOT NULL THEN
    RAISE EXCEPTION 'composition profile binding is retired';
  END IF;
  SELECT * INTO request_root FROM recommendation_request WHERE id = root_request_id FOR SHARE;
  SELECT * INTO root FROM recommendation_shadow_run WHERE id = NEW.run_id FOR SHARE;
  IF root.id IS NULL OR request_root.id IS NULL
    OR root.request_id IS DISTINCT FROM root_request_id
    OR root.projection_profile_id IS DISTINCT FROM root_profile_id
    OR root.privacy_generation IS NOT NULL
  THEN RAISE EXCEPTION 'composition roots changed during publication'; END IF;
  SELECT * INTO contract FROM recommendation_composition_protocol WHERE id = NEW.protocol_id FOR UPDATE;
  SELECT * INTO evaluation_root FROM recommendation_shadow_evaluation WHERE id = root.evaluation_id;
  IF contract.id IS NULL OR evaluation_root.id IS NULL
    OR contract.config->>'cowatchGenerationId' IS NOT NULL
    OR evaluation_root.cowatch_generation_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM recommendation_shadow_nomination
      WHERE run_id = root.id AND generator = 'directional-cowatch')
  THEN RAISE EXCEPTION 'composition behavioral binding is retired'; END IF;
  IF evaluation_root.manifest_id <> contract.source_manifest_id
    OR evaluation_root.generator_version <> contract.generator_version
  THEN RAISE EXCEPTION 'composition evaluation binding unavailable'; END IF;
  IF request_root.state <> 'issued' OR NEW.expires_at > request_root.expires_at
    OR contract.revoked_at IS NOT NULL OR root.state <> 'published'
    OR root.evaluation_id <> contract.shadow_evaluation_id
    OR root.claimed_at IS NULL OR root.claimed_at < contract.created_at
    OR NEW.expires_at > root.expires_at
    OR EXISTS (SELECT 1 FROM recommendation_composition_decision WHERE protocol_id = NEW.protocol_id)
  THEN RAISE EXCEPTION 'composition observation binding unavailable'; END IF;
  RETURN NEW;
END $$;

-- Keep the eleven retained study source fences; only the retired viewing-mode
-- branch is removed. No study, experiment or promotion history is deleted.
CREATE OR REPLACE FUNCTION fence_recommendation_study_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_row jsonb; after_row jsonb; request_ids text[];
  assignment_ids text[]; study_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN before_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN after_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'recommendation_request' THEN
    request_ids := ARRAY[before_row->>'id', after_row->>'id'];
    assignment_ids := ARRAY[before_row->>'experiment_assignment_id', after_row->>'experiment_assignment_id'];
  ELSIF TG_TABLE_NAME = 'recommendation_eligibility_decision' THEN
    SELECT array_agg(request_id) INTO request_ids FROM recommendation_outcome_revision
      WHERE id = ANY(ARRAY[before_row->>'outcome_id', after_row->>'outcome_id']);
  ELSE
    request_ids := ARRAY[before_row->>'request_id', after_row->>'request_id'];
  END IF;
  FOR study_id IN
    SELECT DISTINCT assignment.experiment_id
    FROM (
      SELECT unnest(assignment_ids) AS assignment_id
      UNION SELECT experiment_assignment_id FROM recommendation_request WHERE id = ANY(request_ids)
    ) relevant
    JOIN recommendation_experiment_assignment assignment ON assignment.id = relevant.assignment_id
    JOIN recommendation_study study ON study.experiment_id = assignment.experiment_id
    ORDER BY assignment.experiment_id
  LOOP
    PERFORM pg_advisory_xact_lock_shared(hashtextextended(study_id, 505505));
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      PERFORM experiment_id FROM recommendation_study WHERE experiment_id = study_id FOR SHARE;
    END IF;
    UPDATE recommendation_study study SET privacy_revision = privacy_revision + 1
    WHERE study.experiment_id = study_id AND EXISTS (
      SELECT 1 FROM recommendation_study_evaluation authority
      JOIN recommendation_experiment_evaluation evaluation ON evaluation.id = authority.evaluation_id
      WHERE authority.study_id = study.experiment_id
        AND authority.privacy_revision = study.privacy_revision
        AND authority.expires_at > clock_timestamp()
        AND NOT EXISTS (SELECT 1 FROM recommendation_experiment_evaluation newer WHERE newer.supersedes_id = evaluation.id)
    );
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- RESTRICT is deliberate: an unreviewed dependency stops the transaction.
DROP TABLE recommendation_cowatch_refresh_attempt,
  recommendation_cowatch_refresh_grant, recommendation_profile_interest,
  recommendation_profile_projection_contribution,
  recommendation_profile_projection_pointer, recommendation_profile_projection_run,
  recommendation_consent_receipt, recommendation_consent_transition,
  recommendation_profile_session_link, recommendation_viewing_mode_evidence,
  recommendation_profile_projection_generation, recommendation_profile_vector_snapshot,
  recommendation_cowatch_edge, recommendation_cowatch_contribution,
  recommendation_cowatch_source_contribution, recommendation_cowatch_suppression,
  recommendation_cowatch_trial_authority, recommendation_cowatch_generation,
  recommendation_profile RESTRICT;

-- Only functions owned exclusively by the retired mechanism. Retained
-- composition/study/owner-release guards and the batch receipt table survive.
DROP FUNCTION cowatch_authority_immutable(), cowatch_dependency_changed(),
  cowatch_generation_immutable(), cowatch_generation_removed(),
  cowatch_graph_appended(), cowatch_profile_changed(), cowatch_suppression_immutable(),
  enforce_recommendation_profile_projection_child_expiry(),
  enforce_recommendation_profile_projection_pointer(), fence_composition_profile(),
  fence_recommendation_study_profile(), fence_composition_graph(), fence_owner_release_graph(),
  guard_cowatch_refresh_attempt(), guard_cowatch_refresh_grant(),
  invalidate_cowatch_episode(text, text), invalidate_cowatch_generations(character[], text),
  prevent_recommendation_profile_projection_child_update(),
  prevent_recommendation_profile_vector_snapshot_update(),
  prevent_terminal_recommendation_profile_projection_mutation(),
  suppress_cowatch_retained_outcome(text) RESTRICT;

DROP TYPE "RecommendationProfileChoice", "RecommendationProfileState",
  "RecommendationConsentTransitionKind", "RecommendationConsentChoice",
  "RecommendationConsentReceiptState", "RecommendationProfileErasureState",
  "RecommendationProfileProjectionScope", "RecommendationProfileProjectionState",
  "RecommendationProfileProjectionRunState", "RecommendationProfileInterestKind",
  "RecommendationProfileContributionKind" RESTRICT;

COMMIT;
