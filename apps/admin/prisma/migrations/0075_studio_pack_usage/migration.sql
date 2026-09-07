

-- CreateTable
CREATE TABLE "content_pack" (
    "id" TEXT NOT NULL,
    "current_revision" INTEGER NOT NULL,

    CONSTRAINT "content_pack_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "content_pack_revision" (
    "id" TEXT NOT NULL,
    "pack_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "actor" JSONB NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_pack_revision_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "studio_asset_usage" (
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,

    CONSTRAINT "studio_asset_usage_pkey" PRIMARY KEY ("owner_type","owner_id","version_id")
);


-- CreateTable
CREATE TABLE "studio_component_version" (
    "id" TEXT NOT NULL,
    "declaration" JSONB NOT NULL,

    CONSTRAINT "studio_component_version_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "content_pack_revision_pack_id_number_key" ON "content_pack_revision"("pack_id", "number");


-- CreateIndex
CREATE UNIQUE INDEX "content_pack_revision_pack_id_idempotency_key_key" ON "content_pack_revision"("pack_id", "idempotency_key");


-- CreateIndex
CREATE INDEX "studio_asset_usage_version_id_idx" ON "studio_asset_usage"("version_id");


-- AddForeignKey
ALTER TABLE "content_pack_revision" ADD CONSTRAINT "content_pack_revision_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "content_pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "studio_asset_usage" ADD CONSTRAINT "studio_asset_usage_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "studio_asset_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION studio_retain_references(payload jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE child jsonb; ref_id text;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    IF payload ?& ARRAY['assetId','versionId','digest'] THEN
      SELECT v.id INTO ref_id FROM studio_asset_version v JOIN media_asset m ON m.id=v.media_asset_id
      WHERE v.id=payload->>'versionId' AND v.asset_id=payload->>'assetId' AND v.digest=payload->>'digest'
        AND m.checksum_sha256=v.digest AND m.status='ready' FOR SHARE OF v,m;
      IF ref_id IS NULL THEN RAISE EXCEPTION 'Unknown or mismatched Studio asset version'; END IF;
      INSERT INTO studio_asset_usage(owner_type,owner_id,version_id) VALUES(owner_type_arg,owner_id_arg,ref_id) ON CONFLICT DO NOTHING;
    END IF;
    FOR child IN SELECT value FROM jsonb_each(payload) LOOP PERFORM studio_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP PERFORM studio_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  END IF;
END $$;
CREATE FUNCTION studio_retain_document(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE selected_pack_id text; pack_doc jsonb; component jsonb; existing jsonb;
BEGIN
  PERFORM studio_retain_references(doc,owner_type_arg,owner_id_arg);
  FOR selected_pack_id IN SELECT jsonb_array_elements_text(doc->'packRevisionIds') LOOP
    SELECT document INTO pack_doc FROM content_pack_revision WHERE id=selected_pack_id FOR SHARE;
    IF pack_doc IS NULL THEN RAISE EXCEPTION 'Unknown Content Pack revision'; END IF;
    PERFORM studio_retain_references(pack_doc,owner_type_arg,owner_id_arg);
  END LOOP;
  FOR component IN SELECT jsonb_array_elements(doc->'components') LOOP
    INSERT INTO studio_component_version(id,declaration) VALUES(component->>'versionId',component) ON CONFLICT DO NOTHING;
    SELECT declaration INTO existing FROM studio_component_version WHERE id=component->>'versionId';
    IF existing IS DISTINCT FROM component THEN RAISE EXCEPTION 'Component version is immutable'; END IF;
    PERFORM studio_retain_references(component,'STUDIO_COMPONENT',component->>'versionId');
  END LOOP;
END $$;
CREATE FUNCTION studio_capture_revision_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_document(NEW.document,'STUDIO_REVISION',NEW.project_id || ':' || NEW.number); RETURN NEW; END $$;
CREATE TRIGGER studio_revision_usage AFTER INSERT ON studio_project_revision FOR EACH ROW EXECUTE FUNCTION studio_capture_revision_usage();
CREATE FUNCTION studio_capture_attempt_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb;
BEGIN
 SELECT document INTO doc FROM studio_project_revision WHERE project_id=NEW.project_id AND number=NEW.base_revision;
 PERFORM studio_retain_document(doc,'STUDIO_ATTEMPT',NEW.id);
 PERFORM studio_retain_references(NEW.result,'STUDIO_ATTEMPT',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER studio_attempt_usage AFTER INSERT OR UPDATE ON studio_attempt FOR EACH ROW EXECUTE FUNCTION studio_capture_attempt_usage();
CREATE FUNCTION studio_capture_pack_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.document,'CONTENT_PACK_REVISION',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER studio_pack_usage AFTER INSERT ON content_pack_revision FOR EACH ROW EXECUTE FUNCTION studio_capture_pack_usage();
CREATE FUNCTION studio_capture_publication_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb; result_doc jsonb;
BEGIN
 IF NEW.first_published_at IS NOT NULL AND OLD.first_published_at IS NULL THEN
   SELECT document INTO doc FROM studio_project_revision WHERE project_id=NEW.id AND number=NEW.current_revision;
   PERFORM studio_retain_document(doc,'STUDIO_PUBLICATION',NEW.id);
   FOR result_doc IN SELECT result FROM studio_attempt WHERE project_id=NEW.id AND base_revision=NEW.current_revision AND status='SUCCEEDED' LOOP
     PERFORM studio_retain_references(result_doc,'STUDIO_PUBLICATION',NEW.id);
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_publication_usage AFTER UPDATE ON studio_project FOR EACH ROW EXECUTE FUNCTION studio_capture_publication_usage();
CREATE TRIGGER studio_pack_revision_immutable BEFORE UPDATE OR DELETE ON content_pack_revision FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE TRIGGER studio_component_immutable BEFORE UPDATE OR DELETE ON studio_component_version FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE TRIGGER studio_usage_immutable BEFORE UPDATE OR DELETE ON studio_asset_usage FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE FUNCTION studio_capture_metadata_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM studio_retain_references(NEW.metadata->'narration','STUDIO_ASSET_VERSION',NEW.id);
 PERFORM studio_retain_references(NEW.metadata->'voice','STUDIO_ASSET_VERSION',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER studio_metadata_usage AFTER INSERT ON studio_asset_version FOR EACH ROW EXECUTE FUNCTION studio_capture_metadata_usage();
