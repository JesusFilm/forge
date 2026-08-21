-- Consumer-owned User Playlists are a separate aggregate. This migration has
-- no foreign keys, triggers, or hooks into editorial Experience/Video/search/
-- manifest persistence. Media identities remain values inside validated JSON.

CREATE TYPE "UserPlaylistShareState" AS ENUM ('shared', 'unshared');
CREATE TYPE "UserPlaylistModerationState" AS ENUM ('active', 'blocked');
CREATE TYPE "ConsumerLifecycleState" AS ENUM (
  'active',
  'suspending',
  'suspended',
  'disabled',
  'deleting',
  'deleted'
);

CREATE TABLE "user_playlist" (
  "id" TEXT NOT NULL,
  "owner_subject" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "content_locale" TEXT NOT NULL,
  "context_country" TEXT,
  "blocks" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "share_state" "UserPlaylistShareState" NOT NULL DEFAULT 'shared',
  "moderation_state" "UserPlaylistModerationState" NOT NULL DEFAULT 'active',
  "capability_token_version" INTEGER NOT NULL DEFAULT 1,
  "capability_digest" BYTEA,
  "capability_digest_key_id" TEXT,
  "capability_ciphertext" BYTEA,
  "capability_encryption_key_id" TEXT,
  "capability_nonce" BYTEA,
  "capability_auth_tag" BYTEA,
  "accepted_terms_version" TEXT NOT NULL,
  "accepted_privacy_version" TEXT NOT NULL,
  "accepted_community_guidelines_version" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_playlist_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_playlist_title_length_check"
    CHECK (char_length("title") BETWEEN 1 AND 120),
  CONSTRAINT "user_playlist_description_length_check"
    CHECK (char_length("description") <= 2000),
  CONSTRAINT "user_playlist_locale_length_check"
    CHECK (char_length("content_locale") BETWEEN 2 AND 35),
  CONSTRAINT "user_playlist_context_country_check"
    CHECK ("context_country" IS NULL OR "context_country" ~ '^[A-Z]{2}$'),
  CONSTRAINT "user_playlist_version_check" CHECK ("version" > 0),
  CONSTRAINT "user_playlist_capability_token_version_check"
    CHECK ("capability_token_version" > 0),
  CONSTRAINT "user_playlist_capability_byte_lengths_check" CHECK (
    ("capability_digest" IS NULL OR octet_length("capability_digest") = 32)
    AND ("capability_nonce" IS NULL OR octet_length("capability_nonce") = 12)
    AND ("capability_auth_tag" IS NULL OR octet_length("capability_auth_tag") = 16)
  ),
  CONSTRAINT "user_playlist_capability_key_ids_check" CHECK (
    ("capability_digest_key_id" IS NULL OR char_length("capability_digest_key_id") BETWEEN 1 AND 64)
    AND ("capability_encryption_key_id" IS NULL OR char_length("capability_encryption_key_id") BETWEEN 1 AND 64)
  ),
  CONSTRAINT "user_playlist_capability_material_check" CHECK (
    (
      "share_state" = 'shared'
      AND "capability_digest" IS NOT NULL
      AND "capability_digest_key_id" IS NOT NULL
      AND "capability_ciphertext" IS NOT NULL
      AND "capability_encryption_key_id" IS NOT NULL
      AND "capability_nonce" IS NOT NULL
      AND "capability_auth_tag" IS NOT NULL
    ) OR (
      "share_state" = 'unshared'
      AND "capability_digest" IS NULL
      AND "capability_digest_key_id" IS NULL
      AND "capability_ciphertext" IS NULL
      AND "capability_encryption_key_id" IS NULL
      AND "capability_nonce" IS NULL
      AND "capability_auth_tag" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "user_playlist_capability_digest_key"
  ON "user_playlist"("capability_digest");
CREATE INDEX "user_playlist_owner_subject_updated_at_idx"
  ON "user_playlist"("owner_subject", "updated_at");
CREATE INDEX "user_playlist_share_state_moderation_state_idx"
  ON "user_playlist"("share_state", "moderation_state");

CREATE TABLE "user_playlist_owner_quota" (
  "owner_subject" TEXT NOT NULL,
  "playlist_count" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "user_playlist_owner_quota_pkey" PRIMARY KEY ("owner_subject"),
  CONSTRAINT "user_playlist_owner_quota_count_check"
    CHECK ("playlist_count" BETWEEN 0 AND 20)
);

CREATE TABLE "consumer_lifecycle_projection" (
  "owner_subject" TEXT NOT NULL,
  "state" "ConsumerLifecycleState" NOT NULL,
  "version" BIGINT NOT NULL,
  "active_lease_expires_at" TIMESTAMP(3),
  "source_event_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "consumer_lifecycle_projection_pkey" PRIMARY KEY ("owner_subject"),
  CONSTRAINT "consumer_lifecycle_projection_version_check" CHECK ("version" >= 0),
  CONSTRAINT "consumer_lifecycle_projection_active_lease_check" CHECK (
    ("state" = 'active' AND "active_lease_expires_at" IS NOT NULL)
    OR ("state" <> 'active' AND "active_lease_expires_at" IS NULL)
  )
);

CREATE INDEX "consumer_lifecycle_projection_state_active_lease_expires_at_idx"
  ON "consumer_lifecycle_projection"("state", "active_lease_expires_at");
CREATE UNIQUE INDEX "consumer_lifecycle_projection_source_event_id_key"
  ON "consumer_lifecycle_projection"("source_event_id");

CREATE TABLE "user_playlist_report" (
  "id" TEXT NOT NULL,
  "playlist_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "report_intent_digest" BYTEA NOT NULL,
  "reporter_ip_digest" BYTEA,
  "detail_ciphertext" BYTEA,
  "detail_key_id" TEXT,
  "detail_nonce" BYTEA,
  "detail_auth_tag" BYTEA,
  "detail_delete_after" TIMESTAMP(3),
  "reporter_digest_delete_after" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_playlist_report_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_playlist_report_detail_material_check" CHECK (
    ("detail_ciphertext" IS NULL AND "detail_key_id" IS NULL AND "detail_nonce" IS NULL AND "detail_auth_tag" IS NULL)
    OR ("detail_ciphertext" IS NOT NULL AND "detail_key_id" IS NOT NULL AND "detail_nonce" IS NOT NULL AND "detail_auth_tag" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "user_playlist_report_report_intent_digest_key"
  ON "user_playlist_report"("report_intent_digest");
CREATE INDEX "user_playlist_report_playlist_id_created_at_idx"
  ON "user_playlist_report"("playlist_id", "created_at");
CREATE INDEX "user_playlist_report_detail_delete_after_idx"
  ON "user_playlist_report"("detail_delete_after");
CREATE INDEX "user_playlist_report_reporter_digest_delete_after_idx"
  ON "user_playlist_report"("reporter_digest_delete_after");

CREATE TABLE "user_playlist_moderation_audit" (
  "id" TEXT NOT NULL,
  "playlist_id" TEXT,
  "actor_subject" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "reason_code" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_playlist_moderation_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "user_playlist_moderation_audit_playlist_id_created_at_idx"
  ON "user_playlist_moderation_audit"("playlist_id", "created_at");
CREATE INDEX "user_playlist_moderation_audit_actor_subject_created_at_idx"
  ON "user_playlist_moderation_audit"("actor_subject", "created_at");

CREATE TABLE "user_playlist_audit" (
  "id" TEXT NOT NULL,
  "playlist_id" TEXT,
  "owner_subject" TEXT,
  "owner_subject_digest" BYTEA,
  "event" TEXT NOT NULL,
  "version" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_playlist_audit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_playlist_audit_subject_check"
    CHECK (
      ("owner_subject" IS NOT NULL AND "owner_subject_digest" IS NULL)
      OR ("owner_subject" IS NULL AND "owner_subject_digest" IS NOT NULL)
    )
);

CREATE INDEX "user_playlist_audit_owner_subject_created_at_idx"
  ON "user_playlist_audit"("owner_subject", "created_at");
CREATE INDEX "user_playlist_audit_playlist_id_created_at_idx"
  ON "user_playlist_audit"("playlist_id", "created_at");

CREATE TABLE "user_playlist_erasure_receipt" (
  "id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "owner_subject_digest" BYTEA NOT NULL,
  "lifecycle_version" BIGINT NOT NULL,
  "erased_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_playlist_erasure_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_playlist_erasure_receipt_idempotency_key_check"
    CHECK (char_length("idempotency_key") BETWEEN 8 AND 128),
  CONSTRAINT "user_playlist_erasure_receipt_subject_digest_check"
    CHECK (octet_length("owner_subject_digest") = 32),
  CONSTRAINT "user_playlist_erasure_receipt_erased_count_check" CHECK ("erased_count" >= 0)
);

CREATE UNIQUE INDEX "user_playlist_erasure_receipt_idempotency_key_key"
  ON "user_playlist_erasure_receipt"("idempotency_key");
CREATE INDEX "user_playlist_erasure_receipt_owner_subject_digest_idx"
  ON "user_playlist_erasure_receipt"("owner_subject_digest");

ALTER TABLE "user_playlist_report"
  ADD CONSTRAINT "user_playlist_report_playlist_id_fkey"
  FOREIGN KEY ("playlist_id") REFERENCES "user_playlist"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_playlist_moderation_audit"
  ADD CONSTRAINT "user_playlist_moderation_audit_playlist_id_fkey"
  FOREIGN KEY ("playlist_id") REFERENCES "user_playlist"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_playlist_audit"
  ADD CONSTRAINT "user_playlist_audit_playlist_id_fkey"
  FOREIGN KEY ("playlist_id") REFERENCES "user_playlist"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
