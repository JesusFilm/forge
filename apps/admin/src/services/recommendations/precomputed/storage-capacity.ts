import { Prisma, type PrismaClient } from "@prisma/client"

// This is an observation, not an admission decision. PostgreSQL relation
// sizes include every generation and dead space. pg_column_size(row) reports
// the stored row value (including compression effects); it cannot apportion
// physical TOAST, index, WAL, and page overhead by generation.
const TABLES = [
  "recommendation_precomputed_generation",
  "recommendation_precomputed_generation_retention_proof",
  "recommendation_precomputed_ga_capture_artifact",
  "recommendation_precomputed_source",
  "recommendation_precomputed_model_call",
  "recommendation_precomputed_execution_attempt",
  "recommendation_precomputed_history_call",
  "recommendation_precomputed_build_source",
  "recommendation_precomputed_build_choice",
  "recommendation_precomputed_build_budget",
  "recommendation_precomputed_experiment",
  "recommendation_precomputed_launch_capacity_receipt",
  "recommendation_precomputed_baseline_run",
  "recommendation_precomputed_baseline_visit",
  "recommendation_precomputed_baseline_visit_request",
  "recommendation_precomputed_visit",
  "recommendation_precomputed_visit_request",
  "recommendation_precomputed_ctr_policy",
  "recommendation_precomputed_ctr_archived_visit",
  "recommendation_precomputed_ctr_cluster",
  "recommendation_precomputed_ctr_totals",
  "recommendation_precomputed_ctr_report",
] as const

type RelationRow = {
  table: string
  heap_bytes: bigint
  index_bytes: bigint
  toast_bytes: bigint
  total_bytes: bigint
  row_estimate: bigint | null
}

const number = (value: bigint | number | null | undefined) => Number(value ?? 0)

