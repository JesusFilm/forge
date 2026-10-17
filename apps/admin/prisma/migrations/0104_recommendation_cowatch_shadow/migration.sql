CREATE TABLE "recommendation_cowatch_generation" (
  "id" CHAR(64) PRIMARY KEY,
  "projection_version" VARCHAR(64) NOT NULL,
  "feature_version" VARCHAR(64) NOT NULL,
  "source_count" INTEGER NOT NULL,
  "contribution_count" INTEGER NOT NULL,
  "edge_count" INTEGER NOT NULL,
  "distinct_viewer_count" INTEGER NOT NULL,
  "window_end" TIMESTAMP(3) NOT NULL,
  "terminal_decision" VARCHAR(48) NOT NULL,
  "decision_reason" VARCHAR(96) NOT NULL,
  "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'shadow_population_graph',
  "identity_class" VARCHAR(64) NOT NULL DEFAULT 'aggregate_identity_free',
  "access_class" VARCHAR(64) NOT NULL DEFAULT 'recommendation_admin_aggregates',
  "ingestion_health" VARCHAR(64) NOT NULL DEFAULT 'manual_bounded_snapshot',
  "deletion_behavior" VARCHAR(64) NOT NULL DEFAULT 'expire_generation_cascade',
  "fallback_behavior" VARCHAR(64) NOT NULL DEFAULT 'observed_live_baseline',
  "retention_days" INTEGER NOT NULL DEFAULT 29
);
CREATE INDEX "recommendation_cowatch_generation_published_idx" ON "recommendation_cowatch_generation" ("published_at" DESC);
CREATE INDEX "recommendation_cowatch_generation_expiry_idx" ON "recommendation_cowatch_generation" ("expires_at");

CREATE TABLE "recommendation_cowatch_source_contribution" (
  "id" TEXT PRIMARY KEY,
  "generation_id" CHAR(64) NOT NULL REFERENCES "recommendation_cowatch_generation"("id") ON DELETE CASCADE,
  "outcome_id" TEXT NOT NULL REFERENCES "recommendation_outcome_revision"("id") ON DELETE CASCADE,
  "eligibility_decision_id" TEXT NOT NULL REFERENCES "recommendation_eligibility_decision"("id") ON DELETE CASCADE,
  "eligibility_revision" INTEGER NOT NULL,
  "eligibility_policy_version" VARCHAR(64) NOT NULL,
  "viewer_profile_id" TEXT REFERENCES "recommendation_profile"("id") ON DELETE CASCADE,
  "media_id" VARCHAR(191) NOT NULL,
  "session_digest" CHAR(64) NOT NULL,
  "viewer_key_digest" CHAR(64) NOT NULL,
  "quality_weight" DOUBLE PRECISION NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recommendation_cowatch_source_generation_outcome_key" UNIQUE ("generation_id", "outcome_id"),
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'exact_outcome_lineage',
  "identity_class" VARCHAR(64) NOT NULL DEFAULT 'private_pseudonymous',
  "access_class" VARCHAR(64) NOT NULL DEFAULT 'recommendation_projection_service',
  "ingestion_health" VARCHAR(64) NOT NULL DEFAULT 'current_eligible_outcome',
  "deletion_behavior" VARCHAR(64) NOT NULL DEFAULT 'cascade_outcome_or_profile',
  "fallback_behavior" VARCHAR(64) NOT NULL DEFAULT 'observed_live_baseline',
  "retention_days" INTEGER NOT NULL DEFAULT 29
);
CREATE INDEX "recommendation_cowatch_source_profile_idx" ON "recommendation_cowatch_source_contribution" ("viewer_profile_id");
CREATE INDEX "recommendation_cowatch_source_media_idx" ON "recommendation_cowatch_source_contribution" ("generation_id", "media_id");
CREATE INDEX "recommendation_cowatch_source_expiry_idx" ON "recommendation_cowatch_source_contribution" ("expires_at");

