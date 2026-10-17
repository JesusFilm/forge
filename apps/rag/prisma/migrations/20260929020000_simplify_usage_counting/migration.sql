-- Decouple new attempt accounting from the retired collector/coverage machinery.
-- Additive for rolling deploys: old instances can still insert collector IDs;
-- new instances omit them. Existing attempts, totals and timestamps are untouched.
ALTER TABLE usage_private.pending ALTER COLUMN collector_id DROP NOT NULL;
-- Historical collector/gap/inventory tables and views remain inert for audit and
-- rollback compatibility. Reporting and new serving code never read or write them.
