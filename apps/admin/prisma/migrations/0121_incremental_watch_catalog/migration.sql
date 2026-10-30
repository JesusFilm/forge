ALTER TABLE "watch_catalog_publication"
  ADD COLUMN "live_collection_id" TEXT,
  ADD COLUMN "live_updating" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "live_lexical_fields" JSONB,
  ADD COLUMN "retired_live" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "watch_catalog_publication"
  ADD COLUMN "building_live_collection_id" TEXT,
  ADD COLUMN "live_curation_digest" TEXT,
  ADD COLUMN "live_curation_in_flight" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE SEQUENCE "watch_catalog_dirty_revision_seq";
CREATE TABLE "watch_catalog_dirty_video" (
  "video_id" TEXT PRIMARY KEY,
  "revision" BIGINT NOT NULL DEFAULT nextval('watch_catalog_dirty_revision_seq')
);
CREATE INDEX "watch_catalog_dirty_video_revision_idx"
  ON "watch_catalog_dirty_video" ("revision");

CREATE TABLE "watch_catalog_video_state" (
  "video_id" TEXT PRIMARY KEY,
  "catalog_digest" TEXT,
  "availability_digest" TEXT NOT NULL,
  "availability_ids" JSONB NOT NULL,
  "lexical_digest" TEXT NOT NULL,
  "lexical_ids" JSONB NOT NULL,
  "in_flight" BOOLEAN NOT NULL DEFAULT FALSE,
  "possible_availability_ids" JSONB NOT NULL DEFAULT '[]',
  "possible_lexical_ids" JSONB NOT NULL DEFAULT '[]'
);

-- This queue records identities, not event payloads. Retrying always projects
-- current rows, so an uncheckpointed upsert cannot resurrect a removed video.
CREATE FUNCTION watch_catalog_mark_video(p_video_id TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_video_id IS NULL THEN RETURN; END IF;
  INSERT INTO watch_catalog_dirty_video (video_id, revision)
  SELECT id, nextval('watch_catalog_dirty_revision_seq')
  FROM (
    WITH RECURSIVE ancestors(id, depth) AS (
      SELECT p_video_id, 0
      UNION ALL
      SELECT relation.parent_id, ancestors.depth + 1
      FROM ancestors
      JOIN video_relation relation ON relation.child_id = ancestors.id
      WHERE ancestors.depth < 2
    )
    SELECT DISTINCT id FROM ancestors
  ) affected
  ON CONFLICT (video_id) DO UPDATE
    SET revision = nextval('watch_catalog_dirty_revision_seq');
END $$;

CREATE FUNCTION watch_catalog_capture_video_change() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  old_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  affected TEXT;
BEGIN
  IF old_row IS NOT NULL THEN
    PERFORM watch_catalog_mark_video(old_row->>'video_id');
    IF TG_TABLE_NAME = 'video' THEN
      PERFORM watch_catalog_mark_video(old_row->>'id');
    ELSIF TG_TABLE_NAME = 'video_relation' THEN
      PERFORM watch_catalog_mark_video(old_row->>'parent_id');
      PERFORM watch_catalog_mark_video(old_row->>'child_id');
    ELSIF TG_TABLE_NAME = 'video_edition' THEN
      FOR affected IN SELECT video_id FROM video_dub WHERE video_edition_id = old_row->>'id'
        UNION SELECT video_id FROM video_subtitle WHERE video_edition_id = old_row->>'id'
      LOOP PERFORM watch_catalog_mark_video(affected); END LOOP;
    ELSIF TG_TABLE_NAME = 'video_subtitle' AND old_row->>'video_id' IS NULL THEN
      FOR affected IN SELECT video_id FROM video_dub WHERE video_edition_id = old_row->>'video_edition_id'
      LOOP PERFORM watch_catalog_mark_video(affected); END LOOP;
    ELSIF TG_TABLE_NAME = 'language' THEN
      FOR affected IN SELECT video_id FROM video_dub WHERE language_id = old_row->>'id'
        UNION SELECT video_id FROM video_subtitle WHERE language_id = old_row->>'id'
        UNION SELECT video_id FROM video_locale WHERE language_id = old_row->>'id'
        UNION SELECT dub.video_id FROM video_subtitle subtitle
          JOIN video_dub dub ON dub.video_edition_id = subtitle.video_edition_id
          WHERE subtitle.language_id = old_row->>'id' AND subtitle.video_id IS NULL
      LOOP PERFORM watch_catalog_mark_video(affected); END LOOP;
    ELSIF TG_TABLE_NAME = 'mux_video' THEN
      FOR affected IN SELECT video_id FROM video_dub WHERE mux_video_id = old_row->>'id'
      LOOP PERFORM watch_catalog_mark_video(affected); END LOOP;
    END IF;
  END IF;
  IF new_row IS NOT NULL THEN
    PERFORM watch_catalog_mark_video(new_row->>'video_id');
    IF TG_TABLE_NAME = 'video' THEN
      PERFORM watch_catalog_mark_video(new_row->>'id');
    ELSIF TG_TABLE_NAME = 'video_relation' THEN
      PERFORM watch_catalog_mark_video(new_row->>'parent_id');
      PERFORM watch_catalog_mark_video(new_row->>'child_id');
    ELSIF TG_TABLE_NAME = 'video_subtitle' AND new_row->>'video_id' IS NULL THEN
      FOR affected IN SELECT video_id FROM video_dub WHERE video_edition_id = new_row->>'video_edition_id'
      LOOP PERFORM watch_catalog_mark_video(affected); END LOOP;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER watch_catalog_dirty_video AFTER INSERT OR UPDATE OR DELETE ON video
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_locale AFTER INSERT OR UPDATE OR DELETE ON video_locale
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_dub AFTER INSERT OR UPDATE OR DELETE ON video_dub
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_subtitle AFTER INSERT OR UPDATE OR DELETE ON video_subtitle
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_image AFTER INSERT OR UPDATE OR DELETE ON video_image
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_edition AFTER INSERT OR UPDATE OR DELETE ON video_edition
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_relation AFTER INSERT OR UPDATE OR DELETE ON video_relation
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_language AFTER INSERT OR UPDATE OR DELETE ON language
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
CREATE TRIGGER watch_catalog_dirty_mux AFTER INSERT OR UPDATE OR DELETE ON mux_video
  FOR EACH ROW EXECUTE FUNCTION watch_catalog_capture_video_change();
