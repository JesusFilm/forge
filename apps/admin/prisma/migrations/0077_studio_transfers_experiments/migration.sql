

-- CreateTable
CREATE TABLE "studio_asset_transfer" (
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "principal" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studio_asset_transfer_pkey" PRIMARY KEY ("token_hash")
);


-- CreateTable
CREATE TABLE "studio_experiment" (
    "id" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "actor" JSONB NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,

    CONSTRAINT "studio_experiment_pkey" PRIMARY KEY ("id")
);


-- CreateTable
CREATE TABLE "studio_experiment_candidate" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "asset" JSONB NOT NULL,
    "provider_request_id" TEXT,
    "actual_cost_micros" BIGINT NOT NULL,
    "candidate_key" TEXT NOT NULL,
    "actor" JSONB NOT NULL,

    CONSTRAINT "studio_experiment_candidate_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "studio_experiment_request_key_key" ON "studio_experiment"("request_key");


-- CreateIndex
CREATE UNIQUE INDEX "studio_experiment_candidate_candidate_key_key" ON "studio_experiment_candidate"("candidate_key");


-- AddForeignKey
ALTER TABLE "studio_experiment_candidate" ADD CONSTRAINT "studio_experiment_candidate_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "studio_experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER studio_experiment_immutable BEFORE UPDATE OR DELETE ON studio_experiment FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE TRIGGER studio_candidate_immutable BEFORE UPDATE OR DELETE ON studio_experiment_candidate FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE FUNCTION studio_capture_candidate_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.asset,'STUDIO_EXPERIMENT_CANDIDATE',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER studio_candidate_usage AFTER INSERT ON studio_experiment_candidate FOR EACH ROW EXECUTE FUNCTION studio_capture_candidate_usage();
CREATE OR REPLACE FUNCTION studio_capture_metadata_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM studio_retain_references(NEW.metadata->'narration','STUDIO_ASSET_VERSION',NEW.id);
 PERFORM studio_retain_references(NEW.metadata->'voice','STUDIO_ASSET_VERSION',NEW.id);
 PERFORM studio_retain_references(NEW.metadata->'dependencies','STUDIO_ASSET_VERSION',NEW.id);
 RETURN NEW;
END $$;
CREATE FUNCTION studio_prevent_asset_alias() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM media_asset m JOIN studio_asset_version v ON v.media_asset_id=m.id WHERE m.id<>NEW.id AND m.backend=NEW.backend AND (NEW.object_key IN (m.object_key,m.preview_object_key) OR NEW.preview_object_key IN (m.object_key,m.preview_object_key))) THEN
   RAISE EXCEPTION 'Cannot alias retained Studio bytes; reference the immutable version';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_asset_alias_guard BEFORE INSERT OR UPDATE ON media_asset FOR EACH ROW EXECUTE FUNCTION studio_prevent_asset_alias();
