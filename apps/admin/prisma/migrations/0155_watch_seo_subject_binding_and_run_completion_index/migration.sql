-- feat-712: durable Auth subject -> Admin user binding recorded by the
-- verified Admin OAuth callback, and an index matching the Watch SEO read
-- model's terminal-run lookup (status IN (...) AND completed_at > window
-- ORDER BY completed_at DESC LIMIT n).

-- CreateTable
CREATE TABLE "admin_auth_subject_binding" (
    "subject" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_auth_subject_binding_pkey" PRIMARY KEY ("subject")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_auth_subject_binding_user_id_key" ON "admin_auth_subject_binding"("user_id");

-- CreateIndex
CREATE INDEX "seo_run_status_completed_at_idx" ON "seo_run"("status", "completed_at");

-- AddForeignKey
ALTER TABLE "admin_auth_subject_binding" ADD CONSTRAINT "admin_auth_subject_binding_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
