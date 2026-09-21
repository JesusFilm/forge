-- Localized push campaigns (feat-524), U1.
-- Push owns its own tables. This migration only creates push objects; it
-- alters no existing table, so it takes no lock outside the new tables.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android');
CREATE TYPE "PushRegistrationStatus" AS ENUM ('active', 'inactive', 'invalid', 'superseded');
CREATE TYPE "PushCountrySource" AS ENUM ('edge', 'phone_region', 'unknown');
CREATE TYPE "PushCampaignStatus" AS ENUM ('draft', 'tested', 'scheduled', 'sending', 'sent', 'paused', 'cancelled');
CREATE TYPE "PushCampaignMode" AS ENUM ('wave', 'immediate');
CREATE TYPE "PushAudienceScope" AS ENUM ('everywhere', 'countries');
CREATE TYPE "PushDestinationKind" AS ENUM ('video', 'series', 'experience');
CREATE TYPE "PushZoneStatus" AS ENUM ('pending', 'dispatching', 'dispatched', 'missed', 'cancelled');
CREATE TYPE "PushDeliveryKind" AS ENUM ('live', 'test');
CREATE TYPE "PushDeliveryStatus" AS ENUM ('reserved', 'sending', 'accepted', 'handed_off', 'unknown', 'failed', 'invalid', 'suppressed', 'unreachable', 'missed');

CREATE TABLE "push_registration" (
    "id" TEXT NOT NULL,
    "expo_push_token" VARCHAR(191) NOT NULL,
    "test_device_id" VARCHAR(64) NOT NULL,
    "viewer_digest" CHAR(64),
    "platform" "PushPlatform" NOT NULL,
    "app_build" VARCHAR(64) NOT NULL,
    "app_language_slug" VARCHAR(191) NOT NULL,
    "phone_locale" VARCHAR(35) NOT NULL,
    "phone_language_slug" VARCHAR(191),
    "time_zone" VARCHAR(64) NOT NULL,
    "country" VARCHAR(8),
    "country_source" "PushCountrySource" NOT NULL,
    "status" "PushRegistrationStatus" NOT NULL DEFAULT 'active',
    "status_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_registration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_test_device" (
    "id" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "registration_id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_test_device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_campaign" (
    "id" TEXT NOT NULL,
    "status" "PushCampaignStatus" NOT NULL DEFAULT 'draft',
    "destination_kind" "PushDestinationKind",
    "destination_slug" VARCHAR(191),
    "audience_scope" "PushAudienceScope" NOT NULL DEFAULT 'everywhere',
    "countries" TEXT[],
    "language_filter" TEXT[],
    "send_date" DATE,
    "local_hour" INTEGER,
    "mode" "PushCampaignMode" NOT NULL DEFAULT 'wave',
    "test_sent_at" TIMESTAMPTZ,
    "sending_started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "workflow_run_log_id" TEXT,
    "last_actor_id" TEXT,
    "last_error" VARCHAR(256),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_campaign_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_campaign_local_hour_check" CHECK (
      "local_hour" IS NULL OR ("local_hour" >= 0 AND "local_hour" <= 23)
    ),
    CONSTRAINT "push_campaign_destination_check" CHECK (
      "status" = 'draft' OR (
        "destination_kind" IS NOT NULL
        AND "destination_slug" IS NOT NULL
        AND length("destination_slug") > 0
      )
    ),
    CONSTRAINT "push_campaign_audience_bounds_check" CHECK (
      coalesce(array_length("countries", 1), 0) <= 300
      AND coalesce(array_length("language_filter", 1), 0) <= 300
    )
);

CREATE TABLE "push_campaign_copy" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "language_slug" VARCHAR(191) NOT NULL,
    "title" VARCHAR(50) NOT NULL,
    "body" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_campaign_copy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_campaign_zone" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "status" "PushZoneStatus" NOT NULL DEFAULT 'pending',
    "audience_count" INTEGER NOT NULL DEFAULT 0,
    "dispatched_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_campaign_zone_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "push_campaign_zone_audience_count_check" CHECK ("audience_count" >= 0)
);

