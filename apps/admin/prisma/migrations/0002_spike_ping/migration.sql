-- Unit 3 spike — throwaway `Ping`/`PingChild` tables.
-- Removed in Unit 4 by a follow-up migration when real content types land.
-- See docs/plans/2026-04-13-002-feat-admin-app-graphql-postgres-plan.md.

CREATE TABLE "ping" (
    "id"         TEXT        PRIMARY KEY,
    "message"    TEXT        NOT NULL,
    "is_public"  BOOLEAN     NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ping_child" (
    "id"      TEXT NOT NULL PRIMARY KEY,
    "label"   TEXT NOT NULL,
    "ping_id" TEXT NOT NULL,
    CONSTRAINT "ping_child_ping_id_fkey"
        FOREIGN KEY ("ping_id") REFERENCES "ping"("id") ON DELETE CASCADE
);

CREATE INDEX "ping_child_ping_id_idx" ON "ping_child"("ping_id");
