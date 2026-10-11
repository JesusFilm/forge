import { SpanType } from "@mastra/core/observability"
import { TraceStatus } from "@mastra/core/storage"
import type { DuckDBStore } from "@mastra/duckdb"
import type { Pool } from "pg"

/** Admin owns durable source progress; these are disposable Mastra run records. */
export const PRECOMPUTED_WORKFLOW_NAMES = [
  "precomputed-catalog-generation",
  "precomputed-source-generation",
] as const

export const PRECOMPUTED_RUNTIME_RETENTION_DAYS = 29
const TERMINAL_STATUSES = [
  "success",
  "failed",
  "canceled",
  "tripwire",
  "bailed",
  "skipped",
] as const

function snapshotTable(schema: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid Mastra storage schema")
  return `"${schema}"."mastra_workflow_snapshot"`
}

export async function measurePrecomputedRuntimeSnapshots(input: {
  pool: Pool
  schema?: string
  now?: Date
}): Promise<{
  featureRunCount: number
  featureSnapshotBytes: number
  nonterminalRunCount: number
  staleNonterminalRunCount: number
  sharedRelationHeapBytes: number
  sharedRelationIndexBytes: number
  sharedRelationTotalBytes: number
}> {
  const table = snapshotTable(input.schema ?? "mastra")
  const rows = await input.pool.query<{
    run_count: string
    snapshot_bytes: string
    nonterminal_count: string
    stale_nonterminal_count: string
    heap_bytes: string
    index_bytes: string
    total_bytes: string
  }>(
    `SELECT count(*)::text AS run_count,
            COALESCE(sum(pg_column_size(snapshot)), 0)::text AS snapshot_bytes,
            count(*) FILTER (WHERE COALESCE(snapshot::jsonb->>'status', '')
              <> ALL($2::text[]))::text AS nonterminal_count,
            count(*) FILTER (WHERE COALESCE(snapshot::jsonb->>'status', '')
              <> ALL($2::text[]) AND "updatedAtZ" < $4)::text AS stale_nonterminal_count,
            pg_relation_size($3::regclass)::text AS heap_bytes,
            pg_indexes_size($3::regclass)::text AS index_bytes,
            pg_total_relation_size($3::regclass)::text AS total_bytes
     FROM ${table} WHERE workflow_name = ANY($1::text[])`,
    [
      PRECOMPUTED_WORKFLOW_NAMES,
      TERMINAL_STATUSES,
      table,
      new Date(
        (input.now ?? new Date()).getTime() -
          PRECOMPUTED_RUNTIME_RETENTION_DAYS * 86_400_000,
      ),
    ],
  )
  const row = rows.rows[0]
  return {
    featureRunCount: Number(row.run_count),
    featureSnapshotBytes: Number(row.snapshot_bytes),
    nonterminalRunCount: Number(row.nonterminal_count),
    staleNonterminalRunCount: Number(row.stale_nonterminal_count),
    sharedRelationHeapBytes: Number(row.heap_bytes),
    sharedRelationIndexBytes: Number(row.index_bytes),
    sharedRelationTotalBytes: Number(row.total_bytes),
  }
}

type TraceStore = Pick<
  DuckDBStore["observability"],
  "listTraces" | "batchDeleteTraces"
>

type RuntimeIdentity = {
  workflowName: string
  generationId: string
  inputCutoff: string
  historyRequired: boolean
}

function hasRetirementProof(
  proof: unknown,
  identity: RuntimeIdentity,
): boolean {
  if (!Number.isFinite(Date.parse(identity.inputCutoff))) return false
  const expectedMode = identity.historyRequired
    ? "historical_analytics"
    : "content_only"
  return (
    typeof proof === "object" &&
    proof !== null &&
    "protocolVersion" in proof &&
    proof.protocolVersion === 2 &&
    "generationId" in proof &&
    proof.generationId === identity.generationId &&
    "generationProtocolVersion" in proof &&
    (identity.workflowName === "precomputed-catalog-generation"
      ? proof.generationProtocolVersion === 2 ||
        (proof.generationProtocolVersion === 3 && identity.historyRequired)
      : identity.workflowName === "precomputed-source-generation" &&
        [1, 2].includes(proof.generationProtocolVersion as number)) &&
    "inputCutoff" in proof &&
    proof.inputCutoff === new Date(identity.inputCutoff).toISOString() &&
    "inputMode" in proof &&
    proof.inputMode === expectedMode &&
    "inputDigest" in proof &&
    typeof proof.inputDigest === "string" &&
    /^[0-9a-f]{64}$/.test(proof.inputDigest) &&
    "sourceWorkResumable" in proof &&
    proof.sourceWorkResumable === false &&
    "state" in proof &&
    ["complete", "failed", "cancelled", "retiring", "retired"].includes(
      proof.state as string,
    )
  )
}

