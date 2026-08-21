-- Harden the report and moderation scaffolds from 0053. Public report intents
-- remain opaque; only a keyed consumption digest and bounded encrypted detail
-- reach persistence.

CREATE TYPE "UserPlaylistReportCategory" AS ENUM (
  'inappropriate_content',
  'misleading_or_spam',
  'copyright_or_rights',
  'privacy_or_personal_data',
  'other_safety'
);

CREATE TYPE "UserPlaylistModerationAction" AS ENUM ('block', 'restore');

CREATE TYPE "UserPlaylistModerationReason" AS ENUM (
  'abuse',
  'copyright',
  'privacy',
  'safety',
  'spam',
  'other_policy',
  'review_cleared',
  'appeal_approved',
  'error_corrected'
);

ALTER TABLE "user_playlist_report"
  ALTER COLUMN "category" TYPE "UserPlaylistReportCategory"
    USING lower("category")::"UserPlaylistReportCategory",
  ADD COLUMN "report_intent_expires_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "reporter_ip_digest_key_id" TEXT,
  ADD COLUMN "reporter_ip_digest_day" TEXT,
  ADD COLUMN "reporter_digest_deleted_at" TIMESTAMP(3),
  ADD COLUMN "detail_deleted_at" TIMESTAMP(3);

ALTER TABLE "user_playlist_report"
  ALTER COLUMN "report_intent_expires_at" DROP DEFAULT;

ALTER TABLE "user_playlist_moderation_audit"
  ALTER COLUMN "action" TYPE "UserPlaylistModerationAction"
    USING lower("action")::"UserPlaylistModerationAction",
  ALTER COLUMN "reason_code" TYPE "UserPlaylistModerationReason"
    USING lower("reason_code")::"UserPlaylistModerationReason";

ALTER TABLE "user_playlist_report"
  DROP CONSTRAINT "user_playlist_report_detail_material_check";

ALTER TABLE "user_playlist_report"
  ADD CONSTRAINT "user_playlist_report_intent_digest_check"
    CHECK (octet_length("report_intent_digest") = 32),
  ADD CONSTRAINT "user_playlist_report_intent_expiry_check"
    CHECK ("report_intent_expires_at" >= "created_at"),
  ADD CONSTRAINT "user_playlist_report_detail_material_check" CHECK (
    (
      "detail_ciphertext" IS NULL
      AND "detail_key_id" IS NULL
      AND "detail_nonce" IS NULL
      AND "detail_auth_tag" IS NULL
      AND "detail_delete_after" IS NULL
    ) OR (
      "detail_ciphertext" IS NOT NULL
      AND "detail_key_id" IS NOT NULL
      AND "detail_nonce" IS NOT NULL
      AND octet_length("detail_nonce") = 12
      AND "detail_auth_tag" IS NOT NULL
      AND octet_length("detail_auth_tag") = 16
      AND "detail_delete_after" IS NOT NULL
      AND "detail_deleted_at" IS NULL
    )
  ),
  ADD CONSTRAINT "user_playlist_report_ip_digest_material_check" CHECK (
    (
      "reporter_ip_digest" IS NULL
      AND "reporter_ip_digest_key_id" IS NULL
      AND "reporter_ip_digest_day" IS NULL
      AND "reporter_digest_delete_after" IS NULL
    ) OR (
      "reporter_ip_digest" IS NOT NULL
      AND octet_length("reporter_ip_digest") = 32
      AND "reporter_ip_digest_key_id" IS NOT NULL
      AND "reporter_ip_digest_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND "reporter_digest_delete_after" IS NOT NULL
      AND "reporter_digest_deleted_at" IS NULL
    )
  );

CREATE INDEX "user_playlist_report_category_created_at_idx"
  ON "user_playlist_report"("category", "created_at");
