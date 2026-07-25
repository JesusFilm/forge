CREATE TABLE "watch_seo_manifest_snapshot" (
    "key" TEXT PRIMARY KEY,
    "version" TEXT NOT NULL,
    "generated_at" timestamp(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_size_bytes" INTEGER NOT NULL,
    "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "watch_seo_manifest_snapshot_generated_at_idx"
    ON "watch_seo_manifest_snapshot"("generated_at");
