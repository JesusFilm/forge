CREATE TABLE "recommendation_precomputed_ctr_measurement" (
  "visit_id" UUID NOT NULL REFERENCES "recommendation_precomputed_visit"("id") ON DELETE CASCADE,
  "revision" INTEGER NOT NULL,
  "accepted_at" TIMESTAMPTZ(6) NOT NULL,
  "summary" JSONB NOT NULL,
  CONSTRAINT "recommendation_precomputed_ctr_measurement_pkey" PRIMARY KEY ("visit_id", "revision")
);

CREATE INDEX "recommendation_precomputed_ctr_measurement_cutoff_idx"
  ON "recommendation_precomputed_ctr_measurement"("visit_id", "accepted_at");
