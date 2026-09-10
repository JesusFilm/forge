-- Consolidated unmerged Shorts schema. Original SQL sections retain dependency order.

-- 0072_shorts_authoring
CREATE TABLE short (
  id VARCHAR(128) PRIMARY KEY,
  current_revision INTEGER NOT NULL CHECK (current_revision > 0),
  owner_id VARCHAR(128) NOT NULL,
  source_video_dub_id text REFERENCES video_dub(id) ON DELETE RESTRICT,
  lifecycle VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT','PUBLISHED','UNPUBLISHED')),
  first_published_at TIMESTAMP(3), unpublished_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((lifecycle = 'DRAFT' AND first_published_at IS NULL AND unpublished_at IS NULL)
    OR (lifecycle = 'PUBLISHED' AND first_published_at IS NOT NULL AND unpublished_at IS NULL)
    OR (lifecycle = 'UNPUBLISHED' AND first_published_at IS NOT NULL AND unpublished_at IS NOT NULL))
);
CREATE INDEX short_source_video_dub_id_idx ON short(source_video_dub_id);
CREATE TABLE short_revision (
  project_id VARCHAR(128) NOT NULL REFERENCES short(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0), document JSONB NOT NULL CHECK (octet_length(document::text) <= 524288),
  actor JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, number)
);
ALTER TABLE short ADD CONSTRAINT short_current_revision_fk
  FOREIGN KEY (id, current_revision) REFERENCES short_revision(project_id, number) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE short_command (
  project_id VARCHAR(128) NOT NULL REFERENCES short(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL, input_hash VARCHAR(64) NOT NULL,
  actor JSONB NOT NULL, result JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, idempotency_key)
);

CREATE TABLE short_attempt (
  id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, base_revision INTEGER NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('GENERATION','NARRATION','RENDER')),
  status VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','STALE')),
  input_hash VARCHAR(64) NOT NULL, actor JSONB NOT NULL, instructions JSONB NOT NULL,
  result JSONB CHECK (octet_length(result::text) <= 65536), job_reference VARCHAR(128), completed_by JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  FOREIGN KEY(project_id,base_revision) REFERENCES short_revision(project_id,number) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX short_attempt_project_id_created_at_idx ON short_attempt(project_id,created_at);

CREATE TABLE short_approval (
  id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, revision INTEGER NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK(kind IN ('SCRIPT','PUBLICATION')), dependency_hash VARCHAR(64) NOT NULL,
  actor JSONB NOT NULL CHECK(actor->>'kind' = 'human'), render_attempt_id VARCHAR(128) REFERENCES short_attempt(id),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id,revision) REFERENCES short_revision(project_id,number) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ((kind = 'SCRIPT' AND render_attempt_id IS NULL) OR (kind = 'PUBLICATION' AND render_attempt_id IS NOT NULL))
);
CREATE INDEX short_approval_project_id_kind_dependency_hash_idx ON short_approval(project_id,kind,dependency_hash);

-- Revision/approval/receipt evidence is append-only, independent of API callers.
CREATE FUNCTION short_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shorts evidence is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER short_revision_immutable BEFORE UPDATE OR DELETE ON short_revision
  FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();
CREATE TRIGGER short_approval_immutable BEFORE UPDATE OR DELETE ON short_approval
  FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();
CREATE TRIGGER short_command_immutable BEFORE UPDATE OR DELETE ON short_command
  FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();

CREATE FUNCTION short_project_latch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shorts project history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.source_video_dub_id IS DISTINCT FROM OLD.source_video_dub_id THEN
    RAISE EXCEPTION 'Shorts project identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.first_published_at IS NOT NULL THEN
    IF OLD.lifecycle <> 'PUBLISHED' OR NEW.lifecycle <> 'UNPUBLISHED'
      OR NEW.first_published_at IS DISTINCT FROM OLD.first_published_at
      OR NEW.current_revision IS DISTINCT FROM OLD.current_revision
      OR NEW.unpublished_at IS NULL THEN
      RAISE EXCEPTION 'Shorts publication latch is permanent' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle = 'PUBLISHED' THEN
    IF NEW.current_revision <> OLD.current_revision THEN
      RAISE EXCEPTION 'Publish the reviewed revision only' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle <> 'DRAFT' OR NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Shorts draft revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER short_project_latch BEFORE UPDATE OR DELETE ON short
  FOR EACH ROW EXECUTE FUNCTION short_project_latch();

CREATE FUNCTION short_require_draft_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE published TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shorts attempt history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT first_published_at INTO published FROM short WHERE id = NEW.project_id FOR UPDATE;
  IF published IS NOT NULL THEN
    -- Operational completion of work admitted before publication is retained,
    -- but can only become STALE; it cannot start work or modify the composition.
    IF TG_TABLE_NAME <> 'short_attempt' OR TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'Published Shorts content is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'STALE' OR OLD.status NOT IN ('QUEUED','RUNNING')
      OR NEW.job_reference IS DISTINCT FROM OLD.job_reference THEN
      RAISE EXCEPTION 'Only stale completion of admitted work is allowed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'short_attempt' AND TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('QUEUED','RUNNING')
      OR (to_jsonb(NEW) - ARRAY['status','result','job_reference','completed_by','updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status','result','job_reference','completed_by','updated_at'])
      OR (OLD.job_reference IS NOT NULL AND NEW.job_reference IS DISTINCT FROM OLD.job_reference)
      OR (OLD.status = 'RUNNING' AND NEW.status = 'QUEUED') THEN
      RAISE EXCEPTION 'Shorts attempt identity or terminal result is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER short_revision_draft BEFORE INSERT ON short_revision
  FOR EACH ROW EXECUTE FUNCTION short_require_draft_parent();
CREATE TRIGGER short_approval_draft BEFORE INSERT ON short_approval
  FOR EACH ROW EXECUTE FUNCTION short_require_draft_parent();
CREATE TRIGGER short_attempt_draft BEFORE INSERT OR UPDATE OR DELETE ON short_attempt
  FOR EACH ROW EXECUTE FUNCTION short_require_draft_parent();