/** Counts are feature-specific; DuckDB's allocated file size is shared. */
export async function measurePrecomputedRuntimeTraces(input: {
  observability: TraceStore
  now?: Date
}): Promise<{
  featureTraceCount: number
  runningTraceCount: number
  staleRunningTraceCount: number
}> {
  let featureTraceCount = 0
  let runningTraceCount = 0
  let staleRunningTraceCount = 0
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() -
      PRECOMPUTED_RUNTIME_RETENTION_DAYS * 86_400_000,
  )
  for (const workflowId of PRECOMPUTED_WORKFLOW_NAMES) {
    const base = {
      entityId: workflowId,
      spanType: SpanType.WORKFLOW_RUN,
    }
    const [all, running, staleRunning] = await Promise.all([
      input.observability.listTraces({
        filters: base,
        pagination: { page: 0, perPage: 1 },
      }),
      input.observability.listTraces({
        filters: { ...base, status: TraceStatus.RUNNING },
        pagination: { page: 0, perPage: 1 },
      }),
      input.observability.listTraces({
        filters: {
          ...base,
          status: TraceStatus.RUNNING,
          startedAt: { end: cutoff, endExclusive: true },
        },
        pagination: { page: 0, perPage: 1 },
      }),
    ])
    featureTraceCount += all.pagination?.total ?? all.spans.length
    runningTraceCount += running.pagination?.total ?? running.spans.length
    staleRunningTraceCount +=
      staleRunning.pagination?.total ?? staleRunning.spans.length
  }
  return { featureTraceCount, runningTraceCount, staleRunningTraceCount }
}

/** DuckDB stores all workflow traces together; only ended feature roots qualify. */
export async function prunePrecomputedRuntimeTraces(input: {
  observability: TraceStore
  now?: Date
  maxTraces?: number
}): Promise<{ deletedTraces: number; hasMoreEligible: boolean }> {
  const maxTraces = input.maxTraces ?? 50
  if (!Number.isInteger(maxTraces) || maxTraces < 1 || maxTraces > 100)
    throw new Error("Invalid precomputed trace cleanup batch size")
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() -
      PRECOMPUTED_RUNTIME_RETENTION_DAYS * 86_400_000,
  )

  async function findEligible(limit: number): Promise<string[]> {
    const ids: string[] = []
    for (const workflowId of PRECOMPUTED_WORKFLOW_NAMES) {
      const response = await input.observability.listTraces({
        filters: {
          entityId: workflowId,
          endedAt: { end: cutoff, endExclusive: true },
        },
        pagination: { page: 0, perPage: limit },
        orderBy: { field: "endedAt", direction: "ASC" },
      })
      for (const span of response.spans) {
        if (
          span.entityId === workflowId &&
          span.spanType === SpanType.WORKFLOW_RUN &&
          span.endedAt &&
          span.endedAt < cutoff &&
          span.status !== TraceStatus.RUNNING
        )
          ids.push(span.traceId)
        if (ids.length >= limit) return ids
      }
    }
    return ids
  }

  const ids = await findEligible(maxTraces)
  if (ids.length) await input.observability.batchDeleteTraces({ traceIds: ids })
  return {
    deletedTraces: ids.length,
    hasMoreEligible: (await findEligible(1)).length > 0,
  }
}

/**
 * A crash can leave the root trace RUNNING forever. New private route launches
 * stamp minimal immutable identity in root metadata, independent of the PG
 * snapshot lifecycle. Legacy identity-less traces remain unresolved.
 */
