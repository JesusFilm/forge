import { mapWithConcurrency } from "./concurrentMap"
import {
  decideEpisodeAction,
  type SeriesDownloadResolution,
  type SeriesEpisodeResolution,
} from "./seriesDownloadResolver"
import type { OfflineDownloadRecord } from "./offlineManifest"
import type {
  StartDownloadRequest,
  StartDownloadResult,
} from "../contexts/DownloadsProvider"

// Pure enqueue orchestration for the series download-all sheet: the aggregate
// storage gate, the StartDownloadRequest builder, the capped enqueue loop, and
// the result-derived outcome buckets. Kept I/O-free given injected provider
// primitives so it unit-tests without rendering the route (no RN render harness).

// Concurrent enqueue cap. Small so concurrent swaps don't put many old+new
// copies in flight at once — their transient footprint must stay within the
// reserve budgeted by the storage pre-check (KTD7).
export const SERIES_ENQUEUE_CONCURRENCY = 2

// ── Storage gate (KTD6) ─────────────────────────────────────────────

export type StorageGate =
  | { kind: "ok"; requiredBytes: number; freeBytes: number }
  | { kind: "insufficient"; requiredBytes: number; freeBytes: number }
  | { kind: "unverifiable-total" }
  | { kind: "unreadable-free" }

export type StorageGateInput = {
  resolution: SeriesDownloadResolution
  /** Existing record per resolved episode slug (for swap/switch on-disk sizing). */
  getRecord: (slug: string) => OfflineDownloadRecord | null
  freeBytes: number
  reserveBytes: number
}

/**
 * Required = Σ(new rendition sizes) + Σ(existing on-disk totalBytes of every
 * swap/switch target, since the old copy lives alongside the new until verified)
 * + the reserve. Never green-light an unverifiable total: a lower-bound total
 * (any zero/missing resolved size) or a free read of 0 (API unavailable) blocks.
 */
export function evaluateStorageGate(input: StorageGateInput): StorageGate {
  const { resolution, getRecord, freeBytes, reserveBytes } = input

  if (resolution.totalIsLowerBound) return { kind: "unverifiable-total" }
  if (freeBytes <= 0) return { kind: "unreadable-free" }

  let swapOnDiskBytes = 0
  for (const episode of resolution.resolved) {
    if (!episode.dubDocumentId) continue
    const record = getRecord(episode.slug)
    const action = decideEpisodeAction(record, episode.dubDocumentId)
    if ((action === "swap" || action === "switch") && record) {
      swapOnDiskBytes += record.totalBytes || 0
    }
  }

  const requiredBytes = resolution.totalBytes + swapOnDiskBytes + reserveBytes
  return freeBytes < requiredBytes
    ? { kind: "insufficient", requiredBytes, freeBytes }
    : { kind: "ok", requiredBytes, freeBytes }
}

// ── Request builder ─────────────────────────────────────────────────

export type BuildRequestContext = {
  subtitleLanguageSlug: string | null
  allowCellular: boolean
}

/**
 * Build the per-episode StartDownloadRequest from a resolved episode, mirroring
 * app/watch/download.tsx's request shape: videoSlug = episode slug, the resolved
 * rendition + dub, and the batch's subtitle choice (URL from the episode's own
 * resolved track, null when that episode lacks it).
 */
export function buildEpisodeRequest(
  episode: SeriesEpisodeResolution,
  ctx: BuildRequestContext,
): StartDownloadRequest | null {
  if (
    episode.status !== "resolved" ||
    !episode.rendition ||
    !episode.dubDocumentId
  ) {
    return null
  }
  return {
    videoSlug: episode.slug,
    title: episode.title ?? "",
    dubDocumentId: episode.dubDocumentId,
    rendition: episode.rendition,
    // Degrade to no subtitle where this episode's track is absent (subtitleUrl
    // is null when missing), but keep the chosen slug so the engine records it.
    subtitleLanguageSlug: episode.subtitleUrl ? ctx.subtitleLanguageSlug : null,
    subtitleUrl: episode.subtitleUrl ?? null,
    posterUrl: episode.posterUrl,
    allowCellular: ctx.allowCellular,
  }
}

// ── Enqueue loop + outcome buckets (KTD4) ───────────────────────────

export type EnqueueOutcome =
  | "started"
  | "switched"
  | "already-present"
  | "couldnt-start"

export type EpisodeEnqueueResult = {
  slug: string
  title: string | null
  action: "start" | "swap" | "switch" | "skip"
  outcome: EnqueueOutcome
}

