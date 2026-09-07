-- CreateTable
CREATE TABLE "studio_asset_version" (
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

    CONSTRAINT "studio_asset_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "studio_asset_version_media_asset_id_key" ON "studio_asset_version"("media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "studio_asset_version_request_key_key" ON "studio_asset_version"("request_key");

-- CreateIndex
CREATE INDEX "studio_asset_version_asset_id_idx" ON "studio_asset_version"("asset_id");

-- CreateIndex
CREATE INDEX "studio_asset_version_role_created_at_idx" ON "studio_asset_version"("role", "created_at");

-- AddForeignKey
ALTER TABLE "studio_asset_version" ADD CONSTRAINT "studio_asset_version_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
