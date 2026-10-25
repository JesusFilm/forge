import { performance } from "node:perf_hooks"

export type SearchTimingPipelineMode =
  | "hybrid"
  | "keyword-first"
  | "semantic-only"

export type SearchTimingStatus = "fulfilled" | "rejected" | "skipped"

export type SearchRetrieverTiming = {
  label: string
  status: SearchTimingStatus
  elapsedMs: number
  resultCount: number
}

export type SearchDbTiming = {
  label: string
  status: Exclude<SearchTimingStatus, "skipped">
  elapsedMs: number
  resultCount: number
}

export type SearchTimingSummary = {
  pipelineMode: SearchTimingPipelineMode
  totalMs: number
  embeddingMs: number
  retrievalsMs: number
  retrievalWaitMs: number
  fusionMs: number
  dilutionCapMs: number
  dedupeMs: number
  mappingMs: number
  hydrationMs: number
  retrievers: SearchRetrieverTiming[]
  db: SearchDbTiming[]
}

export type SearchTimingRouteSource = "rest" | "graphql" | "internal"

export class SearchTimingRecorder {
  private readonly dbTimings: SearchDbTiming[] = []

  recordDb(timing: SearchDbTiming): void {
    this.dbTimings.push(timing)
  }

  snapshotDbTimings(): SearchDbTiming[] {
    return this.dbTimings.map((timing) => ({ ...timing }))
  }
}

export function nowMs(): number {
  return performance.now()
}

export function boundedMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value * 10) / 10
}

export function elapsedMs(startedAt: number): number {
  return boundedMs(nowMs() - startedAt)
}

export type SearchTimingInterval = {
  startedAt: number
  endedAt: number
}

export function activeTimingIntervalsMs(
  intervals: readonly SearchTimingInterval[],
): number {
  if (intervals.length === 0) return 0

  const sorted = [...intervals].sort((a, b) => a.startedAt - b.startedAt)
  let activeMs = 0
  let currentStart = sorted[0]!.startedAt
  let currentEnd = sorted[0]!.endedAt

  for (let i = 1; i < sorted.length; i++) {
    const interval = sorted[i]!
    if (interval.startedAt <= currentEnd) {
      currentEnd = Math.max(currentEnd, interval.endedAt)
      continue
    }

    activeMs += Math.max(0, currentEnd - currentStart)
    currentStart = interval.startedAt
    currentEnd = interval.endedAt
  }

  activeMs += Math.max(0, currentEnd - currentStart)
  return boundedMs(activeMs)
}

function defaultResultCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

export async function recordSearchDbTiming<T>(
  recorder: SearchTimingRecorder | undefined,
  label: string,
  run: () => Promise<T>,
  resultCount: (value: T) => number = defaultResultCount,
): Promise<T> {
  if (recorder == null) return run()

  const startedAt = nowMs()
  try {
    const value = await run()
    recorder.recordDb({
      label,
      status: "fulfilled",
      elapsedMs: elapsedMs(startedAt),
      resultCount: Math.max(0, Math.round(resultCount(value))),
    })
    return value
  } catch (error) {
    recorder.recordDb({
      label,
      status: "rejected",
      elapsedMs: elapsedMs(startedAt),
      resultCount: 0,
    })
    throw error
  }
}

export function searchTimingLogValue(raw: unknown): string {
  const normalized = String(raw ?? "none")
    .replace(/[\r\n\t\s=]/g, "_")
    .slice(0, 64)
  return normalized.length > 0 ? normalized : "none"
}

function searchTimingLogKey(raw: string): string {
  const key = searchTimingLogValue(raw)
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
  return key.length > 0 ? key : "unknown"
}

export function formatSearchTimingLogFields(
  timings: SearchTimingSummary,
  extra: { traceWriteMs?: number } = {},
): string {
  const dbTotalMs = boundedMs(
    timings.db.reduce((total, timing) => total + timing.elapsedMs, 0),
  )
  const fields = [
    `total_ms=${timings.totalMs}`,
    `embedding_ms=${timings.embeddingMs}`,
    `db_retrievals_ms=${timings.retrievalsMs}`,
    `retrieval_wait_ms=${timings.retrievalWaitMs}`,
    `db_total_ms=${dbTotalMs}`,
    `fusion_ms=${timings.fusionMs}`,
    `dilution_cap_ms=${timings.dilutionCapMs}`,
    `dedupe_ms=${timings.dedupeMs}`,
    `mapping_ms=${timings.mappingMs}`,
    `hydration_ms=${timings.hydrationMs}`,
  ]

  if (extra.traceWriteMs != null) {
    fields.push(`trace_write_ms=${boundedMs(extra.traceWriteMs)}`)
  }

  for (const retriever of timings.retrievers) {
    const key = searchTimingLogKey(retriever.label)
    fields.push(`retriever_${key}_ms=${retriever.elapsedMs}`)
    fields.push(`retriever_${key}_status=${retriever.status}`)
    fields.push(`retriever_${key}_count=${retriever.resultCount}`)
  }

  for (const dbTiming of timings.db) {
    const key = searchTimingLogKey(dbTiming.label)
    fields.push(`db_${key}_ms=${dbTiming.elapsedMs}`)
    fields.push(`db_${key}_status=${dbTiming.status}`)
    fields.push(`db_${key}_count=${dbTiming.resultCount}`)
  }

  return fields.join(" ")
}

export function formatSearchTimingLogLine(input: {
  route: SearchTimingRouteSource
  locale: string
  requestedMode?: string | null
  searchMode: string
  outcome: string
  resultCount: number
  timings: SearchTimingSummary
  traceWriteMs?: number
}): string {
  return [
    "[search]",
    "event=search_timing",
    `route=${input.route}`,
    `locale=${searchTimingLogValue(input.locale)}`,
    `requested_mode=${searchTimingLogValue(input.requestedMode ?? "none")}`,
    `pipeline_mode=${searchTimingLogValue(input.timings.pipelineMode)}`,
    `search_mode=${searchTimingLogValue(input.searchMode)}`,
    `outcome=${searchTimingLogValue(input.outcome)}`,
    `result_count=${Math.max(0, Math.round(input.resultCount))}`,
    formatSearchTimingLogFields(input.timings, {
      traceWriteMs: input.traceWriteMs,
    }),
  ].join(" ")
}
