CREATE TABLE studio_catalog_readiness (
 id text PRIMARY KEY, sequence bigserial UNIQUE NOT NULL,
 release_id text NOT NULL REFERENCES studio_catalog_release(id) ON DELETE RESTRICT,
 attempt_id varchar(128) NOT NULL, lease_id text NOT NULL,
 proof jsonb NOT NULL CHECK(octet_length(proof::text)<=32768),
 request_hash text NOT NULL,
 checked_at timestamp(3) NOT NULL, expires_at timestamp(3) NOT NULL CHECK(expires_at>checked_at),
 FOREIGN KEY(attempt_id,lease_id) REFERENCES studio_render_execution(attempt_id,lease_id) ON DELETE RESTRICT
);
CREATE INDEX studio_catalog_readiness_latest ON studio_catalog_readiness(release_id,sequence DESC);
CREATE TRIGGER studio_catalog_readiness_immutable BEFORE UPDATE OR DELETE ON studio_catalog_readiness FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
CREATE TABLE studio_publication (
 release_id text PRIMARY KEY REFERENCES studio_catalog_release(id) ON DELETE RESTRICT,
 project_id varchar(128) NOT NULL UNIQUE REFERENCES studio_project(id) ON DELETE RESTRICT,
 approval_id varchar(128) NOT NULL REFERENCES studio_approval(id) ON DELETE RESTRICT,
 readiness_id text NOT NULL REFERENCES studio_catalog_readiness(id) ON DELETE RESTRICT,
 published_at timestamp(3) NOT NULL,
 revoked_at timestamp(3)
);
CREATE FUNCTION studio_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
 OR (to_jsonb(NEW)-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revoked_at')
 OR NOT EXISTS(SELECT 1 FROM studio_project WHERE id=NEW.project_id AND lifecycle='UNPUBLISHED' AND first_published_at IS NOT NULL AND unpublished_at=NEW.revoked_at)
 THEN RAISE EXCEPTION 'Publication can only be permanently revoked by its project latch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_publication_guard BEFORE UPDATE OR DELETE ON studio_publication FOR EACH ROW EXECUTE FUNCTION studio_publication_guard();
CREATE FUNCTION studio_publication_committed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM studio_publication p JOIN studio_project s ON s.id=p.project_id JOIN studio_catalog_release r ON r.id=p.release_id JOIN studio_approval a ON a.id=p.approval_id JOIN studio_catalog_readiness ready ON ready.id=p.readiness_id
 WHERE p.release_id=NEW.release_id AND r.project_id=s.id AND r.revision=s.current_revision AND a.project_id=s.id AND a.revision=r.revision AND a.render_attempt_id=r.render_attempt_id AND a.kind='PUBLICATION' AND ready.release_id=r.id AND ready.attempt_id=r.render_attempt_id AND s.first_published_at=p.published_at AND s.lifecycle IN ('PUBLISHED','UNPUBLISHED'))
 THEN RAISE EXCEPTION 'Publication must commit with its exact project latch and evidence'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER studio_publication_committed AFTER INSERT ON studio_publication DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION studio_publication_committed();

