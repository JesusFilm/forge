CREATE FUNCTION studio_retain_pack_sources(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source_entry jsonb; source_doc jsonb;
BEGIN
 FOR source_entry IN SELECT jsonb_array_elements(doc->'sources') LOOP
   IF source_entry ? 'sourceSnapshotId' THEN
     SELECT snapshot INTO source_doc FROM studio_source_snapshot WHERE id=source_entry->>'sourceSnapshotId' FOR SHARE;
     IF source_doc IS NULL OR (source_entry->'asset' IS DISTINCT FROM source_doc->'source'->'export' AND source_entry->'asset' IS DISTINCT FROM source_doc->'source'->'subtitle'->'asset') THEN
       RAISE EXCEPTION 'Pack source does not match its pinned source snapshot';
     END IF;
     PERFORM studio_retain_references(source_doc,owner_type_arg,owner_id_arg);
   END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION studio_capture_pack_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM studio_retain_references(NEW.document,'CONTENT_PACK_REVISION',NEW.id);
 PERFORM studio_retain_pack_sources(NEW.document,'CONTENT_PACK_REVISION',NEW.id);
 RETURN NEW;
END $$;
CREATE FUNCTION studio_validate_source_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; source_doc jsonb;
BEGIN
 FOR item IN SELECT jsonb_array_elements(NEW.document->'items') LOOP
   IF item->>'kind' = 'video' THEN
     SELECT snapshot INTO source_doc FROM studio_source_snapshot
       WHERE (snapshot->'source' - ARRAY['startMs','endMs']) = (item->'source' - ARRAY['startMs','endMs']) LIMIT 1;
     IF source_doc IS NULL OR (item->'source'->>'endMs')::numeric > (source_doc->>'durationMs')::numeric OR (item->'source'->>'startMs')::numeric < 0 OR (item->'source'->>'endMs')::numeric <= (item->'source'->>'startMs')::numeric THEN
       RAISE EXCEPTION 'Invalid pinned source or range';
     END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_revision_source_guard BEFORE INSERT ON studio_project_revision FOR EACH ROW EXECUTE FUNCTION studio_validate_source_references();
CREATE OR REPLACE FUNCTION studio_retain_document(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE selected_pack_id text; pack_doc jsonb; component jsonb; existing jsonb;
BEGIN
  PERFORM studio_retain_references(doc,owner_type_arg,owner_id_arg);
  FOR selected_pack_id IN SELECT jsonb_array_elements_text(doc->'packRevisionIds') LOOP
    SELECT document INTO pack_doc FROM content_pack_revision WHERE id=selected_pack_id FOR SHARE;
    IF pack_doc IS NULL THEN RAISE EXCEPTION 'Unknown Content Pack revision'; END IF;
    PERFORM studio_retain_references(pack_doc,owner_type_arg,owner_id_arg);
    PERFORM studio_retain_pack_sources(pack_doc,owner_type_arg,owner_id_arg);
  END LOOP;
  FOR component IN SELECT jsonb_array_elements(doc->'components') LOOP
    INSERT INTO studio_component_version(id,declaration) VALUES(component->>'versionId',component) ON CONFLICT DO NOTHING;
    SELECT declaration INTO existing FROM studio_component_version WHERE id=component->>'versionId';
    IF existing IS DISTINCT FROM component THEN RAISE EXCEPTION 'Component version is immutable'; END IF;
    PERFORM studio_retain_references(component,'STUDIO_COMPONENT',component->>'versionId');
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION studio_retain_references(payload jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE child jsonb; ref_id text;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    IF payload ?& ARRAY['assetId','versionId','digest'] THEN
      SELECT v.id INTO ref_id FROM studio_asset_version v JOIN media_asset m ON m.id=v.media_asset_id
      WHERE v.id=payload->>'versionId' AND v.asset_id=payload->>'assetId' AND v.digest=payload->>'digest'
        AND m.checksum_sha256=v.digest AND m.status='ready' FOR SHARE OF v,m;
      IF ref_id IS NULL THEN RAISE EXCEPTION 'Unknown or mismatched Studio asset version'; END IF;
      INSERT INTO studio_asset_usage(owner_type,owner_id,version_id) VALUES(owner_type_arg,owner_id_arg,ref_id) ON CONFLICT DO NOTHING;
      INSERT INTO studio_asset_usage(owner_type,owner_id,version_id) SELECT owner_type_arg,owner_id_arg,version_id FROM studio_asset_usage WHERE owner_type='STUDIO_ASSET_VERSION' AND owner_id=ref_id ON CONFLICT DO NOTHING;
    END IF;
    FOR child IN SELECT value FROM jsonb_each(payload) LOOP PERFORM studio_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP PERFORM studio_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  END IF;
END $$;
