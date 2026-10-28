-- NULL marks pre-cutover rows whose delivery correction acceptance time is unknown.
ALTER TABLE "recommendation_precomputed_visit"
  ADD COLUMN "history_revision" INTEGER,
  ADD COLUMN "history_accepted_at" TIMESTAMPTZ(6);

ALTER TABLE "recommendation_precomputed_baseline_visit"
  ADD COLUMN "history_revision" INTEGER,
  ADD COLUMN "history_accepted_at" TIMESTAMPTZ(6);