-- Only visibility flags may follow the dedicated publication latch. All staged
-- content, URLs, identity, metadata, timing and media remain permanently frozen.
CREATE FUNCTION studio_catalog_visibility_transition(table_name text, old_row jsonb, new_row jsonb, release_id text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE visible boolean;
BEGIN
 SELECT p.revoked_at IS NULL AND s.lifecycle='PUBLISHED' INTO visible FROM studio_publication p JOIN studio_project s ON s.id=p.project_id WHERE p.release_id=$4 AND s.first_published_at=p.published_at;
 IF visible IS NULL THEN RETURN false; END IF;
 IF table_name='video' THEN
  RETURN (old_row-ARRAY['restrict_view_platforms','no_index','updated_at'])=(new_row-ARRAY['restrict_view_platforms','no_index','updated_at'])
    AND ((old_row->'restrict_view_platforms') - 'watch')=((new_row->'restrict_view_platforms') - 'watch')
    AND (new_row->'restrict_view_platforms' ? 'watch')=(NOT visible)
    AND (new_row->>'no_index')::boolean=(NOT visible);
 -- Stored generated tsvectors are NULL in BEFORE triggers and recomputed
 -- after them. Compare their source text, never these non-writable columns.
 ELSIF table_name='video_locale' THEN
  RETURN (old_row-ARRAY['status','updated_at','title_tsv','description_tsv'])=(new_row-ARRAY['status','updated_at','title_tsv','description_tsv'])
    AND new_row->>'status'=CASE WHEN visible THEN 'published' ELSE 'archived' END;
 ELSIF table_name='video_dub' THEN
  RETURN (old_row-ARRAY['published','updated_at'])=(new_row-ARRAY['published','updated_at']) AND (new_row->>'published')::boolean=visible;
 END IF;
 RETURN false;
END $$;
CREATE OR REPLACE FUNCTION studio_catalog_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_id text;
BEGIN
 IF TG_TABLE_NAME='video_locale' THEN SELECT id INTO catalog_id FROM studio_catalog_release WHERE video_id=OLD.video_id;
 ELSE EXECUTE format('SELECT id FROM studio_catalog_release WHERE %I=$1',TG_ARGV[0]) INTO catalog_id USING OLD.id; END IF;
 IF catalog_id IS NOT NULL AND NOT (TG_OP='UPDATE' AND studio_catalog_visibility_transition(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW),catalog_id))
 THEN RAISE EXCEPTION 'Studio catalog content is immutable; publication requires its dedicated boundary' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION studio_catalog_reject_attached_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE catalog_id text;
BEGIN
 SELECT id INTO catalog_id FROM studio_catalog_release WHERE video_id=NEW.video_id;
 IF catalog_id IS NOT NULL AND NOT (TG_OP='UPDATE' AND studio_catalog_visibility_transition(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW),catalog_id))
 THEN RAISE EXCEPTION 'Studio catalog content cannot be extended outside its release' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION studio_publication_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE release_row studio_catalog_release%ROWTYPE; visible boolean;
BEGIN
 IF NEW.lifecycle IS NOT DISTINCT FROM OLD.lifecycle THEN RETURN NEW; END IF;
 SELECT r.* INTO release_row FROM studio_catalog_release r JOIN studio_publication p ON p.release_id=r.id WHERE p.project_id=NEW.id;
 IF release_row.id IS NULL THEN RETURN NEW; END IF;
 visible:=NEW.lifecycle='PUBLISHED';
 IF NOT visible THEN UPDATE studio_publication SET revoked_at=NEW.unpublished_at WHERE release_id=release_row.id AND revoked_at IS NULL; END IF;
 UPDATE video SET no_index=NOT visible,restrict_view_platforms=CASE WHEN visible THEN array_remove(restrict_view_platforms,'watch') ELSE array_append(array_remove(restrict_view_platforms,'watch'),'watch') END,updated_at=NOW() WHERE id=release_row.video_id;
 UPDATE video_locale SET status=CASE WHEN visible THEN 'published'::"LocaleStatus" ELSE 'archived'::"LocaleStatus" END,updated_at=NOW() WHERE video_id=release_row.video_id;
 UPDATE video_dub SET published=visible,updated_at=NOW() WHERE id=release_row.dub_id;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_publication_visibility AFTER UPDATE ON studio_project FOR EACH ROW EXECUTE FUNCTION studio_publication_visibility();

-- Delivery acknowledgements never grant visibility. Missing acknowledgement of
-- the committed publication/revocation is durable pending work after restart.
CREATE TABLE studio_watch_delivery (
 release_id text NOT NULL REFERENCES studio_publication(release_id) ON DELETE RESTRICT,
 phase text NOT NULL CHECK(phase IN ('published','revoked')),
 delivered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(release_id,phase)
);
CREATE TRIGGER studio_watch_delivery_immutable BEFORE UPDATE OR DELETE ON studio_watch_delivery FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