export async function prunePrecomputedOrphanRunningTraces(input: {
  observability: TraceStore
  readProof: (identity: { generationId: string }) => Promise<unknown>
  now?: Date
  maxTraces?: number
  page?: number
}): Promise<{
  deletedTraces: number
  unresolvedTraces: number
  examinedTraces: number
  nextPage: number
}> {
  const maxTraces = input.maxTraces ?? 50
  const page = input.page ?? 0
  if (!Number.isInteger(maxTraces) || maxTraces < 1 || maxTraces > 100)
    throw new Error("Invalid precomputed trace cleanup batch size")
  if (!Number.isInteger(page) || page < 0)
    throw new Error("Invalid trace cleanup page")
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() -
      PRECOMPUTED_RUNTIME_RETENTION_DAYS * 86_400_000,
  )
  let deletedTraces = 0
  let unresolvedTraces = 0
  let examinedTraces = 0
  let hasMore = false
  for (const workflowName of PRECOMPUTED_WORKFLOW_NAMES) {
    const response = await input.observability.listTraces({
      filters: {
        entityId: workflowName,
        spanType: SpanType.WORKFLOW_RUN,
        status: TraceStatus.RUNNING,
        startedAt: { end: cutoff, endExclusive: true },
      },
      pagination: { page, perPage: maxTraces },
      orderBy: { field: "startedAt", direction: "ASC" },
    })
    hasMore ||= response.pagination?.hasMore ?? false
    for (const span of response.spans) {
      examinedTraces++
      const metadata = span.metadata
      const generationId = metadata?.precomputedGenerationId
      const inputCutoff = metadata?.precomputedInputCutoff
      const historyRequired = metadata?.precomputedHistoryRequired
      if (
        span.entityId !== workflowName ||
        span.spanType !== SpanType.WORKFLOW_RUN ||
        span.status !== TraceStatus.RUNNING ||
        span.startedAt >= cutoff ||
        typeof generationId !== "string" ||
        typeof inputCutoff !== "string" ||
        typeof historyRequired !== "boolean"
      ) {
        unresolvedTraces++
        continue
      }
      let proof: unknown
      try {
        proof = await input.readProof({ generationId })
      } catch {
        unresolvedTraces++
        continue
      }
      if (
        !hasRetirementProof(proof, {
          workflowName,
          generationId,
          inputCutoff,
          historyRequired,
        })
      ) {
        unresolvedTraces++
        continue
      }
      await input.observability.batchDeleteTraces({ traceIds: [span.traceId] })
      deletedTraces++
    }
  }
  return {
    deletedTraces,
    unresolvedTraces,
    examinedTraces,
    nextPage: hasMore ? page + 1 : 0,
  }
}

/**
 * One bounded, atomic delete. Row locking means a concurrent Mastra snapshot
 * update either wins first (and is rechecked) or waits until this old terminal
 * row is gone. Running/suspended/waiting work is never eligible.
 */
