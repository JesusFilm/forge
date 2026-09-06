-- Some restored production snapshots predate the composite lineage uniques
-- now declared by the U1 schema. Repair those additive keys before the new
-- nullable lineage foreign keys reference them. Fresh installs already have
-- the constraints, so each repair is intentionally idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recommendation_item_request_id_key'
      AND conrelid = 'recommendation_served_item'::regclass
  ) THEN
    ALTER TABLE "recommendation_served_item"
      ADD CONSTRAINT "recommendation_item_request_id_key"
      UNIQUE ("request_id", "id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recommendation_episode_request_item_id_key'
      AND conrelid = 'recommendation_playback_episode'::regclass
  ) THEN
    ALTER TABLE "recommendation_playback_episode"
      ADD CONSTRAINT "recommendation_episode_request_item_id_key"
      UNIQUE ("request_id", "item_id", "id");
  END IF;
END $$;

CREATE TYPE "RecommendationContentActionClass" AS ENUM (
  'human_action',
  'machine_disposition',
  'reported_value'
);

CREATE TYPE "RecommendationContentActionKind" AS ENUM (
  'share',
  'save',
  'course_add',
  'continuation',
  'machine_disposition',
  'reported_value'
);

CREATE TYPE "RecommendationContentActionActorClass" AS ENUM (
  'human_anonymous',
  'human_signed_in',
  'machine',
  'internal',
  'test'
);

CREATE TYPE "RecommendationRequestPurpose" AS ENUM (
  'watch',
  'find_to_share',
  'course_build',
  'experience_generation'
);

CREATE TABLE "recommendation_content_action" (
  "id" TEXT NOT NULL,
  "contract_version" VARCHAR(64) NOT NULL,
  "session_digest" CHAR(64) NOT NULL,
  "event_id" VARCHAR(191) NOT NULL,
  "payload_digest" CHAR(64) NOT NULL,
  "action_class" "RecommendationContentActionClass" NOT NULL,
  "action_kind" "RecommendationContentActionKind" NOT NULL,
  "actor_class" "RecommendationContentActionActorClass" NOT NULL,
  "purpose" "RecommendationRequestPurpose" NOT NULL,
  "action_detail" VARCHAR(64),
  "target_media_id" VARCHAR(191) NOT NULL,
  "request_id" TEXT,
  "item_id" TEXT,
  "episode_id" TEXT,
  "candidate_generator" VARCHAR(64),
  "destination_artifact_type" VARCHAR(64),
  "destination_artifact_id" VARCHAR(191),
  "destination_audit_id" VARCHAR(191),
  "destination_deleted_at" TIMESTAMP(3),
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "late" BOOLEAN NOT NULL DEFAULT false,
  "learning_eligible" BOOLEAN NOT NULL DEFAULT false,
  "replay_count" INTEGER NOT NULL DEFAULT 0,
  "conflict_count" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_content_action_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_content_action_destination_pair_check" CHECK (
    ("destination_artifact_type" IS NULL) = ("destination_artifact_id" IS NULL)
  ),
  CONSTRAINT "recommendation_content_action_destination_audit_check" CHECK (
    "destination_artifact_id" IS NULL OR "destination_audit_id" IS NOT NULL
  ),
  CONSTRAINT "recommendation_content_action_lineage_check" CHECK (
    ("request_id" IS NOT NULL OR (
      "item_id" IS NULL AND
      "episode_id" IS NULL AND
      "candidate_generator" IS NULL
    )) AND
    ("item_id" IS NOT NULL OR (
      "episode_id" IS NULL AND
      "candidate_generator" IS NULL
    ))
  ),
  CONSTRAINT "recommendation_content_action_replay_count_check" CHECK ("replay_count" >= 0),
  CONSTRAINT "recommendation_content_action_conflict_count_check" CHECK ("conflict_count" >= 0)
);

CREATE UNIQUE INDEX "recommendation_content_action_session_event_key"
  ON "recommendation_content_action"("session_digest", "event_id");
CREATE INDEX "recommendation_content_action_request_occurred_idx"
  ON "recommendation_content_action"("request_id", "occurred_at");
CREATE INDEX "recommendation_content_action_episode_occurred_idx"
  ON "recommendation_content_action"("episode_id", "occurred_at");
CREATE INDEX "recommendation_content_action_kind_occurred_idx"
  ON "recommendation_content_action"("action_kind", "occurred_at");
CREATE INDEX "recommendation_content_action_expiry_idx"
  ON "recommendation_content_action"("expires_at");

ALTER TABLE "recommendation_content_action"
  ADD CONSTRAINT "recommendation_content_action_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "recommendation_request"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recommendation_content_action"
  ADD CONSTRAINT "recommendation_content_action_item_lineage_fkey"
  FOREIGN KEY ("request_id", "item_id")
  REFERENCES "recommendation_served_item"("request_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "recommendation_content_action"
  ADD CONSTRAINT "recommendation_content_action_episode_lineage_fkey"
  FOREIGN KEY ("request_id", "item_id", "episode_id")
  REFERENCES "recommendation_playback_episode"("request_id", "item_id", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;
