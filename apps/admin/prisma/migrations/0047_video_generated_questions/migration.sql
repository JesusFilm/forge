ALTER TABLE "video_study_question"
  ADD CONSTRAINT "video_study_question_id_video_id_key" UNIQUE ("id", "video_id");

CREATE TABLE "video_generated_question" (
  "id" TEXT NOT NULL,
  "video_id" TEXT NOT NULL,
  "source_study_question_id" TEXT NOT NULL,
  "locale" TEXT,
  "language_id" TEXT,
  "language_slug" TEXT,
  "question" TEXT NOT NULL,
  "answer" TEXT NOT NULL,
  "order" INTEGER,
  "status" "LocaleStatus" NOT NULL DEFAULT 'draft',
  "published_at" TIMESTAMP(3),
  "source_content_hash" VARCHAR(64),
  "generation_provider" VARCHAR(64),
  "generation_model" VARCHAR(128),
  "generation_mode" VARCHAR(64),
  "mastra_run_id" VARCHAR(128),
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "video_generated_question_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "video_generated_question_video_id_fkey"
    FOREIGN KEY ("video_id") REFERENCES "video"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "video_generated_question_source_study_question_id_video_id_fkey"
    FOREIGN KEY ("source_study_question_id", "video_id") REFERENCES "video_study_question"("id", "video_id") ON DELETE NO ACTION ON UPDATE CASCADE,
  CONSTRAINT "video_generated_question_language_id_fkey"
    FOREIGN KEY ("language_id") REFERENCES "language"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "video_generated_question_video_id_idx"
  ON "video_generated_question"("video_id");
CREATE INDEX "video_generated_question_source_study_question_id_idx"
  ON "video_generated_question"("source_study_question_id");
CREATE INDEX "video_generated_question_language_id_idx"
  ON "video_generated_question"("language_id");
CREATE INDEX "video_generated_question_mastra_run_id_idx"
  ON "video_generated_question"("mastra_run_id");
CREATE INDEX "video_generated_question_public_lookup_idx"
  ON "video_generated_question"("video_id", "locale", "language_slug", "status", "deleted_at", "order");
