CREATE TYPE "ConsumerLifecycleState" AS ENUM (
  'active',
  'suspending',
  'suspended',
  'disabled',
  'deleting',
  'deleted'
);

CREATE TYPE "ConsumerLifecycleOutboxStatus" AS ENUM (
  'pending',
  'leased',
  'delivered',
  'dead'
);

ALTER TABLE "user"
  ADD COLUMN "consumer_lifecycle_state" "ConsumerLifecycleState" NOT NULL DEFAULT 'disabled',
  ADD COLUMN "consumer_lifecycle_version" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "consumer_lifecycle_renewed_at" TIMESTAMP(3);

ALTER TABLE "user"
  ADD CONSTRAINT "user_consumer_lifecycle_version_check"
  CHECK ("consumer_lifecycle_version" >= 0);

CREATE TABLE "consumer_lifecycle_outbox" (
  "id" TEXT NOT NULL,
  "owner_subject" TEXT NOT NULL,
  "state" "ConsumerLifecycleState" NOT NULL,
  "version" BIGINT NOT NULL,
  "active_lease_expires_at" TIMESTAMP(3),
  "status" "ConsumerLifecycleOutboxStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_owner" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "delivered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "consumer_lifecycle_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "consumer_lifecycle_outbox_version_check" CHECK ("version" > 0),
  CONSTRAINT "consumer_lifecycle_outbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "consumer_lifecycle_outbox_lease_check" CHECK (
    ("status" = 'leased' AND "lease_owner" IS NOT NULL AND "lease_expires_at" IS NOT NULL)
    OR ("status" <> 'leased' AND "lease_owner" IS NULL AND "lease_expires_at" IS NULL)
  ),
  CONSTRAINT "consumer_lifecycle_outbox_active_lease_check" CHECK (
    ("state" = 'active' AND "active_lease_expires_at" IS NOT NULL)
    OR ("state" <> 'active' AND "active_lease_expires_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "consumer_lifecycle_outbox_owner_subject_version_key"
  ON "consumer_lifecycle_outbox"("owner_subject", "version");
CREATE INDEX "consumer_lifecycle_outbox_status_next_attempt_at_idx"
  ON "consumer_lifecycle_outbox"("status", "next_attempt_at");
CREATE INDEX "consumer_lifecycle_outbox_lease_expires_at_idx"
  ON "consumer_lifecycle_outbox"("lease_expires_at");

ALTER TABLE "consumer_lifecycle_outbox"
  ADD CONSTRAINT "consumer_lifecycle_outbox_owner_subject_fkey"
  FOREIGN KEY ("owner_subject") REFERENCES "user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
