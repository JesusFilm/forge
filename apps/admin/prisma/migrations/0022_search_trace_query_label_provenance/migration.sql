ALTER TABLE "search_trace"
  ADD COLUMN "query_label_source" varchar(32) NOT NULL DEFAULT 'rules',
  ADD COLUMN "query_label_version" varchar(64) NOT NULL DEFAULT 'search-query-labels/v1',
  ADD COLUMN "query_labeled_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "llm_query_quality_label" varchar(64),
  ADD COLUMN "llm_abuse_label" varchar(64),
  ADD COLUMN "llm_label_source" varchar(64),
  ADD COLUMN "llm_label_version" varchar(64),
  ADD COLUMN "llm_label_reason" varchar(256),
  ADD COLUMN "llm_labeled_at" timestamp(3);

ALTER TABLE "search_trace_aggregate"
  ADD COLUMN "query_label_source" varchar(32) NOT NULL DEFAULT 'rules',
  ADD COLUMN "query_label_version" varchar(64) NOT NULL DEFAULT 'search-query-labels/v1';

UPDATE "search_trace"
SET
  "query_quality_label" = CASE "query_quality_label"
    WHEN 'empty' THEN 'empty_too_short'
    WHEN 'short' THEN 'empty_too_short'
    WHEN 'normal' THEN 'valid_viewer_intent'
    WHEN 'long' THEN 'unknown_ambiguous'
    WHEN 'unknown' THEN 'unknown_ambiguous'
    ELSE "query_quality_label"
  END,
  "abuse_label" = CASE "abuse_label"
    WHEN 'injection_probe' THEN 'prompt_injection_like'
    WHEN 'spam' THEN 'repeated_spam'
    ELSE "abuse_label"
  END,
  "query_labeled_at" = "created_at";

UPDATE "search_trace_aggregate"
SET
  "query_quality_label" = CASE "query_quality_label"
    WHEN 'empty' THEN 'empty_too_short'
    WHEN 'short' THEN 'empty_too_short'
    WHEN 'normal' THEN 'valid_viewer_intent'
    WHEN 'long' THEN 'unknown_ambiguous'
    WHEN 'unknown' THEN 'unknown_ambiguous'
    ELSE "query_quality_label"
  END,
  "abuse_label" = CASE "abuse_label"
    WHEN 'injection_probe' THEN 'prompt_injection_like'
    WHEN 'spam' THEN 'repeated_spam'
    ELSE "abuse_label"
  END;

ALTER TABLE "search_trace"
  ALTER COLUMN "query_quality_label" SET DEFAULT 'unknown_ambiguous';

ALTER TABLE "search_trace_aggregate"
  ALTER COLUMN "query_quality_label" SET DEFAULT 'unknown_ambiguous';

CREATE UNIQUE INDEX "search_trace_aggregate_bucket_label_dims_key"
  ON "search_trace_aggregate"(
    "bucket_start",
    "route_source",
    "locale",
    "search_mode",
    "outcome",
    "trace_class",
    "latency_bucket",
    "query_quality_label",
    "sensitive_query_label",
    "abuse_label",
    "query_label_source",
    "query_label_version"
  );

CREATE INDEX "search_trace_label_filters_raw_expires_created_idx"
  ON "search_trace"(
    "query_quality_label",
    "sensitive_query_label",
    "abuse_label",
    "raw_expires_at",
    "created_at"
  );

CREATE INDEX "search_trace_llm_label_source_created_at_idx"
  ON "search_trace"("llm_label_source", "created_at");
