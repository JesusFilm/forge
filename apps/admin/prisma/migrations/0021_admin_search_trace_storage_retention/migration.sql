-- Admin-owned production search trace storage.
--
-- Raw rows are short-lived and are purged by raw_expires_at. Aggregates never
-- store query text and may survive raw trace deletion.

CREATE TYPE "SearchTraceRouteSource" AS ENUM ('rest', 'graphql');

CREATE TYPE "SearchTraceOutcome" AS ENUM ('success', 'degraded', 'failed');

CREATE TYPE "SearchTraceLatencyBucket" AS ENUM (
  'lt_100ms',
  'lt_250ms',
  'lt_500ms',
  'lt_1000ms',
  'lt_2500ms',
  'gte_2500ms'
);

CREATE TABLE "search_trace" (
  "id" text NOT NULL,
  "query_text" varchar(1024) NOT NULL,
  "locale" varchar(32) NOT NULL,
  "route_source" "SearchTraceRouteSource" NOT NULL,
  "requested_mode" varchar(64),
  "search_mode" varchar(64) NOT NULL,
  "result_count" integer NOT NULL,
  "latency_bucket" "SearchTraceLatencyBucket" NOT NULL,
  "outcome" "SearchTraceOutcome" NOT NULL,
  "trace_class" varchar(64) NOT NULL DEFAULT 'none',
  "query_quality_label" varchar(64) NOT NULL DEFAULT 'unknown',
  "sensitive_query_label" varchar(64) NOT NULL DEFAULT 'none',
  "abuse_label" varchar(64) NOT NULL DEFAULT 'none',
  "sample_eligible" boolean NOT NULL DEFAULT true,
  "started_at" timestamp(3) NOT NULL,
  "completed_at" timestamp(3) NOT NULL,
  "raw_expires_at" timestamp(3) NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "search_trace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_trace_raw_expires_at_idx"
  ON "search_trace"("raw_expires_at");

CREATE INDEX "search_trace_created_at_idx"
  ON "search_trace"("created_at");

CREATE INDEX "search_trace_locale_created_at_idx"
  ON "search_trace"("locale", "created_at");

CREATE INDEX "search_trace_route_source_created_at_idx"
  ON "search_trace"("route_source", "created_at");

CREATE INDEX "search_trace_outcome_created_at_idx"
  ON "search_trace"("outcome", "created_at");

CREATE INDEX "search_trace_sample_eligible_raw_expires_at_created_at_idx"
  ON "search_trace"("sample_eligible", "raw_expires_at", "created_at");

CREATE TABLE "search_trace_aggregate" (
  "id" text NOT NULL,
  "bucket_start" timestamp(3) NOT NULL,
  "locale" varchar(32) NOT NULL,
  "route_source" "SearchTraceRouteSource" NOT NULL,
  "search_mode" varchar(64) NOT NULL,
  "outcome" "SearchTraceOutcome" NOT NULL,
  "trace_class" varchar(64) NOT NULL DEFAULT 'none',
  "latency_bucket" "SearchTraceLatencyBucket" NOT NULL,
  "query_quality_label" varchar(64) NOT NULL DEFAULT 'unknown',
  "sensitive_query_label" varchar(64) NOT NULL DEFAULT 'none',
  "abuse_label" varchar(64) NOT NULL DEFAULT 'none',
  "query_count" integer NOT NULL DEFAULT 0,
  "result_count_sum" integer NOT NULL DEFAULT 0,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL,

  CONSTRAINT "search_trace_aggregate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "search_trace_aggregate_bucket_dims_key"
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
    "abuse_label"
  );

CREATE INDEX "search_trace_aggregate_bucket_start_idx"
  ON "search_trace_aggregate"("bucket_start");

CREATE INDEX "search_trace_aggregate_route_source_bucket_start_idx"
  ON "search_trace_aggregate"("route_source", "bucket_start");

CREATE INDEX "search_trace_aggregate_outcome_bucket_start_idx"
  ON "search_trace_aggregate"("outcome", "bucket_start");
