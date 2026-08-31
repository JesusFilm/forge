CREATE TYPE "RecommendationProfileChoice" AS ENUM ('durable_allowed');
CREATE TYPE "RecommendationProfileState" AS ENUM ('active', 'tombstoned', 'expired');
CREATE TYPE "RecommendationConsentTransitionKind" AS ENUM (
  'grant',
  'reset',
  'withdraw',
  'delete',
  'expire'
);
CREATE TYPE "RecommendationProfileErasureState" AS ENUM (
  'not_required',
  'pending',
  'completed',
  'failed'
);

CREATE TABLE "recommendation_profile" (
  "id" TEXT NOT NULL,
  "token_digest" CHAR(64),
  "privacy_generation" INTEGER NOT NULL,
  "choice" "RecommendationProfileChoice" NOT NULL,
  "state" "RecommendationProfileState" NOT NULL DEFAULT 'active',
  "purpose" VARCHAR(64) NOT NULL DEFAULT 'personalization',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "tombstoned_at" TIMESTAMP(3),
  "tombstone_reason" VARCHAR(64),
  "erasure_state" "RecommendationProfileErasureState" NOT NULL DEFAULT 'not_required',
  "erasure_requested_at" TIMESTAMP(3),
  "erasure_completed_at" TIMESTAMP(3),
  "erasure_failure_code" VARCHAR(64),
  "stale_worker_rejections" INTEGER NOT NULL DEFAULT 0,
  "deletion_drill_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_profile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_profile_generation_check" CHECK ("privacy_generation" >= 1),
  CONSTRAINT "recommendation_profile_state_check" CHECK (
    (
      "state" = 'active'
      AND "token_digest" IS NOT NULL
      AND "tombstoned_at" IS NULL
      AND "tombstone_reason" IS NULL
      AND "erasure_state" = 'not_required'
    )
    OR (
      "state" IN ('tombstoned', 'expired')
      AND "token_digest" IS NULL
      AND "tombstoned_at" IS NOT NULL
      AND "tombstone_reason" IS NOT NULL
      AND "erasure_state" IN ('pending', 'completed', 'failed')
    )
  )
);

CREATE TABLE "recommendation_profile_session_link" (
  "id" TEXT NOT NULL,
  "profile_id" TEXT NOT NULL,
  "privacy_generation" INTEGER NOT NULL,
  "session_digest" CHAR(64) NOT NULL,
  "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_profile_session_link_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_profile_session_generation_check" CHECK ("privacy_generation" >= 1)
);

CREATE TABLE "recommendation_consent_transition" (
  "id" TEXT NOT NULL,
  "audit_id" UUID NOT NULL,
  "profile_id" TEXT,
  "kind" "RecommendationConsentTransitionKind" NOT NULL,
  "from_generation" INTEGER,
  "to_generation" INTEGER,
  "choice" "RecommendationProfileChoice",
  "erasure_state" "RecommendationProfileErasureState" NOT NULL DEFAULT 'not_required',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_consent_transition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recommendation_consent_transition_generation_check" CHECK (
    ("from_generation" IS NULL OR "from_generation" >= 1)
    AND ("to_generation" IS NULL OR "to_generation" >= 1)
  )
);

CREATE UNIQUE INDEX "recommendation_profile_token_digest_key"
  ON "recommendation_profile"("token_digest");
CREATE INDEX "recommendation_profile_state_updated_idx"
  ON "recommendation_profile"("state", "updated_at");
CREATE INDEX "recommendation_profile_erasure_idx"
  ON "recommendation_profile"("erasure_state", "erasure_requested_at");
CREATE INDEX "recommendation_profile_expiry_idx"
  ON "recommendation_profile"("expires_at");

CREATE UNIQUE INDEX "recommendation_profile_session_generation_key"
  ON "recommendation_profile_session_link"("profile_id", "privacy_generation", "session_digest");
CREATE INDEX "recommendation_profile_session_digest_idx"
  ON "recommendation_profile_session_link"("session_digest", "expires_at");
CREATE INDEX "recommendation_profile_session_expiry_idx"
  ON "recommendation_profile_session_link"("expires_at");

CREATE UNIQUE INDEX "recommendation_consent_transition_audit_key"
  ON "recommendation_consent_transition"("audit_id");
CREATE INDEX "recommendation_consent_transition_kind_idx"
  ON "recommendation_consent_transition"("kind", "occurred_at");
CREATE INDEX "recommendation_consent_transition_profile_idx"
  ON "recommendation_consent_transition"("profile_id", "occurred_at");
CREATE INDEX "recommendation_consent_transition_expiry_idx"
  ON "recommendation_consent_transition"("expires_at");

ALTER TABLE "recommendation_profile_session_link"
  ADD CONSTRAINT "recommendation_profile_session_link_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recommendation_consent_transition"
  ADD CONSTRAINT "recommendation_consent_transition_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "recommendation_profile"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "recommendation_profile" IS
  'Consent-gated anonymous recommendation profile control state. Stores a one-way opaque-token digest only while active; no raw cookie, account id, IP, query, watch history, or interest vector. Purpose is personalization. Authorized profile service and privacy aggregate/detail readers only. Tombstone fencing is irreversible; generator fallback is session-only/semantic.';
COMMENT ON TABLE "recommendation_profile_session_link" IS
  '24-hour session-to-consented-profile bridge. Stores one-way digests only, expires independently, and is synchronously erased on reset, withdrawal, deletion, or expiry.';
COMMENT ON TABLE "recommendation_consent_transition" IS
  'Bounded 365-day non-content privacy audit. Destructive transitions detach profile linkage; audit ids are random and cannot reconstruct a viewer history.';
