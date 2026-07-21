ALTER TABLE "search_trace" ADD COLUMN "request_id" VARCHAR(80);
ALTER TABLE "search_trace" ADD COLUMN "metadata" JSONB;
CREATE INDEX IF NOT EXISTS "search_trace_request_id_idx"
  ON "search_trace"("request_id");
