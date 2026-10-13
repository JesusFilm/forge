-- Accept 16 KiB canonical UTF-8 nodes without reducing profile detail.
-- JSONB::text formatting can expand canonical JSON; retain a 2x storage guard.
-- Existing generations, calls, receipts, and terminal profiles remain unchanged.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;

ALTER TABLE recommendation_precomputed_profile_call
  DROP CONSTRAINT recommendation_precomputed_profile_call_node_json_check,
  ADD CONSTRAINT recommendation_precomputed_profile_call_node_json_check
    CHECK (node_json IS NULL OR octet_length(node_json::text) <= 32768);

ALTER TABLE recommendation_precomputed_content_profile
  DROP CONSTRAINT recommendation_precomputed_content_profile_profile_json_check,
  ADD CONSTRAINT recommendation_precomputed_content_profile_profile_json_check
    CHECK (profile_json IS NULL OR octet_length(profile_json::text) <= 32768);

COMMIT;
RESET lock_timeout;
RESET statement_timeout;
