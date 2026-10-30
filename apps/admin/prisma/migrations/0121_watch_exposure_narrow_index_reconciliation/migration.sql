-- Populated environments must finish the reviewed concurrent create/observe/drop
-- operator before this migration. Never build an ordinary index over live rows.
BEGIN;
SET LOCAL lock_timeout = '250ms';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  narrow_oid oid;
  wide_oid oid;
  index_ok boolean;
BEGIN
  IF to_regclass('public.watch_surface_exposure') IS NULL THEN
    RAISE EXCEPTION 'Exposure table missing; refusing index reconciliation';
  END IF;

  -- This lock allows ordinary readers and writers while stabilizing index DDL.
  LOCK TABLE public.watch_surface_exposure IN SHARE UPDATE EXCLUSIVE MODE;
  narrow_oid := to_regclass('public.watch_surface_exposure_window_item_narrow_idx');
  wide_oid := to_regclass('public.watch_surface_exposure_window_item_idx');

  IF narrow_oid IS NOT NULL AND wide_oid IS NULL THEN
    SELECT i.indrelid = 'public.watch_surface_exposure'::regclass
      AND i.indisvalid AND i.indisready AND i.indislive
      AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
      AND i.indnkeyatts = 6 AND i.indnatts = 6
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND am.amname = 'btree' AND c.relkind = 'i'
      AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = i.indexrelid)
      AND pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX watch_surface_exposure_window_item_narrow_idx ON public.watch_surface_exposure USING btree (window_id, surface, block, presentation, placement, "position")'
    INTO index_ok
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am am ON am.oid = c.relam WHERE i.indexrelid = narrow_oid;
    IF index_ok IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Unexpected narrow exposure index; refusing reconciliation';
    END IF;
    RETURN;
  END IF;

  IF narrow_oid IS NOT NULL OR wide_oid IS NULL THEN
    RAISE EXCEPTION 'Partial exposure index state; finish reviewed online operation first';
  END IF;

  SELECT i.indrelid = 'public.watch_surface_exposure'::regclass
    AND i.indisvalid AND i.indisready AND i.indislive
    AND NOT i.indisunique AND NOT i.indisprimary AND NOT i.indisexclusion
    AND i.indnkeyatts = 8 AND i.indnatts = 8
    AND i.indpred IS NULL AND i.indexprs IS NULL
    AND am.amname = 'btree' AND c.relkind = 'i'
    AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conindid = i.indexrelid)
    AND pg_get_indexdef(i.indexrelid) =
      'CREATE INDEX watch_surface_exposure_window_item_idx ON public.watch_surface_exposure USING btree (window_id, surface, block, presentation, placement, "position", item_path, kind)'
  INTO index_ok
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_am am ON am.oid = c.relam WHERE i.indexrelid = wide_oid;
  IF index_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Unexpected wide exposure index; refusing reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.watch_surface_exposure LIMIT 1) THEN
    RAISE EXCEPTION 'Populated exposure table requires reviewed concurrent index replacement';
  END IF;

  -- Only a fresh empty environment takes ordinary DDL; recheck under its lock.
  LOCK TABLE public.watch_surface_exposure IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM public.watch_surface_exposure LIMIT 1) THEN
    RAISE EXCEPTION 'Exposure table became populated; refusing ordinary index build';
  END IF;
  CREATE INDEX watch_surface_exposure_window_item_narrow_idx
    ON public.watch_surface_exposure (window_id, surface, block, presentation, placement, position);
  DROP INDEX public.watch_surface_exposure_window_item_idx;
END $$;
COMMIT;
