-- CreateTable
CREATE TABLE "media_folder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_folder_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "media_asset"
ADD COLUMN "folder_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "media_folder_parent_id_name_key" ON "media_folder"("parent_id", "name");

-- CreateIndex
CREATE INDEX "media_folder_parent_id_updated_at_idx" ON "media_folder"("parent_id", "updated_at");

-- CreateIndex
CREATE INDEX "media_folder_created_by_id_idx" ON "media_folder"("created_by_id");

-- CreateIndex
CREATE INDEX "media_asset_folder_id_updated_at_idx" ON "media_asset"("folder_id", "updated_at");

-- AddForeignKey
ALTER TABLE "media_folder"
ADD CONSTRAINT "media_folder_parent_id_fkey"
FOREIGN KEY ("parent_id") REFERENCES "media_folder"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_folder"
ADD CONSTRAINT "media_folder_created_by_id_fkey"
FOREIGN KEY ("created_by_id") REFERENCES "user"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_asset"
ADD CONSTRAINT "media_asset_folder_id_fkey"
FOREIGN KEY ("folder_id") REFERENCES "media_folder"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
