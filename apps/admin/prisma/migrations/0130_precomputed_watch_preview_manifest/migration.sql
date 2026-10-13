-- Private execution identity only. This row is never selected by the public
-- serving control and cannot activate the experiment by migration alone.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '5s';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM recommendation_strategy_manifest
    WHERE id = 'precomputed-watch-preview-v1'
      AND (strategy_version, contract_version, surface_version, generator,
           max_items, configuration, enabled) IS DISTINCT FROM
          ('precomputed-watch-preview-v1', 'semantic-recommendation-v1',
           'watch-below-player-v1', 'precomputed', 6,
           '{"privatePreview":true}'::jsonb, false)
  ) THEN
    RAISE EXCEPTION 'Conflicting precomputed Watch preview manifest';
  END IF;
END $$;

INSERT INTO recommendation_strategy_manifest
  (id, strategy_version, contract_version, surface_version, generator,
   max_items, configuration, enabled)
VALUES
  ('precomputed-watch-preview-v1', 'precomputed-watch-preview-v1',
   'semantic-recommendation-v1', 'watch-below-player-v1', 'precomputed',
   6, '{"privatePreview":true}'::jsonb, false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
