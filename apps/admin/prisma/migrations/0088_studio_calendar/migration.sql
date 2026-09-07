-- CreateTable
CREATE TABLE "studio_calendar" (
    "id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "settings" JSONB NOT NULL,

    CONSTRAINT "studio_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_plan_slot" (
    "id" VARCHAR(128) NOT NULL,
    "calendar_id" VARCHAR(128) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "title" VARCHAR(300) NOT NULL DEFAULT '',
    "theme" TEXT NOT NULL DEFAULT '',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "pack_revision_id" TEXT,
    "project_id" VARCHAR(128),
    "provenance" JSONB,

    CONSTRAINT "studio_plan_slot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_plan_week" (
    "calendar_id" VARCHAR(128) NOT NULL,
    "start_date" VARCHAR(10) NOT NULL,
    "pack_revision_id" TEXT,
    "theme" TEXT NOT NULL,

    CONSTRAINT "studio_plan_week_pkey" PRIMARY KEY ("calendar_id","start_date")
);

-- CreateTable
CREATE TABLE "studio_calendar_command" (
    "calendar_id" VARCHAR(128) NOT NULL,
    "key" VARCHAR(128) NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "result" JSONB NOT NULL,

    CONSTRAINT "studio_calendar_command_pkey" PRIMARY KEY ("calendar_id","key")
);

-- CreateTable
CREATE TABLE "studio_planning_run" (
    "id" VARCHAR(128) NOT NULL,
    "calendar_id" VARCHAR(128) NOT NULL,
    "occurrence" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "status" VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "studio_planning_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "studio_schedule_authorization" (
    "id" VARCHAR(128) NOT NULL,
    "slot_id" VARCHAR(128) NOT NULL,
    "version" INTEGER NOT NULL,
    "project_id" VARCHAR(128) NOT NULL,
    "revision" INTEGER NOT NULL,
    "approval_id" VARCHAR(128) NOT NULL,
    "render_attempt_id" VARCHAR(128) NOT NULL,
    "release_id" VARCHAR(128) NOT NULL,
    "operator_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "latest_allowed_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "submission" JSONB,
    "outcome" VARCHAR(40),

    CONSTRAINT "studio_schedule_authorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "studio_plan_slot_project_id_idx" ON "studio_plan_slot"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "studio_plan_slot_calendar_id_date_key" ON "studio_plan_slot"("calendar_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "studio_planning_run_calendar_id_occurrence_key" ON "studio_planning_run"("calendar_id", "occurrence");

-- CreateIndex
CREATE INDEX "studio_schedule_authorization_due_at_idx" ON "studio_schedule_authorization"("due_at");

-- CreateIndex
CREATE UNIQUE INDEX "studio_schedule_authorization_slot_id_version_key" ON "studio_schedule_authorization"("slot_id", "version");

-- AddForeignKey
ALTER TABLE "studio_plan_slot" ADD CONSTRAINT "studio_plan_slot_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "studio_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_plan_slot" ADD CONSTRAINT "studio_plan_slot_pack_revision_id_fkey" FOREIGN KEY ("pack_revision_id") REFERENCES "content_pack_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_plan_slot" ADD CONSTRAINT "studio_plan_slot_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "studio_project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_plan_week" ADD CONSTRAINT "studio_plan_week_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "studio_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_plan_week" ADD CONSTRAINT "studio_plan_week_pack_revision_id_fkey" FOREIGN KEY ("pack_revision_id") REFERENCES "content_pack_revision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_calendar_command" ADD CONSTRAINT "studio_calendar_command_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "studio_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_planning_run" ADD CONSTRAINT "studio_planning_run_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "studio_calendar"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_schedule_authorization" ADD CONSTRAINT "studio_schedule_authorization_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "studio_plan_slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_schedule_authorization" ADD CONSTRAINT "studio_schedule_authorization_project_id_revision_fkey" FOREIGN KEY ("project_id", "revision") REFERENCES "studio_project_revision"("project_id", "number") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_schedule_authorization" ADD CONSTRAINT "studio_schedule_authorization_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "studio_approval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_schedule_authorization" ADD CONSTRAINT "studio_schedule_authorization_render_attempt_id_fkey" FOREIGN KEY ("render_attempt_id") REFERENCES "studio_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_schedule_authorization" ADD CONSTRAINT "studio_schedule_authorization_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "studio_catalog_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_schedule_authorization" ADD CONSTRAINT "studio_schedule_authorization_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
