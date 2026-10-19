-- Extend only the sealed reviewed scope; preserve all original records and guards.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;
ALTER TABLE recommendation_precomputed_edge_no_dispatch_disposition
  DROP CONSTRAINT precomputed_no_dispatch_reviewed_incident,
  ADD CONSTRAINT precomputed_no_dispatch_reviewed_incident CHECK (
    (call_id = 'f6cdb507-e7e3-4172-b31f-27ace231f2c3'
      AND original_attempt_id = '93be0f68-3564-4da7-a81d-0d7bb4b79212'
      AND request_digest = 'dd72735e1bcdb439f39a824dbdfe37c408af7e414ff8a095cdf5c549e1dd5437'
      AND evidence_digest = '43cdc25082e85c9b2a743a62da0dfc2857ce7b037d52a4467818dbf9a1e9422d'
      AND jsonb_array_length(original_members) = 1)
    OR
    (call_id = 'd541c707-abd6-4f01-9a8f-038c11b2a4e7'
      AND original_attempt_id = 'b01b7bb1-5b87-4630-baca-7640e76cfd62'
      AND request_digest = '72ef38c5db10293ad056e13a7de10e37995b9e6d54e614766a5ae2008fd242af'
      AND evidence_digest = 'ff0f204b63dbc2ccd51e60d8225cc714c2d6c2aa82d0a866d506bb44384d1c92'
      AND jsonb_array_length(original_members) = 2)
    OR (call_id = '734caa08-6a97-4704-b1a7-bab5b2b017e7'
      AND original_attempt_id = 'b29eb01c-ba09-4ae2-8d32-a0fb5b581b15'
      AND request_digest = '025d1acbe592eb0b91d9bf38335659d6674c1b9d00913eaa912d7592ffe827c6'
      AND evidence_digest = 'b988c277eb6acc82ef3cbacde68407292ae700d2143eba6199dceb55863b1d3f'
      AND jsonb_array_length(original_members) = 2)
  );
COMMIT;
RESET lock_timeout;
RESET statement_timeout;
