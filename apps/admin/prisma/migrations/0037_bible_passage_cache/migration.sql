-- Cache remote scripture text server-side so consumer apps never call Bible
-- providers directly and provider keys stay inside Admin.
CREATE TABLE "bible_passage_cache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "content_format" TEXT NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "human_reference" TEXT,
    "version_abbreviation" TEXT,
    "version_title" TEXT,
    "copyright" TEXT NOT NULL,
    "publisher_url" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bible_passage_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bible_passage_cache_provider_version_id_reference_content_format_key"
    ON "bible_passage_cache"("provider", "version_id", "reference", "content_format");

CREATE INDEX "bible_passage_cache_expires_at_idx"
    ON "bible_passage_cache"("expires_at");
