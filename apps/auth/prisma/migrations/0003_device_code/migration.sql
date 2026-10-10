-- RFC 8628 device authorization grant (feat-322).
-- No CREATE INDEX CONCURRENTLY: `migrate deploy` runs inside a transaction.
-- IF EXISTS / IF NOT EXISTS throughout because Railway retries a failed deploy
-- up to three times and a partially-applied migration must re-run cleanly.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeviceCodeStatus') THEN
    CREATE TYPE "DeviceCodeStatus" AS ENUM ('pending', 'approved', 'denied');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "device_code" (
    "id" TEXT NOT NULL,
    "device_code_hash" TEXT NOT NULL,
    "user_code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL,
    "status" "DeviceCodeStatus" NOT NULL DEFAULT 'pending',
    "user_id" TEXT,
    "session_id" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "polling_interval_ms" INTEGER NOT NULL,
    "last_polled_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "device_code_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "device_code_device_code_hash_key" ON "device_code"("device_code_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "device_code_user_code_hash_key" ON "device_code"("user_code_hash");
CREATE INDEX IF NOT EXISTS "device_code_expires_at_idx" ON "device_code"("expires_at");
CREATE INDEX IF NOT EXISTS "device_code_user_id_idx" ON "device_code"("user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'device_code_user_id_fkey'
  ) THEN
    ALTER TABLE "device_code"
      ADD CONSTRAINT "device_code_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
