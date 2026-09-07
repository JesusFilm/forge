ALTER TABLE "video" ALTER COLUMN core_id DROP NOT NULL;
ALTER TABLE "video" ADD CONSTRAINT "video_real_core_identity" CHECK ((source <> 'core' OR core_id IS NOT NULL) AND (core_id IS NULL OR length(btrim(core_id)) > 0));
ALTER TABLE "video_dub" ALTER COLUMN core_id DROP NOT NULL;
ALTER TABLE "video_dub" ADD CONSTRAINT "video_dub_real_core_identity" CHECK ((source <> 'core' OR core_id IS NOT NULL) AND (core_id IS NULL OR length(btrim(core_id)) > 0));
ALTER TABLE "video_edition" ALTER COLUMN core_id DROP NOT NULL;
ALTER TABLE "video_edition" ADD CONSTRAINT "video_edition_real_core_identity" CHECK ((source <> 'core' OR core_id IS NOT NULL) AND (core_id IS NULL OR length(btrim(core_id)) > 0));
CREATE TABLE studio_catalog_release (
 id text PRIMARY KEY, project_id varchar(128) NOT NULL, revision integer NOT NULL,
 render_attempt_id varchar(128) NOT NULL UNIQUE REFERENCES studio_attempt(id) ON DELETE RESTRICT,
 idempotency_key text NOT NULL, request_hash text NOT NULL,
 video_id text NOT NULL UNIQUE REFERENCES video(id) ON DELETE RESTRICT,
 dub_id text NOT NULL UNIQUE REFERENCES video_dub(id) ON DELETE RESTRICT,
 edition_id text NOT NULL UNIQUE REFERENCES video_edition(id) ON DELETE RESTRICT,
 mux_id text NOT NULL UNIQUE REFERENCES mux_video(id) ON DELETE RESTRICT,
 snapshot jsonb NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(project_id,idempotency_key),
 FOREIGN KEY(project_id,revision) REFERENCES studio_project_revision(project_id,number) ON DELETE RESTRICT
);
CREATE TABLE studio_catalog_derivation (
 release_id text NOT NULL REFERENCES studio_catalog_release(id) ON DELETE RESTRICT,
 item_id text NOT NULL, source_snapshot_id text NOT NULL REFERENCES studio_source_snapshot(id) ON DELETE RESTRICT,
 start_ms integer NOT NULL CHECK(start_ms>=0), end_ms integer NOT NULL CHECK(end_ms>start_ms),
 start_frame integer NOT NULL CHECK(start_frame>=0), duration_in_frames integer NOT NULL CHECK(duration_in_frames>0),
 PRIMARY KEY(release_id,item_id)
);
CREATE TABLE studio_catalog_pack (
 release_id text NOT NULL REFERENCES studio_catalog_release(id) ON DELETE RESTRICT,
 pack_revision_id text NOT NULL REFERENCES content_pack_revision(id) ON DELETE RESTRICT,
 PRIMARY KEY(release_id,pack_revision_id)
);
CREATE TRIGGER studio_catalog_release_immutable BEFORE UPDATE OR DELETE ON studio_catalog_release FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
CREATE TRIGGER studio_catalog_derivation_immutable BEFORE UPDATE OR DELETE ON studio_catalog_derivation FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
CREATE TRIGGER studio_catalog_pack_immutable BEFORE UPDATE OR DELETE ON studio_catalog_pack FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
CREATE FUNCTION studio_catalog_retain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM studio_retain_references(NEW.snapshot,'STUDIO_CATALOG_RELEASE',NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER studio_catalog_retain AFTER INSERT ON studio_catalog_release FOR EACH ROW EXECUTE FUNCTION studio_catalog_retain();
-- No public publication path exists in this slice. Feat-460 must add its
-- transaction-bound visibility transition while keeping content immutable.
CREATE FUNCTION studio_catalog_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_id text;
BEGIN
 IF TG_TABLE_NAME='video_locale' THEN
   SELECT id INTO catalog_id FROM studio_catalog_release WHERE video_id=OLD.video_id;
 ELSE
   EXECUTE format('SELECT id FROM studio_catalog_release WHERE %I=$1', TG_ARGV[0]) INTO catalog_id USING OLD.id;
 END IF;
 IF catalog_id IS NOT NULL THEN RAISE EXCEPTION 'Studio catalog content is immutable; publication requires its dedicated boundary' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_catalog_video_freeze BEFORE UPDATE OR DELETE ON video FOR EACH ROW EXECUTE FUNCTION studio_catalog_freeze('video_id');
CREATE TRIGGER studio_catalog_dub_freeze BEFORE UPDATE OR DELETE ON video_dub FOR EACH ROW EXECUTE FUNCTION studio_catalog_freeze('dub_id');
CREATE TRIGGER studio_catalog_edition_freeze BEFORE UPDATE OR DELETE ON video_edition FOR EACH ROW EXECUTE FUNCTION studio_catalog_freeze('edition_id');
CREATE TRIGGER studio_catalog_mux_freeze BEFORE UPDATE OR DELETE ON mux_video FOR EACH ROW EXECUTE FUNCTION studio_catalog_freeze('mux_id');
CREATE TRIGGER studio_catalog_locale_freeze BEFORE UPDATE OR DELETE ON video_locale FOR EACH ROW EXECUTE FUNCTION studio_catalog_freeze('video_id');

CREATE FUNCTION studio_catalog_reject_attached_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM studio_catalog_release WHERE video_id=NEW.video_id) THEN
   RAISE EXCEPTION 'Studio catalog content cannot be extended outside its release' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_catalog_locale_insert BEFORE INSERT OR UPDATE ON video_locale FOR EACH ROW EXECUTE FUNCTION studio_catalog_reject_attached_content();
CREATE TRIGGER studio_catalog_dub_insert BEFORE INSERT OR UPDATE ON video_dub FOR EACH ROW EXECUTE FUNCTION studio_catalog_reject_attached_content();
