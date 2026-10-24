CREATE TYPE "StudioAccessStatus" AS ENUM ('pending', 'approved', 'revoked');
CREATE TYPE "StudioAccessRole" AS ENUM ('admin', 'editor');

CREATE TABLE "studio_access" (
    "id" TEXT NOT NULL,
    "subject" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "StudioAccessStatus" NOT NULL DEFAULT 'pending',
    "role" "StudioAccessRole" NOT NULL DEFAULT 'editor',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "last_access_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "studio_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studio_access_subject_key" ON "studio_access"("subject");
CREATE UNIQUE INDEX "studio_access_email_key" ON "studio_access"("email");
CREATE INDEX "studio_access_status_idx" ON "studio_access"("status");
CREATE INDEX "studio_access_role_idx" ON "studio_access"("role");
