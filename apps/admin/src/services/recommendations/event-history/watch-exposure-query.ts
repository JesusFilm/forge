// Fixed server-side report. Revision acceptance precedes latest selection;
// original expiry and terminal erasure apply to the selected revision.
export const WATCH_EXPOSURE_BREAKDOWN_SQL = `WITH
canonical AS (
  SELECT logical_id,
    argMax(tuple(occurred_at, expires_at, payload), revision) AS selected_revision
  FROM recommendation_event_history
  WHERE family = 'watch-exposure' AND accepted_at <= {as_of:String}
  GROUP BY logical_id
), current_facts AS (
  SELECT logical_id,
    tupleElement(selected_revision, 1) AS occurred_at,
    JSONExtractString(tupleElement(selected_revision, 3), 'receivedAt') AS received_at,
    JSONExtractString(tupleElement(selected_revision, 3), 'rankId') AS rank_id,
    JSONExtractString(tupleElement(selected_revision, 3), 'windowId') AS window_id,
    JSONExtractString(tupleElement(selected_revision, 3), 'surface') AS surface,
    JSONExtractString(tupleElement(selected_revision, 3), 'block') AS block,
    JSONExtractString(tupleElement(selected_revision, 3), 'presentation') AS presentation,
    JSONExtractString(tupleElement(selected_revision, 3), 'placement') AS placement,
    JSONExtractString(tupleElement(selected_revision, 3), 'policyVersion') AS policy_version,
    JSONExtractInt(tupleElement(selected_revision, 3), 'position') AS position,
    JSONExtractString(tupleElement(selected_revision, 3), 'itemPath') AS item_path,
    JSONExtractString(tupleElement(selected_revision, 3), 'kind') AS kind,
    JSONExtractString(tupleElement(selected_revision, 3), 'visibilityCapability') AS visibility_capability,
    JSONExtractInt(tupleElement(selected_revision, 3), 'duplicateCount') AS duplicate_count
  FROM canonical
  WHERE tupleElement(selected_revision, 2) > {now:String}
    AND logical_id NOT IN (
      SELECT logical_id FROM recommendation_event_erasure
      WHERE family = 'watch-exposure'
    )
), ranked AS (
  SELECT fact.*,
    row_number() OVER (
      PARTITION BY window_id, surface, block, presentation, placement,
        policy_version, position, item_path, kind
      ORDER BY occurred_at, received_at, rank_id
    ) AS ordinal
  FROM current_facts fact
  WHERE occurred_at < {end:String} AND received_at < {end:String}
    AND ({filter:UInt8} = 0 OR
      (surface = {surface:String} AND block = {block:String}
       AND presentation = {presentation:String}
       AND ({has_placement:UInt8} = 0 OR placement = {placement:String})
       AND ({has_policy:UInt8} = 0 OR policy_version = {policy:String})))
), qualified AS (
  SELECT *,
    minIf(occurred_at, kind = 'eligible' AND ordinal = 1
      AND occurred_at >= {start:String}) OVER (
        PARTITION BY window_id, surface, block, presentation, placement,
          policy_version, position, item_path
      ) AS first_eligible_at
  FROM ranked
), facts AS (
  SELECT * FROM qualified WHERE occurred_at >= {start:String}
)
SELECT surface, block, presentation, placement, policy_version, position,
  toUInt32(countIf(kind = 'served' AND ordinal = 1)) AS served,
  toUInt32(countIf(kind = 'rendered' AND ordinal = 1)) AS rendered,
  toUInt32(countIf(kind = 'eligible' AND ordinal = 1)) AS eligible,
  toUInt32(countIf(kind = 'selected' AND ordinal = 1)) AS selected,
  toUInt32(countIf(kind = 'selected' AND ordinal = 1
    AND first_eligible_at != '' AND first_eligible_at <= occurred_at)) AS eligible_selected,
  toUInt32(countIf(kind != 'served' AND ordinal > 1)) AS repeats,
  toUInt32(countIf(kind != 'served')) AS accepted_attempts,
  toUInt64(sumIf(duplicate_count, kind != 'served')) AS duplicates,
  toUInt32(countIf(kind = 'eligible' AND ordinal = 1
    AND visibility_capability = 'occlusion-aware')) AS occlusion_aware,
  toUInt32(countIf(kind = 'eligible' AND ordinal = 1
    AND visibility_capability = 'unknown')) AS visibility_unknown
FROM facts
GROUP BY surface, block, presentation, placement, policy_version, position
ORDER BY surface, block, presentation, placement, position, policy_version
LIMIT 129
FORMAT JSONEachRow`

// Audit before the registry filter and result cap: an arbitrary physical
// variant must never decide whether its own same-revision conflict is visible.
export const WATCH_EXPOSURE_CONFLICT_SQL = `SELECT toUInt32(countIf(conflicts > 0)) AS conflicts
FROM (
  SELECT logical_id, sum(variants > 1) AS conflicts,
    max(max_expiry) AS latest_possible_expiry,
    min(min_occurred) AS earliest_occurred
  FROM (
    SELECT logical_id, revision,
      uniqExact(tuple(occurred_at, accepted_at, expires_at, payload_digest, payload)) AS variants,
      max(expires_at) AS max_expiry, min(occurred_at) AS min_occurred
    FROM recommendation_event_history
    WHERE family = 'watch-exposure' AND accepted_at <= {as_of:String}
      AND logical_id NOT IN (
        SELECT logical_id FROM recommendation_event_erasure
        WHERE family = 'watch-exposure'
      )
    GROUP BY logical_id, revision
  )
  GROUP BY logical_id
  HAVING latest_possible_expiry > {now:String}
    AND earliest_occurred < {end:String}
)
FORMAT JSONEachRow`
