-- Expire abandoned queued match jobs without removing their lightweight job rows.
ALTER TYPE "match_job_status" ADD VALUE 'expired';

-- Support cleaner scans for queued jobs crossing the expiry threshold.
CREATE INDEX IF NOT EXISTS "mapper_match_job_status_queued_at_idx"
ON "mapper_match_job"("status", "queued_at");

-- Coordinate cleaner passes across app instances without adding an external queue.
CREATE TABLE "mapper_match_job_cleaner_lease" (
  "name" TEXT NOT NULL,
  "locked_until" TIMESTAMP(3) NOT NULL,
  "owner_token" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mapper_match_job_cleaner_lease_pkey" PRIMARY KEY ("name")
);
