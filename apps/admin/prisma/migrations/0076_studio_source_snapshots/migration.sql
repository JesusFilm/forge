

-- CreateTable
CREATE TABLE "studio_source_snapshot" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "dub_id" TEXT NOT NULL,
    "edition_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "download_id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "request_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,

    CONSTRAINT "studio_source_snapshot_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE UNIQUE INDEX "studio_source_snapshot_request_key_key" ON "studio_source_snapshot"("request_key");


-- AddForeignKey
ALTER TABLE "studio_source_snapshot" ADD CONSTRAINT "studio_source_snapshot_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "studio_source_snapshot" ADD CONSTRAINT "studio_source_snapshot_dub_id_fkey" FOREIGN KEY ("dub_id") REFERENCES "video_dub"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "studio_source_snapshot" ADD CONSTRAINT "studio_source_snapshot_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "video_edition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "studio_source_snapshot" ADD CONSTRAINT "studio_source_snapshot_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "video_subtitle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AddForeignKey
ALTER TABLE "studio_source_snapshot" ADD CONSTRAINT "studio_source_snapshot_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "video_dub_download"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER studio_source_immutable BEFORE UPDATE OR DELETE ON studio_source_snapshot FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE FUNCTION studio_capture_source_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.snapshot,'STUDIO_SOURCE',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER studio_source_usage AFTER INSERT ON studio_source_snapshot FOR EACH ROW EXECUTE FUNCTION studio_capture_source_usage();