CREATE TABLE "recommendation_cowatch_contribution" (
  "id" TEXT PRIMARY KEY,
  "generation_id" CHAR(64) NOT NULL REFERENCES "recommendation_cowatch_generation"("id") ON DELETE CASCADE,
  "source_outcome_id" TEXT NOT NULL REFERENCES "recommendation_outcome_revision"("id") ON DELETE CASCADE,
  "target_outcome_id" TEXT NOT NULL REFERENCES "recommendation_outcome_revision"("id") ON DELETE CASCADE,
  "viewer_profile_id" TEXT REFERENCES "recommendation_profile"("id") ON DELETE CASCADE,
  "source_media_id" VARCHAR(191) NOT NULL,
  "target_media_id" VARCHAR(191) NOT NULL,
  "session_digest" CHAR(64) NOT NULL,
  "viewer_key_digest" CHAR(64) NOT NULL,
  "gap_ms" INTEGER NOT NULL,
  "quality_weight" DOUBLE PRECISION NOT NULL,
  "recency_weight" DOUBLE PRECISION NOT NULL,
  "effective_weight" DOUBLE PRECISION NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recommendation_cowatch_contribution_pair_key" UNIQUE ("generation_id", "source_outcome_id", "target_outcome_id"),
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'directional_pair_lineage',
  "identity_class" VARCHAR(64) NOT NULL DEFAULT 'private_pseudonymous',
  "access_class" VARCHAR(64) NOT NULL DEFAULT 'recommendation_projection_service',
  "ingestion_health" VARCHAR(64) NOT NULL DEFAULT 'bounded_pair_projection',
  "deletion_behavior" VARCHAR(64) NOT NULL DEFAULT 'cascade_outcome_or_profile',
  "fallback_behavior" VARCHAR(64) NOT NULL DEFAULT 'observed_live_baseline',
  "retention_days" INTEGER NOT NULL DEFAULT 29
);
CREATE INDEX "recommendation_cowatch_contribution_edge_idx" ON "recommendation_cowatch_contribution" ("generation_id", "source_media_id", "target_media_id");
CREATE INDEX "recommendation_cowatch_contribution_profile_idx" ON "recommendation_cowatch_contribution" ("viewer_profile_id");
CREATE INDEX "recommendation_cowatch_contribution_expiry_idx" ON "recommendation_cowatch_contribution" ("expires_at");

CREATE TABLE "recommendation_cowatch_edge" (
  "id" TEXT PRIMARY KEY,
  "generation_id" CHAR(64) NOT NULL REFERENCES "recommendation_cowatch_generation"("id") ON DELETE CASCADE,
  "source_media_id" VARCHAR(191) NOT NULL,
  "target_media_id" VARCHAR(191) NOT NULL,
  "session_support" INTEGER NOT NULL,
  "distinct_viewer_support" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "popularity_corrected_lift" DOUBLE PRECISION NOT NULL,
  "recency_weight" DOUBLE PRECISION NOT NULL,
  "quality_weight" DOUBLE PRECISION NOT NULL,
  "effective_weight" DOUBLE PRECISION NOT NULL,
  "contamination" DOUBLE PRECISION NOT NULL,
  "eligible" BOOLEAN NOT NULL,
  CONSTRAINT "recommendation_cowatch_edge_direction_key" UNIQUE ("generation_id", "source_media_id", "target_media_id"),
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'directional_feature_contract',
  "identity_class" VARCHAR(64) NOT NULL DEFAULT 'aggregate_identity_free',
  "access_class" VARCHAR(64) NOT NULL DEFAULT 'recommendation_admin_aggregates',
  "ingestion_health" VARCHAR(64) NOT NULL DEFAULT 'immutable_generation_publish',
  "deletion_behavior" VARCHAR(64) NOT NULL DEFAULT 'cascade_generation',
  "fallback_behavior" VARCHAR(64) NOT NULL DEFAULT 'observed_live_baseline',
  "retention_days" INTEGER NOT NULL DEFAULT 29
);
CREATE INDEX "recommendation_cowatch_edge_anchor_idx" ON "recommendation_cowatch_edge" ("generation_id", "eligible", "source_media_id");

CREATE TABLE "recommendation_cowatch_suppression" (
  "episode_id" TEXT PRIMARY KEY REFERENCES "recommendation_playback_episode"("id") ON DELETE CASCADE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'privacy_erasure_fence',
  "identity_class" VARCHAR(64) NOT NULL DEFAULT 'private_episode_scoped',
  "access_class" VARCHAR(64) NOT NULL DEFAULT 'recommendation_privacy_service',
  "ingestion_health" VARCHAR(64) NOT NULL DEFAULT 'profile_erasure_transaction',
  "deletion_behavior" VARCHAR(64) NOT NULL DEFAULT 'cascade_episode_expiry',
  "fallback_behavior" VARCHAR(64) NOT NULL DEFAULT 'observed_live_baseline',
  "retention_days" INTEGER NOT NULL DEFAULT 29
);
CREATE INDEX "recommendation_cowatch_suppression_expiry_idx" ON "recommendation_cowatch_suppression" ("expires_at");