-- 0073_shorts_content_assets
-- CreateTable
CREATE TABLE "short_asset_version" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "actor" JSONB NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "short_asset_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "short_asset_version_media_asset_id_key" ON "short_asset_version"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "short_asset_version_request_key_key" ON "short_asset_version"("request_key");

-- CreateIndex
CREATE INDEX "short_asset_version_asset_id_idx" ON "short_asset_version"("asset_id");

-- CreateIndex
CREATE INDEX "short_asset_version_role_created_at_idx" ON "short_asset_version"("role", "created_at");

-- AddForeignKey
ALTER TABLE "short_asset_version" ADD CONSTRAINT "short_asset_version_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 0074_shorts_asset_retention
CREATE FUNCTION short_retain_asset_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Shorts asset versions are retained and immutable'; END $$;
CREATE TRIGGER short_asset_version_immutable BEFORE UPDATE OR DELETE ON short_asset_version FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE FUNCTION short_guard_media_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM short_asset_version WHERE media_asset_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Shorts asset bytes are retained'; END IF;
    IF (to_jsonb(NEW) - ARRAY['updated_at','folder_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','folder_id']) THEN
      RAISE EXCEPTION 'Shorts asset version is immutable; register replacement bytes as a new version';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER short_media_asset_guard BEFORE UPDATE OR DELETE ON media_asset FOR EACH ROW EXECUTE FUNCTION short_guard_media_asset();

-- 0075_shorts_pack_usage


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
CREATE TABLE "short_asset_usage" (
    "owner_type" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,

    CONSTRAINT "short_asset_usage_pkey" PRIMARY KEY ("owner_type","owner_id","version_id")
);


