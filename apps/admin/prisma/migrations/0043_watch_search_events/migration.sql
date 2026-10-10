CREATE TABLE "watch_search_event" (
  "id" TEXT NOT NULL,
  "request_id" VARCHAR(80) NOT NULL,
  "event_type" VARCHAR(64) NOT NULL,
  "client" VARCHAR(32) NOT NULL,
  "result_id" VARCHAR(128),
  "result_type" VARCHAR(32),
  "position" INTEGER,
  "metadata" JSONB,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "watch_search_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "watch_search_event_request_id_occurred_at_idx"
  ON "watch_search_event"("request_id", "occurred_at");

CREATE INDEX "watch_search_event_event_type_occurred_at_idx"
  ON "watch_search_event"("event_type", "occurred_at");

CREATE INDEX "watch_search_event_client_occurred_at_idx"
  ON "watch_search_event"("client", "occurred_at");

CREATE INDEX "watch_search_event_expires_at_idx"
  ON "watch_search_event"("expires_at");
