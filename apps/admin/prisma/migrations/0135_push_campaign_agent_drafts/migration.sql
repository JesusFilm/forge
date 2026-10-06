-- Push campaign drafts through the admin MCP (feat-612), U2.
-- Additive columns only. The defaults need no table rewrite, so existing rows
-- keep their status and start at content version 0.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE "push_campaign"
  ADD COLUMN "content_version" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_test_content_version" INTEGER,
  ADD COLUMN "ai_last_actor_id" TEXT,
  ADD COLUMN "ai_last_written_at" TIMESTAMPTZ;

COMMIT;
