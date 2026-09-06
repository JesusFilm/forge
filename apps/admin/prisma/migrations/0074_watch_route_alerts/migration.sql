CREATE TYPE "WatchRouteAlertAutomationMode" AS ENUM ('off', 'dry_run', 'live');
CREATE TYPE "WatchRouteAlertRunStatus" AS ENUM ('running', 'completed', 'partial', 'failed');
CREATE TYPE "WatchRouteAlertCountKind" AS ENUM ('event_count', 'page_views');
CREATE TYPE "WatchRouteAlertVerdict" AS ENUM (
  'supported_route_failure',
  'plausible_missing_route'
);
CREATE TYPE "WatchRouteAlertSeverity" AS ENUM ('critical', 'high', 'medium');
CREATE TYPE "WatchRouteAlertLifecycle" AS ENUM ('open', 'recovered');

CREATE TABLE "watch_route_alert_run" (
  "id" text NOT NULL,
  "idempotency_key" char(64) NOT NULL,
  "property_id" varchar(191) NOT NULL,
  "origin" varchar(255) NOT NULL,
  "contract_version" varchar(64) NOT NULL,
  "mode" "WatchRouteAlertAutomationMode" NOT NULL,
  "status" "WatchRouteAlertRunStatus" NOT NULL DEFAULT 'running',
  "window_start" timestamp(3) NOT NULL,
  "window_end" timestamp(3) NOT NULL,
  "manifest_version" varchar(191),
  "report" jsonb NOT NULL DEFAULT '{}',
  "actionable_count" integer NOT NULL DEFAULT 0,
  "noise_count" integer NOT NULL DEFAULT 0,
  "execution_fence_generation" integer NOT NULL DEFAULT 0,
  "execution_claim_token_hash" char(64),
  "execution_claim_expires_at" timestamp(3),
  "started_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" timestamp(3),
  "detail_expires_at" timestamp(3) NOT NULL,
  "detail_expired_at" timestamp(3),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL,
  CONSTRAINT "watch_route_alert_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watch_route_alert_property_progress" (
  "property_id" varchar(191) NOT NULL,
  "last_complete_window_start" timestamp(3) NOT NULL,
  "last_complete_window_end" timestamp(3) NOT NULL,
  "last_complete_run_id" text NOT NULL,
  "updated_at" timestamp(3) NOT NULL,
  CONSTRAINT "watch_route_alert_property_progress_pkey" PRIMARY KEY ("property_id")
);

CREATE TABLE "watch_route_alert" (
  "id" text NOT NULL,
  "semantic_key" char(64) NOT NULL,
  "property_id" varchar(191) NOT NULL,
  "origin" varchar(255) NOT NULL,
  "normalized_path" varchar(1000) NOT NULL,
  "lifecycle" "WatchRouteAlertLifecycle" NOT NULL DEFAULT 'open',
  "verdict" "WatchRouteAlertVerdict" NOT NULL,
  "severity" "WatchRouteAlertSeverity" NOT NULL,
  "latest_count" integer NOT NULL DEFAULT 0,
  "count_kind" "WatchRouteAlertCountKind" NOT NULL,
  "active_users" integer NOT NULL DEFAULT 0,
  "occurrence_count" integer NOT NULL DEFAULT 0,
  "first_seen_at" timestamp(3) NOT NULL,
  "last_seen_at" timestamp(3) NOT NULL,
  "last_probed_at" timestamp(3),
  "last_http_status" integer,
  "last_probe_kind" varchar(32),
  "manifest_version" varchar(191) NOT NULL,
  "latest_evidence" jsonb NOT NULL DEFAULT '{}',
  "latest_run_id" text NOT NULL,
  "recovered_at" timestamp(3),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL,
  CONSTRAINT "watch_route_alert_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watch_route_alert_episode" (
  "id" text NOT NULL,
  "alert_id" text NOT NULL,
  "sequence" integer NOT NULL,
  "opened_at" timestamp(3) NOT NULL,
  "last_seen_at" timestamp(3) NOT NULL,
  "recovered_at" timestamp(3),
  "opened_by_run_id" text NOT NULL,
  "recovered_by_run_id" text,
  "evidence" jsonb NOT NULL DEFAULT '{}',
  "detail_expires_at" timestamp(3),
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL,
  CONSTRAINT "watch_route_alert_episode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watch_route_alert_daily_observation" (
  "id" text NOT NULL,
  "run_id" text NOT NULL,
  "alert_id" text NOT NULL,
  "observed_on" date NOT NULL,
  "count" integer NOT NULL,
  "count_kind" "WatchRouteAlertCountKind" NOT NULL,
  "active_users" integer NOT NULL,
  "verdict" "WatchRouteAlertVerdict" NOT NULL,
  "severity" "WatchRouteAlertSeverity" NOT NULL,
  "evidence" jsonb NOT NULL DEFAULT '{}',
  "observed_at" timestamp(3) NOT NULL,
  "expires_at" timestamp(3) NOT NULL,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "watch_route_alert_daily_observation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "watch_route_alert_run_idempotency_key_key"
  ON "watch_route_alert_run"("idempotency_key");
CREATE INDEX "watch_route_alert_run_property_id_started_at_idx"
  ON "watch_route_alert_run"("property_id", "started_at");
CREATE INDEX "watch_route_alert_run_status_execution_claim_expires_at_idx"
  ON "watch_route_alert_run"("status", "execution_claim_expires_at");
CREATE INDEX "watch_route_alert_run_detail_expires_at_detail_expired_at_idx"
  ON "watch_route_alert_run"("detail_expires_at", "detail_expired_at");

CREATE INDEX "watch_route_alert_property_progress_last_complete_window_end_idx"
  ON "watch_route_alert_property_progress"("last_complete_window_end");

CREATE UNIQUE INDEX "watch_route_alert_semantic_key_key"
  ON "watch_route_alert"("semantic_key");
CREATE UNIQUE INDEX "watch_route_alert_property_id_normalized_path_key"
  ON "watch_route_alert"("property_id", "normalized_path");
CREATE INDEX "watch_route_alert_property_id_lifecycle_severity_last_seen_at_id_idx"
  ON "watch_route_alert"("property_id", "lifecycle", "severity", "last_seen_at", "id");
CREATE INDEX "watch_route_alert_lifecycle_severity_latest_count_last_seen_at_id_idx"
  ON "watch_route_alert"("lifecycle", "severity", "latest_count" DESC, "last_seen_at" DESC, "id");
CREATE INDEX "watch_route_alert_property_id_lifecycle_last_probed_at_id_idx"
  ON "watch_route_alert"("property_id", "lifecycle", "last_probed_at", "id");

CREATE UNIQUE INDEX "watch_route_alert_episode_alert_id_sequence_key"
  ON "watch_route_alert_episode"("alert_id", "sequence");
CREATE UNIQUE INDEX "watch_route_alert_episode_one_open_per_alert_key"
  ON "watch_route_alert_episode"("alert_id") WHERE "recovered_at" IS NULL;
CREATE INDEX "watch_route_alert_episode_alert_id_recovered_at_idx"
  ON "watch_route_alert_episode"("alert_id", "recovered_at");
CREATE INDEX "watch_route_alert_episode_detail_expires_at_idx"
  ON "watch_route_alert_episode"("detail_expires_at");

CREATE UNIQUE INDEX "watch_route_alert_daily_observation_run_id_alert_id_key"
  ON "watch_route_alert_daily_observation"("run_id", "alert_id");
CREATE INDEX "watch_route_alert_daily_observation_alert_id_observed_on_idx"
  ON "watch_route_alert_daily_observation"("alert_id", "observed_on");
CREATE INDEX "watch_route_alert_daily_observation_expires_at_id_idx"
  ON "watch_route_alert_daily_observation"("expires_at", "id");

ALTER TABLE "watch_route_alert_episode"
  ADD CONSTRAINT "watch_route_alert_episode_alert_id_fkey"
  FOREIGN KEY ("alert_id") REFERENCES "watch_route_alert"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watch_route_alert_daily_observation"
  ADD CONSTRAINT "watch_route_alert_daily_observation_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "watch_route_alert_run"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watch_route_alert_daily_observation"
  ADD CONSTRAINT "watch_route_alert_daily_observation_alert_id_fkey"
  FOREIGN KEY ("alert_id") REFERENCES "watch_route_alert"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
