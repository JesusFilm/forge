-- Add first-class locale rows for Core-sourced reference display names.
-- The legacy JSON name maps remain for compatibility while UI code migrates
-- to the relation-backed locale shape used by content entities.

CREATE TABLE "language_locale" (
  "id" TEXT NOT NULL,
  "source" "SourceTier" NOT NULL DEFAULT 'core',
  "language_id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER,
  "synced_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "language_locale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "continent_locale" (
  "id" TEXT NOT NULL,
  "source" "SourceTier" NOT NULL DEFAULT 'core',
  "continent_id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER,
  "synced_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "continent_locale_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "country_locale" (
  "id" TEXT NOT NULL,
  "source" "SourceTier" NOT NULL DEFAULT 'core',
  "country_id" TEXT NOT NULL,
  "locale" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER,
  "synced_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "country_locale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "language_locale_language_id_locale_key" ON "language_locale"("language_id", "locale");
CREATE INDEX "language_locale_locale_idx" ON "language_locale"("locale");
CREATE INDEX "language_locale_deleted_at_idx" ON "language_locale"("deleted_at");

CREATE UNIQUE INDEX "continent_locale_continent_id_locale_key" ON "continent_locale"("continent_id", "locale");
CREATE INDEX "continent_locale_locale_idx" ON "continent_locale"("locale");
CREATE INDEX "continent_locale_deleted_at_idx" ON "continent_locale"("deleted_at");

CREATE UNIQUE INDEX "country_locale_country_id_locale_key" ON "country_locale"("country_id", "locale");
CREATE INDEX "country_locale_locale_idx" ON "country_locale"("locale");
CREATE INDEX "country_locale_deleted_at_idx" ON "country_locale"("deleted_at");

ALTER TABLE "language_locale"
  ADD CONSTRAINT "language_locale_language_id_fkey"
  FOREIGN KEY ("language_id") REFERENCES "language"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "continent_locale"
  ADD CONSTRAINT "continent_locale_continent_id_fkey"
  FOREIGN KEY ("continent_id") REFERENCES "continent"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "country_locale"
  ADD CONSTRAINT "country_locale_country_id_fkey"
  FOREIGN KEY ("country_id") REFERENCES "country"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