CREATE TABLE "push_delivery" (
    "id" TEXT NOT NULL,
    "nonce" VARCHAR(64) NOT NULL,
    "kind" "PushDeliveryKind" NOT NULL DEFAULT 'live',
    "campaign_id" TEXT NOT NULL,
    "registration_id" TEXT,
    "local_day" DATE NOT NULL,
    "language_slug" VARCHAR(191) NOT NULL,
    "country" VARCHAR(8),
    "time_zone" VARCHAR(64) NOT NULL,
    "status" "PushDeliveryStatus" NOT NULL DEFAULT 'reserved',
    "ticket_id" VARCHAR(191),
    "sending_at" TIMESTAMPTZ,
    "error" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "push_delivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_open" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "registration_id" TEXT,
    "viewer_digest" CHAR(64),
    "session_digest" CHAR(64),
    "language_slug" VARCHAR(191),
    "country" VARCHAR(8),
    "viewer_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_open_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_attribution" (
    "id" TEXT NOT NULL,
    "episode_id" VARCHAR(191) NOT NULL,
    "open_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "registration_id" TEXT,
    "viewer_digest" CHAR(64),
    "language_slug" VARCHAR(191),
    "country" VARCHAR(8),
    "media_id" VARCHAR(191) NOT NULL,
    "attributed_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_attribution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_registration_expo_push_token_key" ON "push_registration"("expo_push_token");
CREATE UNIQUE INDEX "push_registration_test_device_id_key" ON "push_registration"("test_device_id");
CREATE INDEX "push_registration_viewer_digest_idx" ON "push_registration"("viewer_digest");
-- The dashboard counts new phones per UTC day over a trailing window.
CREATE INDEX "push_registration_created_at_idx" ON "push_registration"("created_at");
-- The unreachable count reads active Android phones in the blocked countries.
-- Prisma cannot declare a partial index, so this one has no schema.prisma twin.
CREATE INDEX "push_registration_active_country_platform_idx"
  ON "push_registration"("country", "platform")
  WHERE "status" = 'active';
-- The audience reads active rows by zone; the purge reads stale active rows by
-- refresh time and retired rows by the instant their status changed.
CREATE INDEX "push_registration_active_time_zone_id_idx"
  ON "push_registration"("time_zone", "id")
  WHERE "status" = 'active';
CREATE INDEX "push_registration_active_refreshed_at_idx"
  ON "push_registration"("refreshed_at")
  WHERE "status" = 'active';
CREATE INDEX "push_registration_retired_status_changed_at_idx"
  ON "push_registration"("status_changed_at")
  WHERE "status" <> 'active';

CREATE UNIQUE INDEX "push_test_device_registration_id_key" ON "push_test_device"("registration_id");

CREATE INDEX "push_campaign_status_created_at_idx" ON "push_campaign"("status", "created_at");

CREATE UNIQUE INDEX "push_campaign_copy_campaign_id_language_slug_key" ON "push_campaign_copy"("campaign_id", "language_slug");

CREATE UNIQUE INDEX "push_campaign_zone_campaign_id_time_zone_key" ON "push_campaign_zone"("campaign_id", "time_zone");
CREATE INDEX "push_campaign_zone_campaign_id_scheduled_at_idx" ON "push_campaign_zone"("campaign_id", "scheduled_at");

CREATE UNIQUE INDEX "push_delivery_nonce_key" ON "push_delivery"("nonce");
CREATE INDEX "push_delivery_campaign_id_status_id_idx" ON "push_delivery"("campaign_id", "status", "id");
CREATE INDEX "push_delivery_created_at_id_idx" ON "push_delivery"("created_at", "id");
-- Deleting a retired registration nulls this column on every row that holds
-- it. The daily-claim index below leads on it but is partial, so it cannot
-- serve that scan.
CREATE INDEX "push_delivery_registration_id_idx" ON "push_delivery"("registration_id");
CREATE INDEX "push_delivery_ticket_id_idx"
  ON "push_delivery"("ticket_id")
  WHERE "ticket_id" IS NOT NULL;
-- One live row per campaign and phone. A test row is outside this index, so a
-- test send never blocks the live send to the same test phone.
CREATE UNIQUE INDEX "push_delivery_campaign_registration_live_key"
  ON "push_delivery"("campaign_id", "registration_id")
  WHERE "kind" = 'live';
-- The daily claim. One live row per phone per local day, restricted to the
-- statuses under which the phone may have been reached. A row that ends as
-- failed, invalid, suppressed, unreachable, or missed leaves the index, so the
-- phone's day is free for another campaign. The send path claims with one
-- multi-row INSERT ... ON CONFLICT DO NOTHING and no conflict target: this
-- index and the live-uniqueness index above are both arbiters.
CREATE UNIQUE INDEX "push_delivery_daily_claim_key"
  ON "push_delivery"("registration_id", "local_day")
  WHERE "kind" = 'live'
    AND "status" IN ('reserved', 'sending', 'accepted', 'handed_off', 'unknown');

CREATE UNIQUE INDEX "push_open_delivery_id_key" ON "push_open"("delivery_id");
CREATE INDEX "push_open_viewer_digest_received_at_idx" ON "push_open"("viewer_digest", "received_at");
CREATE INDEX "push_open_session_digest_received_at_idx" ON "push_open"("session_digest", "received_at");
CREATE INDEX "push_open_created_at_id_idx" ON "push_open"("created_at", "id");
-- The report aggregates opens by campaign; the purge nulls registration_id.
CREATE INDEX "push_open_campaign_id_idx" ON "push_open"("campaign_id");
CREATE INDEX "push_open_registration_id_idx" ON "push_open"("registration_id");

CREATE UNIQUE INDEX "push_attribution_episode_id_key" ON "push_attribution"("episode_id");
CREATE INDEX "push_attribution_campaign_id_idx" ON "push_attribution"("campaign_id");
CREATE INDEX "push_attribution_created_at_id_idx" ON "push_attribution"("created_at", "id");
-- Deleting an open cascades through open_id; the purge nulls registration_id;
-- the viewer identity unlink deletes by viewer_digest.
CREATE INDEX "push_attribution_open_id_idx" ON "push_attribution"("open_id");
CREATE INDEX "push_attribution_registration_id_idx" ON "push_attribution"("registration_id");
CREATE INDEX "push_attribution_viewer_digest_idx" ON "push_attribution"("viewer_digest");

ALTER TABLE "push_test_device" ADD CONSTRAINT "push_test_device_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "push_registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_campaign_copy" ADD CONSTRAINT "push_campaign_copy_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "push_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_campaign_zone" ADD CONSTRAINT "push_campaign_zone_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "push_campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "push_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_delivery" ADD CONSTRAINT "push_delivery_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "push_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "push_open" ADD CONSTRAINT "push_open_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "push_delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_open" ADD CONSTRAINT "push_open_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "push_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_open" ADD CONSTRAINT "push_open_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "push_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "push_attribution" ADD CONSTRAINT "push_attribution_open_id_fkey" FOREIGN KEY ("open_id") REFERENCES "push_open"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "push_attribution" ADD CONSTRAINT "push_attribution_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "push_campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "push_attribution" ADD CONSTRAINT "push_attribution_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "push_registration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON INDEX "push_delivery_daily_claim_key" IS
  'One announcement per phone per local day. Partial unique on (registration_id, local_day) for live rows whose status is one the phone may have been reached under. The claim insert is one multi-row INSERT ... ON CONFLICT DO NOTHING; a row absent afterwards lost the day and is recorded as suppressed.';

COMMENT ON TABLE "push_registration" IS
  'One phone push address. viewer_digest is the recommendation viewer token digest and is nulled on a viewer erasure or expiry; the registration itself survives every identity event.';

COMMENT ON TABLE "push_attribution" IS
  'One attributed watch start. episode_id carries no foreign key on purpose, so the recommendation retention purge of a playback episode leaves the campaign report unchanged.';

COMMIT;
