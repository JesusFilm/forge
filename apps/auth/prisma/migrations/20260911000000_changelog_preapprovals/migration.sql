-- CreateTable
CREATE TABLE "changelog_preapproval" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "approver_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "redeemed_at" TIMESTAMP(3),
    "redeemed_by_id" TEXT,

    CONSTRAINT "changelog_preapproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "changelog_preapproval_environment_id_approver_id_state_idx" ON "changelog_preapproval"("environment_id", "approver_id", "state");

-- AddForeignKey
ALTER TABLE "changelog_preapproval" ADD CONSTRAINT "changelog_preapproval_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "app_environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
