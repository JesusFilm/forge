-- Apply in a dedicated ClickHouse database. Do not use ReplacingMergeTree:
-- equal-revision conflicting payloads must survive physical background merges.
-- Keep every revision of a logical ID in one unpartitioned key space so a
-- correction cannot revive an older version across partitions.
-- accepted_at is the admission time of this immutable revision. Historical
-- reads select only revisions admitted by their requested as-of cutoff.
-- Do not add a per-row expiry TTL: deleting a short-lived latest revision
-- while an older long-lived revision remains would resurrect the older row.
-- The bounded closed-ID sweep installs a read fence, then rewrites affected
-- active parts only after certified source and stored variants have reached
-- original expiry. Source closure and marker retirement remain external gates.
CREATE TABLE IF NOT EXISTS recommendation_event_history
(
    family LowCardinality(String),
    logical_id String,
    revision UInt32,
    occurred_at String,
    accepted_at String,
    expires_at String,
    payload_digest FixedString(64),
    payload String
)
ENGINE = MergeTree
ORDER BY (family, logical_id, revision);

-- Terminal logical suppression is inserted before physical deletion. A later
-- in-flight insert cannot make erased history readable. Feat-895 owns the
-- generation fence and reconciliation until all late writes are cleaned up.
CREATE TABLE IF NOT EXISTS recommendation_event_erasure
(
    family LowCardinality(String),
    logical_id String
)
ENGINE = MergeTree
ORDER BY (family, logical_id);
