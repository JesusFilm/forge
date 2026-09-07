CREATE FUNCTION studio_retain_asset_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Studio asset versions are retained and immutable'; END $$;
CREATE TRIGGER studio_asset_version_immutable BEFORE UPDATE OR DELETE ON studio_asset_version FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE FUNCTION studio_guard_media_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM studio_asset_version WHERE media_asset_id = OLD.id) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Studio asset bytes are retained'; END IF;
    IF (to_jsonb(NEW) - ARRAY['updated_at','folder_id']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['updated_at','folder_id']) THEN
      RAISE EXCEPTION 'Studio asset version is immutable; register replacement bytes as a new version';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER studio_media_asset_guard BEFORE UPDATE OR DELETE ON media_asset FOR EACH ROW EXECUTE FUNCTION studio_guard_media_asset();
