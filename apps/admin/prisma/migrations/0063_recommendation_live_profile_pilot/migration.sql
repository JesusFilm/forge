-- feat-421 / U30: bounded live anonymous-profile challenger authority.
-- Expand-only: publishes schema and an immutable manifest definition but does
-- not activate an experiment, promotion pointer, serving control, or traffic.

CREATE TABLE "recommendation_personalization_decision" (
  "request_id" text PRIMARY KEY,
  "effective_manifest_id" varchar(191) NOT NULL,
  "lane" varchar(32) NOT NULL,
  "reason_code" varchar(64),
  "projection_generation_id" text,
  "projection_scope" varchar(16),
  "projection_version" varchar(64),
  "projection_generation_number" integer,
  "interest_count" integer NOT NULL DEFAULT 0,
  "session_intent_present" boolean NOT NULL DEFAULT false,
  "profile_retrieval_latency_ms" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL,
  CONSTRAINT "recommendation_personalization_request_fkey"
    FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id") ON DELETE CASCADE,
  CONSTRAINT "recommendation_personalization_manifest_fkey"
    FOREIGN KEY ("effective_manifest_id") REFERENCES "recommendation_strategy_manifest"("id") ON DELETE RESTRICT,
  CONSTRAINT "recommendation_personalization_projection_fkey"
    FOREIGN KEY ("projection_generation_id") REFERENCES "recommendation_profile_projection_generation"("id") ON DELETE SET NULL,
  CONSTRAINT "recommendation_personalization_lane_check" CHECK (
    "lane" IN ('semantic_control', 'profile_challenger', 'semantic_fallback')
  ),
  CONSTRAINT "recommendation_personalization_projection_check" CHECK (
    (
      "lane" = 'profile_challenger'
      -- The FK may be cleared by privacy erasure; bounded non-identity
      -- projection provenance remains on the request-owned audit row.
      AND "projection_scope" IN ('session', 'durable')
      AND "projection_version" IS NOT NULL
      AND "projection_generation_number" > 0
      AND "interest_count" BETWEEN 1 AND 5
      AND "reason_code" IS NULL
    ) OR (
      "lane" IN ('semantic_control', 'semantic_fallback')
      AND "projection_generation_id" IS NULL
      AND "projection_scope" IS NULL
      AND "projection_version" IS NULL
      AND "projection_generation_number" IS NULL
      AND "interest_count" = 0
    )
  ),
  CONSTRAINT "recommendation_personalization_latency_check" CHECK (
    "profile_retrieval_latency_ms" IS NULL
    OR "profile_retrieval_latency_ms" BETWEEN 0 AND 1500
  )
);
CREATE INDEX "recommendation_personalization_lane_created_idx"
  ON "recommendation_personalization_decision"("lane", "created_at");
CREATE INDEX "recommendation_personalization_projection_idx"
  ON "recommendation_personalization_decision"("projection_generation_id");
CREATE INDEX "recommendation_personalization_expiry_idx"
  ON "recommendation_personalization_decision"("expires_at");
CREATE TRIGGER "recommendation_personalization_root_expiry_guard"
BEFORE INSERT OR UPDATE OF "expires_at", "request_id"
ON "recommendation_personalization_decision"
FOR EACH ROW EXECUTE FUNCTION "enforce_recommendation_root_expiry"();

INSERT INTO "recommendation_strategy_manifest" (
  "id", "strategy_version", "contract_version", "surface_version",
  "generator", "max_items", "configuration", "enabled"
) VALUES (
  'multi-interest-profile-pilot-v1',
  'multi-interest-profile-pilot-v1',
  'semantic-recommendation-v1',
  'watch-below-player-v1',
  'profile',
  6,
  '{
    "context":"recommendation-profile-context-v1",
    "projection":"multi-interest-profile-projection-v1",
    "clustering":"deterministic-farthest-first-medoids-v1",
    "generator":"multi-interest-profile-candidate-v1",
    "union":"canonical-video-union-v1",
    "eligibility":"watch-playable-locale-v1",
    "ranker":"semantic-deterministic-ranker-v1",
    "composer":"minimal-playable-slate-v1",
    "fallbackManifestId":"semantic-transcript-pgvector-v1",
    "projectionManifestId":"multi-interest-profile-shadow-v1",
    "shadowManifestId":"multi-interest-profile-shadow-v1",
    "shadowDecisionRequired":"promote_to_experiment",
    "completeServiceDeadlineMs":1500,
    "learningReads":"published-projections-only",
    "boundedLive":true
  }'::jsonb,
  true
) ON CONFLICT ("id") DO NOTHING;

COMMENT ON TABLE "recommendation_personalization_decision" IS
  'Request-owned bounded online lane/projection provenance. It contains no cookie value, profile id, raw history, or vector; profile erasure detaches the projection FK while preserving non-relinkable delivery audit.';