export async function loadPrecomputedStorageCapacityReport(
  prisma: PrismaClient,
  input: { generationId?: string; now?: Date } = {},
) {
  const now = input.now ?? new Date()
  const relations = await prisma.$queryRaw<RelationRow[]>(Prisma.sql`
    SELECT names.table_name AS table,
           pg_relation_size(c.oid)::bigint AS heap_bytes,
           pg_indexes_size(c.oid)::bigint AS index_bytes,
           CASE WHEN c.reltoastrelid = 0 THEN 0::bigint
                ELSE pg_total_relation_size(c.reltoastrelid)::bigint END AS toast_bytes,
           pg_total_relation_size(c.oid)::bigint AS total_bytes,
           CASE WHEN c.reltuples < 0 THEN NULL::bigint
                ELSE c.reltuples::bigint END AS row_estimate
    FROM unnest(${TABLES}::text[]) AS names(table_name)
    JOIN pg_class c ON c.oid = to_regclass(names.table_name)
    ORDER BY names.table_name
  `)
  const normalized = relations.map((row) => {
    const heapBytes = number(row.heap_bytes)
    const indexBytes = number(row.index_bytes)
    const toastBytes = number(row.toast_bytes)
    const totalBytes = number(row.total_bytes)
    return {
      table: row.table,
      heapBytes,
      indexBytes,
      toastBytes,
      auxBytes: totalBytes - heapBytes - indexBytes - toastBytes,
      totalBytes,
      rowEstimate: row.row_estimate === null ? null : number(row.row_estimate),
    }
  })
  const [database] = await prisma.$queryRaw<
    Array<{ bytes: bigint; visit_count: bigint }>
  >`SELECT pg_database_size(current_database())::bigint AS bytes,
           (SELECT count(*) FROM recommendation_precomputed_visit)::bigint AS visit_count`
  const [captureObjects] = await prisma.$queryRaw<
    Array<{ objects: bigint; bytes: bigint; selected_bytes: bigint }>
  >`SELECT count(*)::bigint AS objects,
           COALESCE(sum(artifact_bytes), 0)::bigint AS bytes,
           COALESCE(sum(artifact_bytes) FILTER (
             WHERE generation_id = ${input.generationId ?? ""}
           ), 0)::bigint AS selected_bytes
     FROM recommendation_precomputed_ga_capture_artifact`
  // pg_stat_wal is a shared-cluster cumulative counter, not bytes caused by
  // this feature or by the selected generation.
  const [wal] = await prisma.$queryRaw<Array<{ bytes: bigint | null }>>`
    SELECT wal_bytes::bigint AS bytes FROM pg_stat_wal`
  const trafficRows = await prisma.$queryRaw<
    Array<{ day: Date; requests: bigint; expected_items: bigint }>
  >(Prisma.sql`
    SELECT date_trunc('day', created_at AT TIME ZONE 'UTC') AS day,
           count(*)::bigint AS requests,
           COALESCE(sum(expected_item_count), 0)::bigint AS expected_items
    FROM recommendation_request
    WHERE created_at >= ${new Date(now.getTime() - 7 * 86_400_000)}
      AND created_at < ${now}
      AND surface_version = 'watch-below-player-v1'
      AND purpose = 'seeded' AND state = 'issued'
    GROUP BY 1 ORDER BY 1
  `)
  const recordedRequests = trafficRows.reduce(
    (sum, row) => sum + number(row.requests),
    0,
  )
  const [overlap] = await prisma.$queryRaw<
    Array<{
      complete_count: bigint
      rollback_hold_count: bigint
      active_build_count: bigint
      retiring_count: bigint
      active_reserved_bytes: bigint
    }>
  >`
    SELECT
      count(*) FILTER (WHERE status = 'complete')::bigint AS complete_count,
      count(*) FILTER (WHERE rollback_retention_hold)::bigint AS rollback_hold_count,
      count(*) FILTER (WHERE status IN ('incomplete', 'capacity_blocked'))::bigint AS active_build_count,
      count(*) FILTER (WHERE status = 'retiring')::bigint AS retiring_count,
      COALESCE(sum(
        CASE WHEN
          (status = 'incomplete' AND capacity_preflight->>'status' = 'passed')
          OR (status = 'capacity_blocked' AND (capacity_preflight->>'heldProjectionBytes') ~ '^[1-9][0-9]*$')
        THEN GREATEST(
          CASE WHEN (capacity_preflight->>'heldProjectionBytes') ~ '^[0-9]+$'
            THEN (capacity_preflight->>'heldProjectionBytes')::bigint ELSE 0 END,
          CASE WHEN (capacity_preflight->>'projectedBytes') ~ '^[0-9]+$'
            THEN (capacity_preflight->>'projectedBytes')::bigint ELSE 0 END
        ) ELSE 0 END
      ), 0)::bigint AS active_reserved_bytes
    FROM recommendation_precomputed_generation`
  const [selected] = input.generationId
    ? await prisma.$queryRaw<
        Array<{
          generation_id: string
          status: string
          source_count: bigint
          accepted_connections: bigint
          inline_tuple_bytes: bigint
        }>
      >(Prisma.sql`
        SELECT g.id AS generation_id, g.status,
          (SELECT count(*) FROM recommendation_precomputed_source s
           WHERE s.generation_id = g.id)::bigint AS source_count,
          (SELECT COALESCE(sum(s.accepted_count), 0) FROM recommendation_precomputed_source s
           WHERE s.generation_id = g.id)::bigint AS accepted_connections,
          (pg_column_size(g)::bigint +
            (SELECT COALESCE(sum(pg_column_size(s)), 0) FROM recommendation_precomputed_source s
             WHERE s.generation_id = g.id)::bigint +
            (SELECT COALESCE(sum(pg_column_size(c)), 0) FROM recommendation_precomputed_model_call c
             WHERE c.generation_id = g.id)::bigint +
            (SELECT COALESCE(sum(pg_column_size(a)), 0) FROM recommendation_precomputed_execution_attempt a
             WHERE a.generation_id = g.id)::bigint +
            (SELECT COALESCE(sum(pg_column_size(c)), 0) FROM recommendation_precomputed_history_call c
             WHERE c.generation_id = g.id)::bigint +
            (SELECT COALESCE(sum(pg_column_size(s)), 0) FROM recommendation_precomputed_build_source s
             WHERE s.generation_id = g.id)::bigint +
            (SELECT COALESCE(sum(pg_column_size(c)), 0) FROM recommendation_precomputed_build_choice c
             WHERE c.generation_id = g.id)::bigint +
            (SELECT COALESCE(sum(pg_column_size(b)), 0) FROM recommendation_precomputed_build_budget b
             WHERE b.generation_id = g.id)::bigint
          ) AS inline_tuple_bytes
        FROM recommendation_precomputed_generation g WHERE g.id = ${input.generationId}
      `)
    : []
  const acceptedConnections = number(selected?.accepted_connections)
  const visitRelationBytes =
    normalized.find((row) => row.table === "recommendation_precomputed_visit")
      ?.totalBytes ?? 0
  const liveVisitCount = number(database?.visit_count)
  return {
    basis: "database_read_only_snapshot" as const,
    measuredAt: now.toISOString(),
    relations: normalized,
    databaseBytes: number(database?.bytes),
    privateGaCaptureObjects: {
      recordedObjectCount: number(captureObjects?.objects),
      recordedBytes: number(captureObjects?.bytes),
      selectedGenerationRecordedBytes: number(captureObjects?.selected_bytes),
      storageScope: "private_object_store_not_postgresql_pgdata" as const,
      qualification:
        "Upload receipts measure retained object bytes, not object-store physical overhead or PostgreSQL WAL.",
    },
    globalWal: {
      scope: "shared_cluster_cumulative" as const,
      bytes: wal?.bytes == null ? null : number(wal.bytes),
    },
    rawVisits: {
      count: liveVisitCount,
      retentionDays: 29,
      physicalRelationBytes: visitRelationBytes,
      sharedRelationBytesPerLiveRow:
        liveVisitCount > 0 ? visitRelationBytes / liveVisitCount : null,
      unitCostQualification:
        "shared_relation_divided_by_live_count_not_attributable_unit_cost" as const,
    },
    observedTraffic: {
      basis: "recorded_watch_requests_not_verified_human_visits" as const,
      lookbackDays: 7,
      recordedRequests,
      recordedRequestsPerDayAverage: recordedRequests / 7,
      largestObservedUtcCalendarDayRequests: Math.max(
        0,
        ...trafficRows.map((row) => number(row.requests)),
      ),
      expectedItems: trafficRows.reduce(
        (sum, row) => sum + number(row.expected_items),
        0,
      ),
      botFiltering: "unverified" as const,
      eligibleHumanVisitsPerDay: null,
      note: "First and last UTC calendar groups may be partial.",
    },
    retainedVolumeProjection: {
      status: "unqualified" as const,
      projectedBytes: null,
      recordedRequestEquivalent29DayAverage: (recordedRequests / 7) * 29,
      qualifiedEligibleVisitCount29Days: null,
      reason:
        "Verified human eligibility, real generation bytes, and archive mix are not yet measured.",
    },
    buildRollbackOverlap: {
      completeGenerations: number(overlap?.complete_count),
      newestTwoCompleteProtected: Math.min(2, number(overlap?.complete_count)),
      rollbackHolds: number(overlap?.rollback_hold_count),
      activeBuilds: number(overlap?.active_build_count),
      retiringGenerations: number(overlap?.retiring_count),
      activeReservationBytes: number(overlap?.active_reserved_bytes),
      measuredPhysicalOverlapBytes: null,
      qualification:
        "Held projections are reservations, not measured physical bytes; rollback holds may overlap the newest two.",
    },
    writeQueryImpact: {
      status: "not_measured_for_live_workload" as const,
      writeLatencyMs: null,
      readLatencyMs: null,
      featureWalBytes: null,
      localFixtureReceipt:
        "docs/validation/precomputed-storage-20261006/local-benchmark.json",
    },
    selectedGeneration: selected
      ? {
          generationId: selected.generation_id,
          status: selected.status,
          sourceCount: number(selected.source_count),
          acceptedConnections,
          inlineTupleBytes: number(selected.inline_tuple_bytes),
          inlineBytesPerConnection:
            acceptedConnections > 0
              ? number(selected.inline_tuple_bytes) / acceptedConnections
              : null,
          attribution: "row_value_estimate_not_physical_allocation" as const,
        }
      : null,
    readiness: {
      approved: false,
      missing: [
        "first_real_catalog_run",
        "verified_human_traffic_baseline",
        "mastra_feature_storage_measurement",
        "measured_retained_overlap_budget",
      ],
    },
  }
}
