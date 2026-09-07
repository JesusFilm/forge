-- Parenthesize JSON extraction before subtracting excluded source range keys.
CREATE OR REPLACE FUNCTION studio_validate_source_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; source_doc jsonb;
BEGIN
 FOR item IN SELECT jsonb_array_elements(NEW.document->'items') LOOP
   IF item->>'kind' = 'video' THEN
     SELECT snapshot INTO source_doc FROM studio_source_snapshot
       WHERE ((snapshot->'source') - ARRAY['startMs','endMs']) = ((item->'source') - ARRAY['startMs','endMs']) LIMIT 1;
     IF source_doc IS NULL OR (item->'source'->>'endMs')::numeric > (source_doc->>'durationMs')::numeric OR (item->'source'->>'startMs')::numeric < 0 OR (item->'source'->>'endMs')::numeric <= (item->'source'->>'startMs')::numeric THEN
       RAISE EXCEPTION 'Invalid pinned source or range';
     END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
