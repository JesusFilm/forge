ALTER TABLE "content_revision"
ADD COLUMN "preview_token" TEXT;

CREATE UNIQUE INDEX "content_revision_preview_token_key"
ON "content_revision"("preview_token");