export async function prunePrecomputedRuntimeSnapshots(input: {
  pool: Pool
  schema?: string
  now?: Date
  maxRows?: number
}): Promise<{
  deletedRuns: number
  logicalSnapshotBytesDeleted: number
  hasMoreEligible: boolean
}> {
  const table = snapshotTable(input.schema ?? "mastra")
  const now = input.now ?? new Date()
  const maxRows = input.maxRows ?? 50
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100)
    throw new Error("Invalid precomputed runtime cleanup batch size")
  const cutoff = new Date(
    now.getTime() - PRECOMPUTED_RUNTIME_RETENTION_DAYS * 86_400_000,
  )
  const values = [
    PRECOMPUTED_WORKFLOW_NAMES,
    TERMINAL_STATUSES,
    cutoff,
    maxRows,
  ]
  const deleted = await input.pool.query<{
    deleted_runs: string
    logical_bytes: string
  }>(
    `WITH candidates AS (
       SELECT workflow_name, run_id FROM ${table}
       WHERE workflow_name = ANY($1::text[])
         AND snapshot::jsonb->>'status' = ANY($2::text[])
         AND "updatedAtZ" < $3
       ORDER BY "updatedAtZ", run_id
       LIMIT $4 FOR UPDATE SKIP LOCKED
     ), deleted AS (
       DELETE FROM ${table} s USING candidates c
       WHERE s.workflow_name = c.workflow_name AND s.run_id = c.run_id
       RETURNING pg_column_size(s.snapshot) AS snapshot_bytes
     )
     SELECT count(*)::text AS deleted_runs,
            COALESCE(sum(snapshot_bytes), 0)::text AS logical_bytes FROM deleted`,
    values,
  )
  const remaining = await input.pool.query<{ has_more: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM ${table}
       WHERE workflow_name = ANY($1::text[])
         AND snapshot::jsonb->>'status' = ANY($2::text[])
         AND "updatedAtZ" < $3
       LIMIT 1
     ) AS has_more`,
    [PRECOMPUTED_WORKFLOW_NAMES, TERMINAL_STATUSES, cutoff],
  )
  return {
    deletedRuns: Number(deleted.rows[0].deleted_runs),
    logicalSnapshotBytesDeleted: Number(deleted.rows[0].logical_bytes),
    hasMoreEligible: remaining.rows[0].has_more,
  }
}

/**
 * Old nonterminal rows are not disposable merely because they are old: a
 * catalog step can be active for a long time. Admin's fenced generation state
 * is the authority. Any missing, invalid, or unavailable proof retains the row.
 */
export async function prunePrecomputedAbandonedRuntimeSnapshots(input: {
  pool: Pool
  readProof: (identity: { generationId: string }) => Promise<unknown>
  schema?: string
  now?: Date
  maxRows?: number
  after?: { updatedAt: Date; runId: string }
}): Promise<{
  deletedRuns: number
  unresolvedRuns: number
  examinedRuns: number
  hasMoreCandidates: boolean
  nextCursor: { updatedAt: Date; runId: string } | null
}> {
  const table = snapshotTable(input.schema ?? "mastra")
  const maxRows = input.maxRows ?? 50
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 100)
    throw new Error("Invalid precomputed runtime cleanup batch size")
  const cutoff = new Date(
    (input.now ?? new Date()).getTime() -
      PRECOMPUTED_RUNTIME_RETENTION_DAYS * 86_400_000,
  )
  const candidates = await input.pool.query<{
    workflow_name: string
    run_id: string
    updated_at: Date
    generation_id: string | null
    input_cutoff: string | null
    history_required: string | null
    status: string | null
  }>(
    `SELECT workflow_name, run_id, "updatedAtZ" AS updated_at,
            snapshot::jsonb #>> '{context,input,generationId}' AS generation_id,
            snapshot::jsonb #>> '{context,input,inputCutoff}' AS input_cutoff,
            snapshot::jsonb #>> '{context,input,historyRequired}' AS history_required,
            snapshot::jsonb->>'status' AS status
     FROM ${table}
     WHERE workflow_name = ANY($1::text[])
       AND COALESCE(snapshot::jsonb->>'status', '') <> ALL($2::text[])
       AND "updatedAtZ" < $3
       AND ($5::timestamptz IS NULL OR ("updatedAtZ", run_id) > ($5::timestamptz, $6::text))
     ORDER BY "updatedAtZ", run_id
     LIMIT $4`,
    [
      PRECOMPUTED_WORKFLOW_NAMES,
      TERMINAL_STATUSES,
      cutoff,
      maxRows,
      input.after?.updatedAt ?? null,
      input.after?.runId ?? null,
    ],
  )
  let deletedRuns = 0
  let unresolvedRuns = 0
  for (const row of candidates.rows) {
    const generationId = row.generation_id
    const inputCutoff = row.input_cutoff
    const historyRequired = row.history_required
    if (
      !generationId ||
      !inputCutoff ||
      !Number.isFinite(Date.parse(inputCutoff)) ||
      !["true", "false"].includes(historyRequired ?? "")
    ) {
      unresolvedRuns++
      continue
    }
    let proof: unknown
    try {
      proof = await input.readProof({ generationId })
    } catch {
      unresolvedRuns++
      continue
    }
    if (
      !hasRetirementProof(proof, {
        workflowName: row.workflow_name,
        generationId,
        inputCutoff,
        historyRequired: historyRequired === "true",
      })
    ) {
      unresolvedRuns++
      continue
    }
    const deleted = await input.pool.query(
      `WITH locked AS (
         SELECT workflow_name, run_id FROM ${table}
         WHERE workflow_name = $1 AND run_id = $2 AND "updatedAtZ" = $3
           AND snapshot::jsonb->>'status' = $4
           AND snapshot::jsonb #>> '{context,input,generationId}' = $5
           AND snapshot::jsonb #>> '{context,input,inputCutoff}' = $6
           AND snapshot::jsonb #>> '{context,input,historyRequired}' = $7
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM ${table} s USING locked l
       WHERE s.workflow_name = l.workflow_name AND s.run_id = l.run_id`,
      [
        row.workflow_name,
        row.run_id,
        row.updated_at,
        row.status,
        generationId,
        inputCutoff,
        historyRequired,
      ],
    )
    if (deleted.rowCount === 1) deletedRuns++
    else unresolvedRuns++
  }
  return {
    deletedRuns,
    unresolvedRuns,
    examinedRuns: candidates.rows.length,
    hasMoreCandidates: candidates.rows.length === maxRows,
    nextCursor:
      candidates.rows.length === maxRows
        ? {
            updatedAt: candidates.rows.at(-1)!.updated_at,
            runId: candidates.rows.at(-1)!.run_id,
          }
        : null,
  }
}
