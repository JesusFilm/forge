ALTER TABLE "recommendation_impression"
  ADD COLUMN "visibility_capability" varchar(32) NOT NULL DEFAULT 'unknown';

ALTER TABLE "recommendation_impression"
  ADD CONSTRAINT "recommendation_impression_visibility_capability_check"
  CHECK ("visibility_capability" IN ('unknown', 'occlusion-aware'));

COMMENT ON COLUMN "recommendation_impression"."visibility_capability" IS
  'Observer V2 occlusion-aware or V1 unknown; old facts backfill to unknown. Request-owned 29-day retention.';

CREATE TABLE "watch_surface_exposure" (
  "id" text PRIMARY KEY,
  "event_id" uuid NOT NULL UNIQUE,
  "window_id" uuid NOT NULL,
  "surface" varchar(40) NOT NULL,
  "block" varchar(40) NOT NULL,
  "presentation" varchar(40) NOT NULL,
  "placement" varchar(64) NOT NULL,
  "policy_version" varchar(40) NOT NULL,
  "position" integer NOT NULL,
  "item_path" varchar(512) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "visibility_capability" varchar(32),
  "duplicate_count" integer NOT NULL DEFAULT 0,
  "occurred_at" timestamp(3) NOT NULL,
  "received_at" timestamp(3) NOT NULL DEFAULT now(),
  "expires_at" timestamp(3) NOT NULL,
  CONSTRAINT "watch_surface_exposure_kind_check" CHECK ("kind" IN ('rendered', 'eligible', 'selected')),
  CONSTRAINT "watch_surface_exposure_capability_check" CHECK ("visibility_capability" IS NULL OR "visibility_capability" IN ('unknown', 'occlusion-aware')),
  CONSTRAINT "watch_surface_exposure_position_check" CHECK ("position" >= 0 AND "position" < 100)
);
CREATE INDEX "watch_surface_exposure_window_item_idx"
  ON "watch_surface_exposure" ("window_id", "surface", "block", "presentation", "placement", "position", "item_path", "kind");
CREATE INDEX "watch_surface_exposure_aggregate_idx"
  ON "watch_surface_exposure" ("surface", "block", "presentation", "position", "occurred_at");
CREATE INDEX "watch_surface_exposure_window_cohort_idx"
  ON "watch_surface_exposure" ("occurred_at", "window_id");
CREATE INDEX "watch_surface_exposure_expiry_idx"
  ON "watch_surface_exposure" ("expires_at");
COMMENT ON TABLE "watch_surface_exposure" IS
  'Anonymous public Watch card evidence. Random block-window identity, public target path, 29-day retention. No viewer or session linkage; deletion is by expiry.';
