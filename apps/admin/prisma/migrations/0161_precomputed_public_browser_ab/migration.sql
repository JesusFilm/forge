-- Allow ordinary public A/B tests without changing existing evidence authority.
-- This migration does not select a generation or activate public traffic.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE recommendation_precomputed_public_control
  DROP CONSTRAINT recommendation_precomputed_public_control_authority_check,
  ADD CONSTRAINT recommendation_precomputed_public_control_authority_check
  CHECK (authority IS NULL OR authority IN ('isolated_fixture', 'live_verified', 'public_browser'));

ALTER TABLE recommendation_precomputed_public_control_event
  DROP CONSTRAINT recommendation_precomputed_public_control_event_authority_check,
  ADD CONSTRAINT recommendation_precomputed_public_control_event_authority_check
  CHECK (authority IS NULL OR authority IN ('isolated_fixture', 'live_verified', 'public_browser'));

ALTER TABLE recommendation_precomputed_ctr_policy
  DROP CONSTRAINT recommendation_precomputed_ctr_policy_authority_check,
  ADD CONSTRAINT recommendation_precomputed_ctr_policy_authority_check
  CHECK (authority IN ('fixture_only', 'prelaunch_agreed', 'public_observed'));

COMMIT;
