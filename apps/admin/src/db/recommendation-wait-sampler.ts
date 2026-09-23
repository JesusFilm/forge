import { setTimeout as delay } from "node:timers/promises"
import { Client } from "pg"

const ACTIVITY_SQL = `
  WITH tagged AS MATERIALIZED (
    SELECT pid, application_name, state, wait_event_type, wait_event,
      query_start, state_change, query
    FROM pg_stat_activity
    WHERE datname = current_database() AND pid <> pg_backend_pid()
      AND application_name ~ '^watch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[1-8]$'
    ORDER BY pid LIMIT 33
  )
  SELECT clock_timestamp() AS "sampledAt", pid AS "backendPid",
    split_part(application_name, ':', 2) AS "observationId",
    split_part(application_name, ':', 3)::integer AS "transactionOrdinal",
    state, wait_event_type AS "waitType", wait_event AS "waitEvent",
    query_start AS "queryStartedAt", state_change AS "stateChangedAt",
    (extract(epoch FROM (clock_timestamp() - query_start)) * 1000)::float8 AS "queryAgeMs",
    cardinality(pg_blocking_pids(pid)) AS "blockerCount",
    CASE
      WHEN query IS NULL OR query = '<insufficient privilege>' THEN 'unavailable'
      WHEN query ILIKE '%INSERT INTO%recommendation_candidate_stage_evidence%' THEN 'candidate_evidence.insert'
      WHEN query = 'COMMIT' THEN 'commit'
      WHEN query = 'ROLLBACK' THEN 'rollback'
      ELSE 'other'
    END AS "statementCategory"
  FROM tagged
`

export type RecommendationWaitSample = {
  sampledAt: Date
  backendPid: number
  observationId: string
  transactionOrdinal: number
  state: string | null
  waitType: string | null
  waitEvent: string | null
  queryStartedAt: Date | null
  stateChangedAt: Date | null
  queryAgeMs: number | null
  blockerCount: number
  statementCategory:
    | "candidate_evidence.insert"
    | "commit"
    | "rollback"
    | "other"
    | "unavailable"
}

type Options = {
  connectionString: string
  durationMs?: number
  intervalMs?: number
  signal?: AbortSignal
  log?: (line: string) => void
}

function bounded(value: number, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError("Database observation option is outside its bounds")
  return value
}

/** Run in an independent process so Admin event-loop pauses cannot hide waits. */
export async function sampleRecommendationWaits(options: Options) {
  const durationMs = bounded(options.durationMs ?? 120_000, 1_000, 900_000)
  const intervalMs = bounded(options.intervalMs ?? 250, 100, 5_000)
  const overheadBudgetMs = Math.min(15_000, durationMs * 0.025)
  const log = options.log ?? ((line: string) => console.info(line))
  const client = new Client({
    connectionString: options.connectionString,
    application_name: "watch-wait-observer",
    connectionTimeoutMillis: 3_000,
    query_timeout: 1_000,
  })
  const started = performance.now()
  const summary = {
    event: "recommendation.database_wait_summary",
    startedAt: new Date().toISOString(),
    endedAt: "",
    polls: 0,
    samples: 0,
    queryWallMs: 0,
    maxQueryWallMs: 0,
    durationMs,
    intervalMs,
    stopped: "duration",
    errorCode: undefined as string | undefined,
  }
  const recordError = (error: unknown) => {
    summary.stopped = options.signal?.aborted ? "aborted" : "error"
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z0-9_]{1,32}$/.test(error.code)
    )
      summary.errorCode = error.code
  }
  client.on("error", recordError)
  try {
    await client.connect()
    // These belong only to this disposable observer connection. No ALTER,
    // persistent setting, mutation, transaction snapshot or application pool.
    await client.query("SET default_transaction_read_only = on")
    await client.query("SET statement_timeout = '750ms'")
    await client.query("SET lock_timeout = '50ms'")
    log(
      JSON.stringify({
        event: "recommendation.database_wait_ready",
        startedAt: summary.startedAt,
        durationMs,
        intervalMs,
      }),
    )
    while (performance.now() - started < durationMs) {
      if (summary.stopped === "error") break
      if (options.signal?.aborted) {
        summary.stopped = "aborted"
        break
      }
      const queryStarted = performance.now()
      const result = await client.query<RecommendationWaitSample>(ACTIVITY_SQL)
      const queryWallMs = performance.now() - queryStarted
      summary.polls++
      summary.queryWallMs += queryWallMs
      summary.maxQueryWallMs = Math.max(summary.maxQueryWallMs, queryWallMs)
      for (const sample of result.rows.slice(
        0,
        Math.min(32, 5_000 - summary.samples),
      )) {
        log(
          JSON.stringify({ event: "recommendation.database_wait", ...sample }),
        )
        summary.samples++
      }
      if (result.rows.length > 32) summary.stopped = "backend_limit"
      else if (summary.samples >= 5_000) summary.stopped = "output_limit"
      else if (queryWallMs > 100 || summary.queryWallMs > overheadBudgetMs)
        summary.stopped = "overhead"
      if (summary.stopped !== "duration") break
      await delay(
        Math.min(
          intervalMs,
          Math.max(0, durationMs - (performance.now() - started)),
        ),
        undefined,
        { signal: options.signal },
      )
    }
  } catch (error) {
    recordError(error)
  } finally {
    await client.end()
    summary.endedAt = new Date().toISOString()
  }
  log(JSON.stringify(summary))
  return summary
}
