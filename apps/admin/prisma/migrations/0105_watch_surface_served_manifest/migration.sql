-- Constraint replacement and index creation are atomic. Fail promptly under
-- contention or a slow validation/index scan; rollback leaves the old CHECK intact.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "watch_surface_exposure"
  DROP CONSTRAINT "watch_surface_exposure_kind_check";
ALTER TABLE "watch_surface_exposure"
  ADD CONSTRAINT "watch_surface_exposure_kind_check"
  CHECK ("kind" IN ('rendered', 'eligible', 'selected') OR
         ("kind" = 'served' AND "policy_version" = 'watch-exposure-v2' AND "visibility_capability" IS NULL));
CREATE UNIQUE INDEX "watch_surface_exposure_served_item_key"
  ON "watch_surface_exposure" ("window_id", "position", "item_path") WHERE "kind" = 'served';
COMMENT ON TABLE "watch_surface_exposure" IS
  'Anonymous public Watch card evidence. V2 served rows are issued by authenticated origin from verified immutable source manifests; client facts bind to issued cards. Random delivery identity, public target paths, 29-day retention, no viewer/session linkage.';
COMMIT;
