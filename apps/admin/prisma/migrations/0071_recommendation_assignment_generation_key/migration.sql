-- A permanent confirmation advances the experiment generation and fences the
-- bounded assignments. Returning viewers need a new sticky assignment in the
-- new generation rather than colliding with the immutable fenced row.
ALTER TABLE "recommendation_experiment_assignment"
  DROP CONSTRAINT "recommendation_experiment_assignment_unit_key";

CREATE UNIQUE INDEX "recommendation_experiment_assignment_unit_generation_key"
  ON "recommendation_experiment_assignment"(
    "experiment_id",
    "unit_digest",
    "generation"
  );
