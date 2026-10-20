-- Admin accepts at most 4096 canonical UTF-8 bytes per complete profile node.
-- JSONB::text adds spaces after separators; retain the existing 2x physical
-- allowance so a valid node cannot roll back its observed-usage receipt.
-- This only widens the storage guard and preserves all existing rows.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_profile_call
  DROP CONSTRAINT recommendation_precomputed_profile_call_node_json_check,
  ADD CONSTRAINT recommendation_precomputed_profile_call_node_json_check
    CHECK (node_json IS NULL OR octet_length(node_json::text) <= 8192);

COMMIT;
RESET lock_timeout;
RESET statement_timeout;