export type EnqueueSummary = {
  results: EpisodeEnqueueResult[]
  started: number
  switched: number
  alreadyPresent: number
  couldntStart: number
  /** Every resolved episode enqueued OK (started or switched) — no skips/fails. */
  allOk: boolean
}

export type EnqueueDeps = {
  getRecord: (slug: string) => OfflineDownloadRecord | null
  startDownload: (req: StartDownloadRequest) => Promise<StartDownloadResult>
  swapDownload: (req: StartDownloadRequest) => Promise<StartDownloadResult>
  /** Cancel an in-flight record before a fresh start (the `switch` path). */
  deleteDownload: (slug: string) => Promise<void>
}

// Classify ONE episode from its ACTUAL provider result, never the pre-call
// decision: a swap can return `exists` and no-op, so the decision over-reports
// switched. start ok → started; swap/switch ok → switched; exists →
// already-present; insufficient-storage / error → couldnt-start.
function bucketResult(
  action: "start" | "swap" | "switch",
  result: StartDownloadResult,
): EnqueueOutcome {
  if (result.ok) return action === "start" ? "started" : "switched"
  if (result.reason === "exists") return "already-present"
  return "couldnt-start"
}

async function enqueueOne(
  episode: SeriesEpisodeResolution,
  ctx: BuildRequestContext,
  deps: EnqueueDeps,
): Promise<EpisodeEnqueueResult> {
  const base = { slug: episode.slug, title: episode.title }
  const request = buildEpisodeRequest(episode, ctx)
  // dubDocumentId is present on every resolved episode (request is non-null).
  if (!request || !episode.dubDocumentId) {
    return { ...base, action: "skip", outcome: "couldnt-start" }
  }

  const action = decideEpisodeAction(
    deps.getRecord(episode.slug),
    episode.dubDocumentId,
  )

  if (action === "skip") {
    return { ...base, action, outcome: "already-present" }
  }
  if (action === "swap") {
    const result = await deps.swapDownload(request)
    return { ...base, action, outcome: bucketResult(action, result) }
  }
  if (action === "switch") {
    // swapDownload only acts on a `downloaded` record; an in-progress copy in
    // the old language must be canceled, then restarted in the chosen one.
    await deps.deleteDownload(episode.slug)
    const result = await deps.startDownload(request)
    return { ...base, action, outcome: bucketResult(action, result) }
  }
  const result = await deps.startDownload(request)
  return { ...base, action, outcome: bucketResult(action, result) }
}

/**
 * Drive the resolved set through the provider with a small concurrency cap,
 * bucketing each episode from its actual result. Per-episode failures never
 * fail the batch (mapWithConcurrency settles each).
 */
export async function enqueueResolvedEpisodes(
  resolved: readonly SeriesEpisodeResolution[],
  ctx: BuildRequestContext,
  deps: EnqueueDeps,
): Promise<EnqueueSummary> {
  const settled = await mapWithConcurrency(
    resolved,
    SERIES_ENQUEUE_CONCURRENCY,
    (episode) => enqueueOne(episode, ctx, deps),
  )

  const results: EpisodeEnqueueResult[] = settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value
    // An enqueueOne that itself threw (it shouldn't) is a couldn't-start.
    const episode = resolved[i]
    return {
      slug: episode.slug,
      title: episode.title,
      action: "skip",
      outcome: "couldnt-start",
    }
  })

  let started = 0
  let switched = 0
  let alreadyPresent = 0
  let couldntStart = 0
  for (const r of results) {
    if (r.outcome === "started") started += 1
    else if (r.outcome === "switched") switched += 1
    else if (r.outcome === "already-present") alreadyPresent += 1
    else couldntStart += 1
  }

  return {
    results,
    started,
    switched,
    alreadyPresent,
    couldntStart,
    allOk:
      results.length > 0 &&
      results.every((r) => r.outcome === "started" || r.outcome === "switched"),
  }
}

// ── Summary panel copy (zero-count buckets suppressed) ──────────────

/**
 * Enqueue-framed summary line, e.g. "12 started · 1 switched · 3 already
 * downloaded · 1 couldn't start". Suppresses zero-count buckets; empty string
 * when nothing happened.
 */
export function formatEnqueueSummary(summary: EnqueueSummary): string {
  const parts: string[] = []
  if (summary.started > 0) parts.push(`${summary.started} started`)
  if (summary.switched > 0) parts.push(`${summary.switched} switched`)
  if (summary.alreadyPresent > 0) {
    parts.push(`${summary.alreadyPresent} already downloaded`)
  }
  if (summary.couldntStart > 0) {
    parts.push(`${summary.couldntStart} couldn't start`)
  }
  return parts.join(" · ")
}
