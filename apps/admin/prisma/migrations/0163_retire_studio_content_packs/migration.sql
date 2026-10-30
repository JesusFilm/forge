-- Content Packs were retired by the owner; production contains no pack rows.
-- Preserve ordinary asset/component retention while removing pack dependencies.
CREATE OR REPLACE FUNCTION short_retain_document(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE component jsonb; existing jsonb;
BEGIN
  PERFORM short_retain_references(doc,owner_type_arg,owner_id_arg);
  FOR component IN SELECT jsonb_array_elements(doc->'components') LOOP
    INSERT INTO short_component_version(id,declaration) VALUES(component->>'versionId',component) ON CONFLICT DO NOTHING;
    SELECT declaration INTO existing FROM short_component_version WHERE id=component->>'versionId';
    IF existing IS DISTINCT FROM component THEN RAISE EXCEPTION 'Component version is immutable'; END IF;
    PERFORM short_retain_references(component,'SHORT_COMPONENT',component->>'versionId');
  END LOOP;
END $$;

ALTER TABLE short_plan_slot DROP COLUMN pack_revision_id;
ALTER TABLE short_plan_week DROP COLUMN pack_revision_id;
DROP TABLE short_pack;
DROP TABLE content_pack_revision;
DROP TABLE content_pack;
DROP FUNCTION short_capture_pack_usage();
DROP FUNCTION short_retain_pack_sources(jsonb, text, text);
