-- PostgreSQL is the durable source of truth for Watch Search editorial
-- curations. Typesense receives a v4 generation-specific compiled projection.

CREATE TYPE "WatchSearchCurationScope" AS ENUM (
  'published_locales',
  'all_languages'
);

CREATE TYPE "WatchSearchCurationAliasSource" AS ENUM (
  'editorial',
  'machine'
);

CREATE TABLE "watch_search_curation" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "target_video_core_id" TEXT NOT NULL,
  "scope" "WatchSearchCurationScope" NOT NULL DEFAULT 'published_locales',
  "position" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "watch_search_curation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "watch_search_curation_key_key" UNIQUE ("key"),
  CONSTRAINT "watch_search_curation_target_check"
    CHECK (length(btrim("target_video_core_id")) > 0),
  CONSTRAINT "watch_search_curation_position_check" CHECK ("position" > 0)
);

CREATE INDEX "watch_search_curation_enabled_idx"
  ON "watch_search_curation"("enabled");
CREATE INDEX "watch_search_curation_target_video_core_id_idx"
  ON "watch_search_curation"("target_video_core_id");

CREATE TABLE "watch_search_curation_alias" (
  "id" TEXT NOT NULL,
  "curation_id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "normalized_query" TEXT NOT NULL,
  "locale" TEXT,
  "source" "WatchSearchCurationAliasSource" NOT NULL DEFAULT 'editorial',
  "translation_model" TEXT,
  "source_text_digest" TEXT,
  "generated_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "watch_search_curation_alias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "watch_search_curation_alias_curation_id_fkey"
    FOREIGN KEY ("curation_id")
    REFERENCES "watch_search_curation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "watch_search_curation_alias_query_check"
    CHECK (
      length(btrim("query")) > 0
      AND length(btrim("normalized_query")) > 0
    ),
  CONSTRAINT "watch_search_curation_alias_machine_provenance_check"
    CHECK (
      "source" <> 'machine'
      OR (
        length(btrim("translation_model")) > 0
        AND length(btrim("source_text_digest")) > 0
        AND "generated_at" IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX "watch_search_curation_alias_identity_key"
  ON "watch_search_curation_alias"(
    "curation_id",
    "normalized_query",
    COALESCE("locale", '')
  );
CREATE INDEX "watch_search_curation_alias_curation_id_active_idx"
  ON "watch_search_curation_alias"("curation_id", "active");
CREATE INDEX "watch_search_curation_alias_locale_idx"
  ON "watch_search_curation_alias"("locale");

INSERT INTO "watch_search_curation" (
  "id",
  "key",
  "target_video_core_id",
  "scope",
  "position",
  "enabled",
  "updated_at"
) VALUES (
  'rescue-project-visual-vernacular-intro',
  'rescue-project-visual-vernacular-intro',
  '13_0-RPGospelIntro',
  'published_locales',
  1,
  true,
  CURRENT_TIMESTAMP
);

INSERT INTO "watch_search_curation_alias" (
  "id",
  "curation_id",
  "query",
  "normalized_query",
  "locale",
  "source",
  "translation_model",
  "source_text_digest",
  "generated_at",
  "updated_at"
) VALUES
  ('rescue-project-en', 'rescue-project-visual-vernacular-intro', 'Rescue Project', 'rescue project', NULL, 'editorial', NULL, NULL, NULL, CURRENT_TIMESTAMP),
  ('rescue-project-ar', 'rescue-project-visual-vernacular-intro', 'مشروع الإنقاذ', 'مشروع الإنقاذ', 'ar', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-bn', 'rescue-project-visual-vernacular-intro', 'উদ্ধার প্রকল্প', 'উদ্ধার প্রকল্প', 'bn', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-zh-hans', 'rescue-project-visual-vernacular-intro', '救援计划', '救援计划', 'zh-hans', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-zh-hant', 'rescue-project-visual-vernacular-intro', '救援計畫', '救援計畫', 'zh-hant', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-fa', 'rescue-project-visual-vernacular-intro', 'پروژه نجات', 'پروژه نجات', 'fa', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-fr', 'rescue-project-visual-vernacular-intro', 'Projet de sauvetage', 'projet de sauvetage', 'fr', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-de', 'rescue-project-visual-vernacular-intro', 'Rettungsprojekt', 'rettungsprojekt', 'de', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-he', 'rescue-project-visual-vernacular-intro', 'פרויקט ההצלה', 'פרויקט ההצלה', 'he', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-hi', 'rescue-project-visual-vernacular-intro', 'बचाव परियोजना', 'बचाव परियोजना', 'hi', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-id', 'rescue-project-visual-vernacular-intro', 'Proyek Penyelamatan', 'proyek penyelamatan', 'id', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-ja', 'rescue-project-visual-vernacular-intro', '救済プロジェクト', '救済プロジェクト', 'ja', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-kk', 'rescue-project-visual-vernacular-intro', 'Құтқару жобасы', 'құтқару жобасы', 'kk', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-ko', 'rescue-project-visual-vernacular-intro', '구조 프로젝트', '구조 프로젝트', 'ko', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-mn', 'rescue-project-visual-vernacular-intro', 'Авралын төсөл', 'авралын төсөл', 'mn', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-pt', 'rescue-project-visual-vernacular-intro', 'Projeto de Resgate', 'projeto de resgate', 'pt', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-ru', 'rescue-project-visual-vernacular-intro', 'Проект спасения', 'проект спасения', 'ru', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-fil', 'rescue-project-visual-vernacular-intro', 'Proyektong Pagsagip', 'proyektong pagsagip', 'fil', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-th', 'rescue-project-visual-vernacular-intro', 'โครงการช่วยเหลือ', 'โครงการช่วยเหลือ', 'th', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-tr', 'rescue-project-visual-vernacular-intro', 'Kurtarma Projesi', 'kurtarma projesi', 'tr', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-ur', 'rescue-project-visual-vernacular-intro', 'نجات کا منصوبہ', 'نجات کا منصوبہ', 'ur', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP),
  ('rescue-project-vi', 'rescue-project-visual-vernacular-intro', 'Dự án Giải cứu', 'dự án giải cứu', 'vi', 'machine', 'gpt-5', 'sha256:01a79347640aa7432f8a0d23b8fd7461dcf877da5af1a0a018c6cdf79936896c', '2026-09-07T00:00:00Z', CURRENT_TIMESTAMP);