-- CreateTable
CREATE TABLE "short_component_version" (
    "id" TEXT NOT NULL,
    "declaration" JSONB NOT NULL,

    CONSTRAINT "short_component_version_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "content_pack_revision_pack_id_number_key" ON "content_pack_revision"("pack_id", "number");


-- CreateIndex
CREATE UNIQUE INDEX "content_pack_revision_pack_id_idempotency_key_key" ON "content_pack_revision"("pack_id", "idempotency_key");


-- CreateIndex
CREATE INDEX "short_asset_usage_version_id_idx" ON "short_asset_usage"("version_id");


-- AddForeignKey
ALTER TABLE "content_pack_revision" ADD CONSTRAINT "content_pack_revision_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "content_pack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "short_asset_usage" ADD CONSTRAINT "short_asset_usage_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "short_asset_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION short_retain_references(payload jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE child jsonb; ref_id text;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    IF payload ?& ARRAY['assetId','versionId','digest'] THEN
      SELECT v.id INTO ref_id FROM short_asset_version v JOIN media_asset m ON m.id=v.media_asset_id
      WHERE v.id=payload->>'versionId' AND v.asset_id=payload->>'assetId' AND v.digest=payload->>'digest'
        AND m.checksum_sha256=v.digest AND m.status='ready' FOR SHARE OF v,m;
      IF ref_id IS NULL THEN RAISE EXCEPTION 'Unknown or mismatched Shorts asset version'; END IF;
      INSERT INTO short_asset_usage(owner_type,owner_id,version_id) VALUES(owner_type_arg,owner_id_arg,ref_id) ON CONFLICT DO NOTHING;
    END IF;
    FOR child IN SELECT value FROM jsonb_each(payload) LOOP PERFORM short_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP PERFORM short_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  END IF;
END $$;
CREATE FUNCTION short_retain_document(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE selected_pack_id text; pack_doc jsonb; component jsonb; existing jsonb;
BEGIN
  PERFORM short_retain_references(doc,owner_type_arg,owner_id_arg);
  FOR selected_pack_id IN SELECT jsonb_array_elements_text(doc->'packRevisionIds') LOOP
    SELECT document INTO pack_doc FROM content_pack_revision WHERE id=selected_pack_id FOR SHARE;
    IF pack_doc IS NULL THEN RAISE EXCEPTION 'Unknown Content Pack revision'; END IF;
    PERFORM short_retain_references(pack_doc,owner_type_arg,owner_id_arg);
  END LOOP;
  FOR component IN SELECT jsonb_array_elements(doc->'components') LOOP
    INSERT INTO short_component_version(id,declaration) VALUES(component->>'versionId',component) ON CONFLICT DO NOTHING;
    SELECT declaration INTO existing FROM short_component_version WHERE id=component->>'versionId';
    IF existing IS DISTINCT FROM component THEN RAISE EXCEPTION 'Component version is immutable'; END IF;
    PERFORM short_retain_references(component,'SHORT_COMPONENT',component->>'versionId');
  END LOOP;
END $$;
CREATE FUNCTION short_capture_revision_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_document(NEW.document,'SHORT_REVISION',NEW.project_id || ':' || NEW.number); RETURN NEW; END $$;
CREATE TRIGGER short_revision_usage AFTER INSERT ON short_revision FOR EACH ROW EXECUTE FUNCTION short_capture_revision_usage();
CREATE FUNCTION short_capture_attempt_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb;
BEGIN
 SELECT document INTO doc FROM short_revision WHERE project_id=NEW.project_id AND number=NEW.base_revision;
 PERFORM short_retain_document(doc,'SHORT_ATTEMPT',NEW.id);
 PERFORM short_retain_references(NEW.result,'SHORT_ATTEMPT',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER short_attempt_usage AFTER INSERT OR UPDATE ON short_attempt FOR EACH ROW EXECUTE FUNCTION short_capture_attempt_usage();
CREATE FUNCTION short_capture_pack_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.document,'CONTENT_PACK_REVISION',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER short_pack_usage AFTER INSERT ON content_pack_revision FOR EACH ROW EXECUTE FUNCTION short_capture_pack_usage();
CREATE FUNCTION short_capture_publication_usage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb; result_doc jsonb;
BEGIN
 IF NEW.first_published_at IS NOT NULL AND OLD.first_published_at IS NULL THEN
   SELECT document INTO doc FROM short_revision WHERE project_id=NEW.id AND number=NEW.current_revision;
   PERFORM short_retain_document(doc,'SHORT_PUBLICATION',NEW.id);
   FOR result_doc IN SELECT result FROM short_attempt WHERE project_id=NEW.id AND base_revision=NEW.current_revision AND status='SUCCEEDED' LOOP
     PERFORM short_retain_references(result_doc,'SHORT_PUBLICATION',NEW.id);
   END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_publication_usage AFTER UPDATE ON short FOR EACH ROW EXECUTE FUNCTION short_capture_publication_usage();
CREATE TRIGGER short_pack_revision_immutable BEFORE UPDATE OR DELETE ON content_pack_revision FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE TRIGGER short_component_immutable BEFORE UPDATE OR DELETE ON short_component_version FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE TRIGGER short_usage_immutable BEFORE UPDATE OR DELETE ON short_asset_usage FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE FUNCTION short_capture_metadata_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM short_retain_references(NEW.metadata->'narration','SHORT_ASSET_VERSION',NEW.id);
 PERFORM short_retain_references(NEW.metadata->'voice','SHORT_ASSET_VERSION',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER short_metadata_usage AFTER INSERT ON short_asset_version FOR EACH ROW EXECUTE FUNCTION short_capture_metadata_usage();

-- 0076_shorts_source_snapshots


-- CreateTable
CREATE TABLE "short_source_snapshot" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "dub_id" TEXT NOT NULL,
    "edition_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "download_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,

    CONSTRAINT "short_source_snapshot_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "short_source_snapshot_request_key_key" ON "short_source_snapshot"("request_key");


-- AddForeignKey
ALTER TABLE "short_source_snapshot" ADD CONSTRAINT "short_source_snapshot_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "short_source_snapshot" ADD CONSTRAINT "short_source_snapshot_dub_id_fkey" FOREIGN KEY ("dub_id") REFERENCES "video_dub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "short_source_snapshot" ADD CONSTRAINT "short_source_snapshot_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "video_edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "short_source_snapshot" ADD CONSTRAINT "short_source_snapshot_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "video_subtitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "short_source_snapshot" ADD CONSTRAINT "short_source_snapshot_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "video_dub_download"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER short_source_immutable BEFORE UPDATE OR DELETE ON short_source_snapshot FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE FUNCTION short_capture_source_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.snapshot,'SHORT_SOURCE',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER short_source_usage AFTER INSERT ON short_source_snapshot FOR EACH ROW EXECUTE FUNCTION short_capture_source_usage();

-- 0077_shorts_transfers_experiments


-- CreateTable
CREATE TABLE "short_asset_transfer" (
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "principal" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "short_asset_transfer_pkey" PRIMARY KEY ("token_hash")
);


-- CreateTable
CREATE TABLE "short_experiment" (
    "id" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "actor" JSONB NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,

    CONSTRAINT "short_experiment_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "short_experiment_candidate" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "asset" JSONB NOT NULL,
    "provider_request_id" TEXT,
    "actual_cost_micros" BIGINT NOT NULL,
    "candidate_key" TEXT NOT NULL,
    "actor" JSONB NOT NULL,

    CONSTRAINT "short_experiment_candidate_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "short_experiment_request_key_key" ON "short_experiment"("request_key");


-- CreateIndex
CREATE UNIQUE INDEX "short_experiment_candidate_candidate_key_key" ON "short_experiment_candidate"("candidate_key");


-- AddForeignKey
ALTER TABLE "short_experiment_candidate" ADD CONSTRAINT "short_experiment_candidate_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "short_experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER short_experiment_immutable BEFORE UPDATE OR DELETE ON short_experiment FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE TRIGGER short_candidate_immutable BEFORE UPDATE OR DELETE ON short_experiment_candidate FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE FUNCTION short_capture_candidate_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.asset,'SHORT_EXPERIMENT_CANDIDATE',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER short_candidate_usage AFTER INSERT ON short_experiment_candidate FOR EACH ROW EXECUTE FUNCTION short_capture_candidate_usage();
CREATE OR REPLACE FUNCTION short_capture_metadata_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM short_retain_references(NEW.metadata->'narration','SHORT_ASSET_VERSION',NEW.id);
 PERFORM short_retain_references(NEW.metadata->'voice','SHORT_ASSET_VERSION',NEW.id);
 PERFORM short_retain_references(NEW.metadata->'dependencies','SHORT_ASSET_VERSION',NEW.id);
 RETURN NEW;
END $$;
CREATE FUNCTION short_prevent_asset_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM media_asset m JOIN short_asset_version v ON v.media_asset_id=m.id WHERE m.id<>NEW.id AND m.backend=NEW.backend AND (NEW.object_key IN (m.object_key,m.preview_object_key) OR NEW.preview_object_key IN (m.object_key,m.preview_object_key))) THEN
   RAISE EXCEPTION 'Cannot alias retained Shorts bytes; reference the immutable version';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_asset_alias_guard BEFORE INSERT OR UPDATE ON media_asset FOR EACH ROW EXECUTE FUNCTION short_prevent_asset_alias();

-- 0078_shorts_source_dependency_guards
CREATE FUNCTION short_retain_pack_sources(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE source_entry jsonb; source_doc jsonb;
BEGIN
 FOR source_entry IN SELECT jsonb_array_elements(doc->'sources') LOOP
   IF source_entry ? 'sourceSnapshotId' THEN
     SELECT snapshot INTO source_doc FROM short_source_snapshot WHERE id=source_entry->>'sourceSnapshotId' FOR SHARE;
     IF source_doc IS NULL OR (source_entry->'asset' IS DISTINCT FROM source_doc->'source'->'export' AND source_entry->'asset' IS DISTINCT FROM source_doc->'source'->'subtitle'->'asset') THEN
       RAISE EXCEPTION 'Pack source does not match its pinned source snapshot';
     END IF;
     PERFORM short_retain_references(source_doc,owner_type_arg,owner_id_arg);
   END IF;
 END LOOP;
END $$;
CREATE OR REPLACE FUNCTION short_capture_pack_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM short_retain_references(NEW.document,'CONTENT_PACK_REVISION',NEW.id);
 PERFORM short_retain_pack_sources(NEW.document,'CONTENT_PACK_REVISION',NEW.id);
 RETURN NEW;
END $$;
CREATE FUNCTION short_validate_source_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; source_doc jsonb;
BEGIN
 FOR item IN SELECT jsonb_array_elements(NEW.document->'items') LOOP
   IF item->>'kind' = 'video' THEN
     SELECT snapshot INTO source_doc FROM short_source_snapshot
       WHERE (snapshot->'source' - ARRAY['startMs','endMs']) = (item->'source' - ARRAY['startMs','endMs']) LIMIT 1;
     IF source_doc IS NULL OR (item->'source'->>'endMs')::numeric > (source_doc->>'durationMs')::numeric OR (item->'source'->>'startMs')::numeric < 0 OR (item->'source'->>'endMs')::numeric <= (item->'source'->>'startMs')::numeric THEN
       RAISE EXCEPTION 'Invalid pinned source or range';
     END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER short_revision_source_guard BEFORE INSERT ON short_revision FOR EACH ROW EXECUTE FUNCTION short_validate_source_references();
CREATE OR REPLACE FUNCTION short_retain_document(doc jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE selected_pack_id text; pack_doc jsonb; component jsonb; existing jsonb;
BEGIN
  PERFORM short_retain_references(doc,owner_type_arg,owner_id_arg);
  FOR selected_pack_id IN SELECT jsonb_array_elements_text(doc->'packRevisionIds') LOOP
    SELECT document INTO pack_doc FROM content_pack_revision WHERE id=selected_pack_id FOR SHARE;
    IF pack_doc IS NULL THEN RAISE EXCEPTION 'Unknown Content Pack revision'; END IF;
    PERFORM short_retain_references(pack_doc,owner_type_arg,owner_id_arg);
    PERFORM short_retain_pack_sources(pack_doc,owner_type_arg,owner_id_arg);
  END LOOP;
  FOR component IN SELECT jsonb_array_elements(doc->'components') LOOP
    INSERT INTO short_component_version(id,declaration) VALUES(component->>'versionId',component) ON CONFLICT DO NOTHING;
    SELECT declaration INTO existing FROM short_component_version WHERE id=component->>'versionId';
    IF existing IS DISTINCT FROM component THEN RAISE EXCEPTION 'Component version is immutable'; END IF;
    PERFORM short_retain_references(component,'SHORT_COMPONENT',component->>'versionId');
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION short_retain_references(payload jsonb, owner_type_arg text, owner_id_arg text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE child jsonb; ref_id text;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    IF payload ?& ARRAY['assetId','versionId','digest'] THEN
      SELECT v.id INTO ref_id FROM short_asset_version v JOIN media_asset m ON m.id=v.media_asset_id
      WHERE v.id=payload->>'versionId' AND v.asset_id=payload->>'assetId' AND v.digest=payload->>'digest'
        AND m.checksum_sha256=v.digest AND m.status='ready' FOR SHARE OF v,m;
      IF ref_id IS NULL THEN RAISE EXCEPTION 'Unknown or mismatched Shorts asset version'; END IF;
      INSERT INTO short_asset_usage(owner_type,owner_id,version_id) VALUES(owner_type_arg,owner_id_arg,ref_id) ON CONFLICT DO NOTHING;
      INSERT INTO short_asset_usage(owner_type,owner_id,version_id) SELECT owner_type_arg,owner_id_arg,version_id FROM short_asset_usage WHERE owner_type='SHORT_ASSET_VERSION' AND owner_id=ref_id ON CONFLICT DO NOTHING;
    END IF;
    FOR child IN SELECT value FROM jsonb_each(payload) LOOP PERFORM short_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR child IN SELECT value FROM jsonb_array_elements(payload) LOOP PERFORM short_retain_references(child,owner_type_arg,owner_id_arg); END LOOP;
  END IF;
END $$;

-- 0078a_shorts_source_revision_guard
-- Parenthesize JSON extraction before subtracting excluded source range keys.
CREATE OR REPLACE FUNCTION short_validate_source_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item jsonb; source_doc jsonb;
BEGIN
 FOR item IN SELECT jsonb_array_elements(NEW.document->'items') LOOP
   IF item->>'kind' = 'video' THEN
     SELECT snapshot INTO source_doc FROM short_source_snapshot
       WHERE ((snapshot->'source') - ARRAY['startMs','endMs']) = ((item->'source') - ARRAY['startMs','endMs']) LIMIT 1;
     IF source_doc IS NULL OR (item->'source'->>'endMs')::numeric > (source_doc->>'durationMs')::numeric OR (item->'source'->>'startMs')::numeric < 0 OR (item->'source'->>'endMs')::numeric <= (item->'source'->>'startMs')::numeric THEN
       RAISE EXCEPTION 'Invalid pinned source or range';
     END IF;
   END IF;
 END LOOP;
 RETURN NEW;
END $$;

-- 0079_shorts_catalog_identity
CREATE TABLE short_release (
 id text PRIMARY KEY, project_id varchar(128) NOT NULL, revision integer NOT NULL,
 render_attempt_id varchar(128) NOT NULL UNIQUE REFERENCES short_attempt(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 title text NOT NULL, language_slug text NOT NULL,
 duration_ms integer NOT NULL CHECK(duration_ms>0), width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0), fps integer NOT NULL CHECK(fps>0),
 mux_asset_id text NOT NULL UNIQUE, mux_playback_id text NOT NULL UNIQUE,
 snapshot jsonb NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(project_id,idempotency_key),
 FOREIGN KEY(project_id,revision) REFERENCES short_revision(project_id,number) ON DELETE RESTRICT
);
CREATE TABLE short_derivation (
 release_id text NOT NULL REFERENCES short_release(id) ON DELETE RESTRICT,
 item_id text NOT NULL, source_snapshot_id text NOT NULL REFERENCES short_source_snapshot(id) ON DELETE RESTRICT,
 start_ms integer NOT NULL CHECK(start_ms>=0), end_ms integer NOT NULL CHECK(end_ms>start_ms),
 start_frame integer NOT NULL CHECK(start_frame>=0), duration_in_frames integer NOT NULL CHECK(duration_in_frames>0),
 PRIMARY KEY(release_id,item_id)
);
CREATE TABLE short_pack (
 release_id text NOT NULL REFERENCES short_release(id) ON DELETE RESTRICT,
 pack_revision_id text NOT NULL REFERENCES content_pack_revision(id) ON DELETE RESTRICT,
 PRIMARY KEY(release_id,pack_revision_id)
);
CREATE TRIGGER short_catalog_release_immutable BEFORE UPDATE OR DELETE ON short_release FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();
CREATE TRIGGER short_catalog_derivation_immutable BEFORE UPDATE OR DELETE ON short_derivation FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();
CREATE TRIGGER short_catalog_pack_immutable BEFORE UPDATE OR DELETE ON short_pack FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();
CREATE FUNCTION short_catalog_retain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM short_retain_references(NEW.snapshot,'SHORT_CATALOG_RELEASE',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER short_catalog_retain AFTER INSERT ON short_release FOR EACH ROW EXECUTE FUNCTION short_catalog_retain();
-- No public publication path exists in this slice. Feat-460 must add its
-- transaction-bound visibility transition while keeping content immutable.


-- 0080_shorts_production_execution
CREATE TABLE short_production_run (
 id TEXT PRIMARY KEY, attempt_id VARCHAR(128) UNIQUE REFERENCES short_attempt(id) ON DELETE RESTRICT,
 experiment_id TEXT UNIQUE REFERENCES short_experiment(id) ON DELETE RESTRICT,
 actor JSONB NOT NULL, max_cost_micros BIGINT NOT NULL CHECK(max_cost_micros BETWEEN 0 AND 100000000),
 state TEXT NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','CANCELLED','COMPLETED')),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((attempt_id IS NOT NULL)::int + (experiment_id IS NOT NULL)::int = 1)
);
CREATE TABLE short_production_call (
 run_id TEXT NOT NULL REFERENCES short_production_run(id) ON DELETE RESTRICT,
 key TEXT NOT NULL CHECK(length(key) <= 128), input_digest VARCHAR(64) NOT NULL,
 reserve_micros BIGINT NOT NULL CHECK(reserve_micros >= 0),
 state TEXT NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','COMPLETED','FAILED','AMBIGUOUS')),
 result JSONB, PRIMARY KEY(run_id,key)
);
CREATE FUNCTION short_guard_production_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state <> 'READY' OR (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'Production admission is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_production_run_guard BEFORE UPDATE OR DELETE ON short_production_run FOR EACH ROW EXECUTE FUNCTION short_guard_production_run();
CREATE FUNCTION short_guard_production_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state <> 'RUNNING' OR (to_jsonb(NEW)-ARRAY['state','result']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result']) THEN RAISE EXCEPTION 'Paid execution is consumed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_production_call_guard BEFORE UPDATE OR DELETE ON short_production_call FOR EACH ROW EXECUTE FUNCTION short_guard_production_call();
CREATE FUNCTION short_capture_production_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.result,'SHORT_PRODUCTION_CALL',NEW.run_id || ':' || NEW.key); RETURN NEW; END $$;
CREATE TRIGGER short_production_call_usage AFTER INSERT OR UPDATE ON short_production_call FOR EACH ROW EXECUTE FUNCTION short_capture_production_call();

-- 0081_shorts_unknown_provider_cost
-- A provider that does not report money has an unknown charge, never a fabricated zero.
ALTER TABLE short_experiment_candidate ALTER COLUMN actual_cost_micros DROP NOT NULL;

-- 0082_shorts_experiment_selection
CREATE TABLE short_experiment_selection (
 id TEXT PRIMARY KEY,
 experiment_id TEXT NOT NULL REFERENCES short_experiment(id) ON DELETE RESTRICT,
 candidate_key TEXT NOT NULL REFERENCES short_experiment_candidate(candidate_key) ON DELETE RESTRICT,
 request_key TEXT NOT NULL UNIQUE,
 input_hash TEXT NOT NULL,
 asset JSONB NOT NULL,
 actor JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX short_experiment_selection_experiment_id_created_at_idx ON short_experiment_selection(experiment_id,created_at);
CREATE TRIGGER short_selection_immutable BEFORE UPDATE OR DELETE ON short_experiment_selection FOR EACH ROW EXECUTE FUNCTION short_retain_asset_version();
CREATE FUNCTION short_capture_selection_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.asset,'SHORT_EXPERIMENT_SELECTION',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER short_selection_usage AFTER INSERT ON short_experiment_selection FOR EACH ROW EXECUTE FUNCTION short_capture_selection_usage();

-- 0083_shorts_render_leases
CREATE TABLE short_render_job (
 attempt_id VARCHAR(128) PRIMARY KEY REFERENCES short_attempt(id) ON DELETE RESTRICT,
 snapshot JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETED','CANCELLED','FAILED')),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 3),
 lease_id TEXT, lease_expires_at TIMESTAMP(3),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION short_guard_render_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state IN ('COMPLETED','CANCELLED','FAILED')
 OR NEW.attempt_id<>OLD.attempt_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.created_at<>OLD.created_at
 OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1
 THEN RAISE EXCEPTION 'Render admission and terminal job are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_render_job_guard BEFORE UPDATE OR DELETE ON short_render_job FOR EACH ROW EXECUTE FUNCTION short_guard_render_job();
CREATE FUNCTION short_retain_render_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.snapshot,'SHORT_RENDER_JOB',NEW.attempt_id); RETURN NEW; END $$;
CREATE TRIGGER short_render_job_retain AFTER INSERT ON short_render_job FOR EACH ROW EXECUTE FUNCTION short_retain_render_job();

-- 0084_shorts_render_execution_results
CREATE TABLE short_render_lease (
 attempt_id VARCHAR(128) NOT NULL REFERENCES short_render_job(attempt_id) ON DELETE RESTRICT,
 lease_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 3),
 expires_at TIMESTAMP(3) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(attempt_id,lease_id),
 UNIQUE(attempt_id,generation)
);
CREATE TABLE short_render_execution (
 attempt_id VARCHAR(128) NOT NULL REFERENCES short_render_job(attempt_id) ON DELETE RESTRICT,
 lease_id TEXT NOT NULL,
 request_hash VARCHAR(64) NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SUCCEEDED','FAILED','CANCELLED')),
 result JSONB NOT NULL,
 admitted BOOLEAN NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(attempt_id,lease_id),
 FOREIGN KEY(attempt_id,lease_id) REFERENCES short_render_lease(attempt_id,lease_id) ON DELETE RESTRICT
);
CREATE FUNCTION short_guard_render_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Render execution results are immutable'; END $$;
CREATE TRIGGER short_render_execution_guard BEFORE UPDATE OR DELETE ON short_render_execution FOR EACH ROW EXECUTE FUNCTION short_guard_render_execution();
CREATE FUNCTION short_retain_render_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.result,'SHORT_RENDER_EXECUTION',NEW.attempt_id||':'||NEW.lease_id); RETURN NEW; END $$;
CREATE TRIGGER short_render_execution_retain AFTER INSERT ON short_render_execution FOR EACH ROW EXECUTE FUNCTION short_retain_render_execution();

CREATE TRIGGER short_render_lease_guard BEFORE UPDATE OR DELETE ON short_render_lease FOR EACH ROW EXECUTE FUNCTION short_guard_render_execution();

-- 0085_shorts_publication_admission
CREATE TABLE short_readiness (
 id text PRIMARY KEY, sequence bigserial UNIQUE NOT NULL,
 release_id text NOT NULL REFERENCES short_release(id) ON DELETE RESTRICT,
 attempt_id varchar(128) NOT NULL, lease_id text NOT NULL,
 proof jsonb NOT NULL CHECK(octet_length(proof::text)<=32768),
 request_hash text NOT NULL,
 checked_at timestamp(3) NOT NULL, expires_at timestamp(3) NOT NULL CHECK(expires_at>checked_at),
 FOREIGN KEY(attempt_id,lease_id) REFERENCES short_render_execution(attempt_id,lease_id) ON DELETE RESTRICT
);
CREATE INDEX short_catalog_readiness_latest ON short_readiness(release_id,sequence DESC);
CREATE TRIGGER short_catalog_readiness_immutable BEFORE UPDATE OR DELETE ON short_readiness FOR EACH ROW EXECUTE FUNCTION short_reject_evidence_mutation();
CREATE TABLE short_publication (
 release_id text PRIMARY KEY REFERENCES short_release(id) ON DELETE RESTRICT,
 project_id varchar(128) NOT NULL UNIQUE REFERENCES short(id) ON DELETE RESTRICT,
 approval_id varchar(128) NOT NULL REFERENCES short_approval(id) ON DELETE RESTRICT,
 readiness_id text NOT NULL REFERENCES short_readiness(id) ON DELETE RESTRICT,
 published_at timestamp(3) NOT NULL,
 revoked_at timestamp(3)
);
CREATE FUNCTION short_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
 OR NOT EXISTS(SELECT 1 FROM short WHERE id=NEW.project_id AND lifecycle='UNPUBLISHED' AND first_published_at IS NOT NULL AND unpublished_at=NEW.revoked_at)
 THEN RAISE EXCEPTION 'Publication can only be permanently revoked by its project latch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_publication_guard BEFORE UPDATE OR DELETE ON short_publication FOR EACH ROW EXECUTE FUNCTION short_publication_guard();
CREATE FUNCTION short_publication_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM short_publication p JOIN short s ON s.id=p.project_id JOIN short_release r ON r.id=p.release_id JOIN short_approval a ON a.id=p.approval_id JOIN short_readiness ready ON ready.id=p.readiness_id
 WHERE p.release_id=NEW.release_id AND r.project_id=s.id AND r.revision=s.current_revision AND a.project_id=s.id AND a.revision=r.revision AND a.render_attempt_id=r.render_attempt_id AND a.kind='PUBLICATION' AND ready.release_id=r.id AND ready.attempt_id=r.render_attempt_id AND s.first_published_at=p.published_at AND s.lifecycle IN ('PUBLISHED','UNPUBLISHED'))
 THEN RAISE EXCEPTION 'Publication must commit with its exact project latch and evidence'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER short_publication_committed AFTER INSERT ON short_publication DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION short_publication_committed();

-- Only visibility flags may follow the dedicated publication latch. All staged
-- content, URLs, identity, metadata, timing and media remain permanently frozen.
CREATE FUNCTION short_publication_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.lifecycle='UNPUBLISHED' AND OLD.lifecycle='PUBLISHED' THEN
  UPDATE short_publication SET revoked_at=NEW.unpublished_at WHERE project_id=NEW.id AND revoked_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_publication_visibility AFTER UPDATE ON short FOR EACH ROW EXECUTE FUNCTION short_publication_visibility();

-- Delivery acknowledgements never grant visibility. Missing acknowledgement of
-- the committed publication/revocation is durable pending work after restart.

-- 0086_shorts_render_retained_assets
-- Operational retention precedes execution finalization. Registration response
-- loss cannot lose the exact asset/issued-lease edge, including late output.
CREATE TABLE short_render_retained_asset (
 attempt_id VARCHAR(128) NOT NULL,
 lease_id TEXT NOT NULL,
 asset_version_id TEXT NOT NULL REFERENCES short_asset_version(id) ON DELETE RESTRICT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(attempt_id,lease_id,asset_version_id),
 FOREIGN KEY(attempt_id,lease_id) REFERENCES short_render_lease(attempt_id,lease_id) ON DELETE RESTRICT
);
CREATE TRIGGER short_render_retained_asset_guard BEFORE UPDATE OR DELETE ON short_render_retained_asset
 FOR EACH ROW EXECUTE FUNCTION short_guard_render_execution();
CREATE FUNCTION short_attach_render_asset() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recorded JSONB; render_attempt TEXT; render_lease TEXT;
BEGIN
 recorded := NEW.metadata #> '{provenance,recorded}';
 IF recorded->>'profileId' IS DISTINCT FROM 'shorts-render-1/900s-2cpu-2g-128p-96child-128m' THEN RETURN NEW; END IF;
 -- Attribution is not producer authority. Human/browser registrations cannot
 -- manufacture operational edges even with copied render metadata.
 IF NEW.actor->>'kind' IS DISTINCT FROM 'service' OR NEW.actor->>'id' IS DISTINCT FROM 'manager_backend'
 THEN RAISE EXCEPTION 'Trusted render producer required'; END IF;
 render_attempt := recorded->>'attemptId'; render_lease := recorded->>'leaseId';
 IF NEW.role NOT IN ('render','manifest') OR render_attempt IS NULL OR render_lease IS NULL
 OR NOT EXISTS(SELECT 1 FROM short_render_lease lease JOIN short_attempt attempt ON attempt.id=lease.attempt_id
   WHERE lease.attempt_id=render_attempt AND lease.lease_id=render_lease AND attempt.kind='RENDER')
 THEN RAISE EXCEPTION 'Issued render lease required'; END IF;
 INSERT INTO short_render_retained_asset(attempt_id,lease_id,asset_version_id)
 VALUES(render_attempt,render_lease,NEW.id);
 PERFORM short_retain_references(jsonb_build_object('assetId',NEW.asset_id,'versionId',NEW.id,'digest',NEW.digest),
   'SHORT_RENDER_RETENTION',render_attempt||':'||render_lease);
 RETURN NEW;
END $$;
CREATE TRIGGER short_render_asset_attach AFTER INSERT ON short_asset_version
 FOR EACH ROW EXECUTE FUNCTION short_attach_render_asset();

-- 0087_shorts_mux_processing
CREATE TABLE short_mux_job (
 id TEXT PRIMARY KEY,
 attempt_id VARCHAR(128) UNIQUE NOT NULL REFERENCES short_attempt(id) ON DELETE RESTRICT,
 snapshot JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DISPATCHING','AMBIGUOUS','PROCESSING','READY','FAILED')),
 dispatch_id TEXT UNIQUE,
 asset_id TEXT UNIQUE,
 readiness JSONB,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION short_guard_mux_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.attempt_id<>OLD.attempt_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
 OR NEW.created_at<>OLD.created_at OR (OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id)
 OR (OLD.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id)
 OR (NEW.state='PENDING' AND OLD.state<>'PENDING')
 OR (OLD.state IN ('READY','FAILED') AND NEW.state<>OLD.state)
 THEN RAISE EXCEPTION 'Mux admission and consumed dispatch are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_mux_job_guard BEFORE UPDATE OR DELETE ON short_mux_job FOR EACH ROW EXECUTE FUNCTION short_guard_mux_job();
CREATE FUNCTION short_retain_mux_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM short_retain_references(NEW.snapshot,'SHORT_MUX_JOB',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER short_mux_job_retain AFTER INSERT ON short_mux_job FOR EACH ROW EXECUTE FUNCTION short_retain_mux_job();

-- 0088_shorts_calendar
-- CreateTable
CREATE TABLE "short_calendar" (
    "id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,

    CONSTRAINT "short_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_plan_slot" (
    "id" VARCHAR(128) NOT NULL,
    "calendar_id" VARCHAR(128) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(300) NOT NULL DEFAULT '',
    "theme" TEXT NOT NULL DEFAULT '',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "pack_revision_id" TEXT,
    "project_id" VARCHAR(128),
    "provenance" JSONB,

    CONSTRAINT "short_plan_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_plan_week" (
    "calendar_id" VARCHAR(128) NOT NULL,
    "start_date" VARCHAR(10) NOT NULL,
    "pack_revision_id" TEXT,
    "theme" TEXT NOT NULL,

    CONSTRAINT "short_plan_week_pkey" PRIMARY KEY ("calendar_id","start_date")
);

-- CreateTable
CREATE TABLE "short_calendar_command" (
    "calendar_id" VARCHAR(128) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "short_calendar_command_pkey" PRIMARY KEY ("calendar_id","key")
);

-- CreateTable
CREATE TABLE "short_planning_run" (
    "id" VARCHAR(128) NOT NULL,
    "calendar_id" VARCHAR(128) NOT NULL,
    "occurrence" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "short_planning_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_schedule_authorization" (
    "id" VARCHAR(128) NOT NULL,
    "slot_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "project_id" VARCHAR(128) NOT NULL,
    "revision" INTEGER NOT NULL,
    "approval_id" VARCHAR(128) NOT NULL,
    "render_attempt_id" VARCHAR(128) NOT NULL,
    "release_id" VARCHAR(128) NOT NULL,
    "operator_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "latest_allowed_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "submission" JSONB,
    "outcome" VARCHAR(40),

    CONSTRAINT "short_schedule_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "short_plan_slot_project_id_idx" ON "short_plan_slot"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "short_plan_slot_calendar_id_date_key" ON "short_plan_slot"("calendar_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "short_planning_run_calendar_id_occurrence_key" ON "short_planning_run"("calendar_id", "occurrence");

-- CreateIndex
CREATE INDEX "short_schedule_authorization_due_at_idx" ON "short_schedule_authorization"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "short_schedule_authorization_slot_id_version_key" ON "short_schedule_authorization"("slot_id", "version");

-- AddForeignKey
ALTER TABLE "short_plan_slot" ADD CONSTRAINT "short_plan_slot_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "short_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_plan_slot" ADD CONSTRAINT "short_plan_slot_pack_revision_id_fkey" FOREIGN KEY ("pack_revision_id") REFERENCES "content_pack_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_plan_slot" ADD CONSTRAINT "short_plan_slot_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "short"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_plan_week" ADD CONSTRAINT "short_plan_week_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "short_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_plan_week" ADD CONSTRAINT "short_plan_week_pack_revision_id_fkey" FOREIGN KEY ("pack_revision_id") REFERENCES "content_pack_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_calendar_command" ADD CONSTRAINT "short_calendar_command_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "short_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_planning_run" ADD CONSTRAINT "short_planning_run_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "short_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_schedule_authorization" ADD CONSTRAINT "short_schedule_authorization_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "short_plan_slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_schedule_authorization" ADD CONSTRAINT "short_schedule_authorization_project_id_revision_fkey" FOREIGN KEY ("project_id", "revision") REFERENCES "short_revision"("project_id", "number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_schedule_authorization" ADD CONSTRAINT "short_schedule_authorization_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "short_approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_schedule_authorization" ADD CONSTRAINT "short_schedule_authorization_render_attempt_id_fkey" FOREIGN KEY ("render_attempt_id") REFERENCES "short_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_schedule_authorization" ADD CONSTRAINT "short_schedule_authorization_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "short_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_schedule_authorization" ADD CONSTRAINT "short_schedule_authorization_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 0089_shorts_calendar_history
-- Calendar authorization and attempted delivery are evidence, not mutable draft content.
ALTER TABLE short_calendar ADD CONSTRAINT short_calendar_version_positive CHECK (version > 0);
ALTER TABLE short_plan_slot ADD CONSTRAINT short_slot_version_nonnegative CHECK (version >= 0);
ALTER TABLE short_schedule_authorization ADD CONSTRAINT short_schedule_window CHECK (version > 0 AND latest_allowed_at >= due_at AND latest_allowed_at <= due_at + interval '1 day');
CREATE FUNCTION short_calendar_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calendar history is retained'; END IF;
  IF TG_TABLE_NAME = 'short_calendar_command' THEN
    RAISE EXCEPTION 'Calendar receipts are immutable';
  ELSIF TG_TABLE_NAME = 'short_schedule_authorization' THEN
    IF (to_jsonb(NEW) - ARRAY['revoked_at','consumed_at','submission','outcome']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['revoked_at','consumed_at','submission','outcome'])
       OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
       OR (OLD.consumed_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
       OR (OLD.submission IS NOT NULL AND NEW.submission IS DISTINCT FROM OLD.submission)
    THEN RAISE EXCEPTION 'Schedule authorization and submitted envelope are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'short_planning_run' THEN
    IF (to_jsonb(NEW) - ARRAY['result','status','finished_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['result','status','finished_at'])
       OR OLD.status <> 'RUNNING'
    THEN RAISE EXCEPTION 'Planning inputs and terminal results are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER short_calendar_receipt_guard BEFORE UPDATE OR DELETE ON short_calendar_command FOR EACH ROW EXECUTE FUNCTION short_calendar_history_guard();
CREATE TRIGGER short_schedule_authorization_guard BEFORE UPDATE OR DELETE ON short_schedule_authorization FOR EACH ROW EXECUTE FUNCTION short_calendar_history_guard();
CREATE TRIGGER short_planning_run_guard BEFORE UPDATE OR DELETE ON short_planning_run FOR EACH ROW EXECUTE FUNCTION short_calendar_history_guard();

-- 0090_shorts_planner_dispatch
ALTER TABLE short_planning_run ADD COLUMN actor jsonb;
CREATE OR REPLACE FUNCTION short_calendar_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calendar history is retained'; END IF;
  IF TG_TABLE_NAME = 'short_calendar_command' THEN
    RAISE EXCEPTION 'Calendar receipts are immutable';
  ELSIF TG_TABLE_NAME = 'short_schedule_authorization' THEN
    IF (to_jsonb(NEW) - ARRAY['revoked_at','consumed_at','submission','outcome']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['revoked_at','consumed_at','submission','outcome'])
       OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
       OR (OLD.consumed_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
       OR (OLD.submission IS NOT NULL AND NEW.submission IS DISTINCT FROM OLD.submission)
    THEN RAISE EXCEPTION 'Schedule authorization and submitted envelope are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'short_planning_run' THEN
    IF (to_jsonb(NEW) - ARRAY['result','status','finished_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['result','status','finished_at'])
       OR OLD.status NOT IN ('RUNNING','DISPATCHED')
       OR (OLD.status='DISPATCHED' AND NEW.status='RUNNING')
    THEN RAISE EXCEPTION 'Planning inputs and terminal results are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;

-- 0091_shorts_calendar_week_provenance
-- Existing weekly settings remain operator-owned. Generated weekly themes retain
-- their immutable run, native instruction and exact pack/source references.
ALTER TABLE short_plan_week ADD COLUMN provenance JSONB;

-- 0092_shorts_schedule_dispatch
-- Delivery leases are separate from immutable human authorization/consumption.
CREATE TABLE short_schedule_dispatch (
  authorization_id varchar(128) PRIMARY KEY REFERENCES short_schedule_authorization(id) ON DELETE RESTRICT,
  state varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','RUNNING','RETRY','ACCEPTED','BLOCKED')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  lease_id uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error varchar(80),
  CHECK ((lease_id IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX short_schedule_dispatch_due ON short_schedule_dispatch(next_attempt_at, authorization_id) WHERE state IN ('PENDING','RUNNING','RETRY');

-- 0093_shorts_render_worker_assignment
-- Assignment is part of the already immutable issued lease. Unassigned historic
-- leases remain valid; there is no separate worker registry or claim authority.
ALTER TABLE short_render_lease
 ADD COLUMN pool_id VARCHAR(128),
 ADD COLUMN worker_id VARCHAR(128),
 ADD COLUMN dispatch_id UUID,
 ADD CONSTRAINT short_render_lease_assignment_complete CHECK (
   (pool_id IS NULL AND worker_id IS NULL AND dispatch_id IS NULL) OR
   (pool_id IS NOT NULL AND worker_id IS NOT NULL AND dispatch_id IS NOT NULL
    AND length(pool_id) > 0 AND length(worker_id) > 0)
 );
CREATE UNIQUE INDEX short_render_lease_dispatch_id_key ON short_render_lease(dispatch_id);
CREATE INDEX short_render_lease_pool_id_worker_id_expires_at_idx ON short_render_lease(pool_id,worker_id,expires_at);
