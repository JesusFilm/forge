import { mapWithConcurrency } from "./concurrentMap"
import {
  decideEpisodeAction,
  episodeChoiceFor,
  type SeriesDownloadResolution,
  type SeriesEpisodeResolution,
} from "./seriesDownloadResolver"
import type { OfflineDownloadRecord } from "./offlineManifest"
import type {
  StartDownloadRequest,
  StartDownloadResult,
} from "./downloadLifecycle"

// Pure enqueue orchestration: storage gate, request builder, capped enqueue loop,
// result-derived outcome buckets. I/O-free via injected provider primitives so it
// unit-tests without rendering the route (no RN render harness).

// Concurrent enqueue cap. Small so concurrent swaps don't put many old+new
// copies in flight at once — their transient footprint must stay within the
// reserve budgeted by the storage pre-check (KTD7).
export const SERIES_ENQUEUE_CONCURRENCY = 2

// ── Storage gate (KTD6) ─────────────────────────────────────────────

export type StorageGate =
  | {
      kind: "ok"
      requiredBytes: number
      freeBytes: number
      /** Some rendition sizes were unknown, so requiredBytes is a lower bound. */
      lowerBound: boolean
    }
  | { kind: "insufficient"; requiredBytes: number; freeBytes: number }
  | { kind: "unreadable-free" }

export type StorageGateInput = {
  resolution: SeriesDownloadResolution
  /** Existing record per resolved episode slug (for swap on-disk sizing). */
  getRecord: (slug: string) => OfflineDownloadRecord | null
  freeBytes: number
  reserveBytes: number
  /** Chosen subtitle language — drives the per-episode swap decision. */
  subtitleLanguageSlug: string | null
}

/**
 * Required = Σ(new rendition sizes) + Σ(existing on-disk totalBytes of every
 * SWAP target, since a swap keeps the old copy alongside the new until verified)
 * + the reserve. A `switch` DELETES its old copy before starting, so those bytes
 * are reclaimed first and must NOT be counted (else switch over-budgets).
 *
 * KTD6/R12: missing rendition sizes no longer hard-block. When any resolved size
 * is unknown, the required total is a LOWER bound — budget the known sum, allow
 * if it fits (the engine falls back to OS-reported bytes for the unknowns), and
 * flag `lowerBound`. Only a free read of 0 (API unavailable) still blocks, since
 * nothing can be sized against it.
 */
export function evaluateStorageGate(input: StorageGateInput): StorageGate {
  const {
    resolution,
    getRecord,
    freeBytes,
    reserveBytes,
    subtitleLanguageSlug,
  } = input

  if (freeBytes <= 0) return { kind: "unreadable-free" }

  let swapOnDiskBytes = 0
  for (const episode of resolution.resolved) {
    const choice = episodeChoiceFor(episode, subtitleLanguageSlug)
    if (!choice) continue
    const record = getRecord(episode.slug)
    const action = decideEpisodeAction(record, choice)
    // Only a swap retains the old copy; a switch reclaims it before starting.
    if (action === "swap" && record) {
      swapOnDiskBytes += record.totalBytes || 0
    }
  }

  const requiredBytes = resolution.totalBytes + swapOnDiskBytes + reserveBytes
  if (freeBytes < requiredBytes) {
    return { kind: "insufficient", requiredBytes, freeBytes }
  }
  return {
    kind: "ok",
    requiredBytes,
    freeBytes,
    lowerBound: resolution.totalIsLowerBound,
  }
}

// ── Request builder ─────────────────────────────────────────────────

export type BuildRequestContext = {
  subtitleLanguageSlug: string | null
  allowCellular: boolean
  /** Series identity, constant across the whole batch. */
  seriesSlug: string
  /** undefined (not "") when the series has no title — matches how a written
   * record hydrates back (asOptionalString coerces "" to undefined too). */
  seriesTitle: string | undefined
  /** Captured once per batch, shared by every episode's request. */
  enqueuedAt: number
}

/**
 * Build the per-episode StartDownloadRequest from a resolved episode, mirroring
 * app/watch/download.tsx's request shape: videoSlug = episode slug, the resolved
 * rendition + dub, and the batch's subtitle choice (URL from the episode's own
 * resolved track, null when that episode lacks it). seriesEpisodeIndex/
 * durationSeconds come from the episode itself (per-episode), NOT ctx — they
 * vary across the batch, unlike seriesSlug/seriesTitle/enqueuedAt.
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
    seriesSlug: ctx.seriesSlug,
    seriesTitle: ctx.seriesTitle,
    seriesEpisodeIndex: episode.seriesEpisodeIndex,
    durationSeconds: episode.durationSeconds,
    enqueuedAt: ctx.enqueuedAt,
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
  /**
   * Accept an episode into the sequential batch queue (queueBatchDownload). Fresh
   * episodes start; a still-`downloaded` episode is SWAPPED at its turn by the
   * pump — so a re-download runs one-at-a-time, not in parallel.
   */
  startDownload: (req: StartDownloadRequest) => Promise<StartDownloadResult>
  /**
   * Stop an in-flight task WITHOUT deleting its record, neutralizing its terminal
   * callbacks so the switch replacement can reclaim the slug (U4/KTD3).
   */
  supersedeDownload: (slug: string) => Promise<void>
  /** Cancel an in-flight record before a fresh start (the `switch` path). */
  deleteDownload: (slug: string) => Promise<void>
  /** Persist a durable `queued` placeholder so a kill stays recoverable. */
  queueBatchRecords: (reqs: StartDownloadRequest[]) => Promise<void>
}

// Bucket from the ACTUAL provider result, not the pre-call decision: a swap can
// return `exists` and no-op, so the decision would over-report switched.
// (exists → already-present; insufficient-storage / error → couldnt-start.)
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

  // Decide from the built request's identity (dub + rendition + subtitle) so the
  // enqueue matches exactly what would be written — a new quality or subtitle on
  // the same dub is a real change (swap), not a skip.
  const action = decideEpisodeAction(deps.getRecord(episode.slug), {
    dubDocumentId: request.dubDocumentId,
    renditionDocumentId: request.rendition.documentId,
    subtitleLanguageSlug: request.subtitleLanguageSlug,
  })

  if (action === "skip") {
    return { ...base, action, outcome: "already-present" }
  }
  if (action === "swap") {
    // Queue it — the sequential pump swaps this downloaded episode at its turn
    // (one re-download at a time), instead of firing swaps in parallel.
    const result = await deps.startDownload(request)
    return { ...base, action, outcome: bucketResult(action, result) }
  }
  if (action === "switch") {
    // An in-progress copy in the old language can't be swapped (swap only acts on
    // `downloaded`). Supersede the old task FIRST — stop + neutralize its terminal
    // callbacks + await — so its async cancel can't delete the replacement on the
    // reused slug (KTD3); THEN clear its record/files and start fresh. The new
    // record's own pre-onBegin guard is the belt-and-suspenders for the race.
    await deps.supersedeDownload(episode.slug)
    await deps.deleteDownload(episode.slug)
    await deps.queueBatchRecords([request])
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

/**
 * The full series batch (R10): snapshot each resolved episode's record BEFORE
 * writing the `queued` placeholders, then enqueue against that snapshot. The
 * snapshot MUST precede queueBatchRecords — else the loop reads the just-written
 * placeholder as "same dub → skip" and nothing starts. Extracted here (pure,
 * injected) so the ordering invariant is unit-testable without the route.
 */
export async function runSeriesBatchEnqueue(
  resolved: readonly SeriesEpisodeResolution[],
  ctx: BuildRequestContext,
  deps: EnqueueDeps,
): Promise<EnqueueSummary> {
  // Pre-batch snapshot FIRST — decideEpisodeAction must decide from the state
  // before our own placeholders exist, not after.
  const preBatch = new Map(
    resolved.map(
      (episode) => [episode.slug, deps.getRecord(episode.slug)] as const,
    ),
  )
  const requests = resolved
    .map((episode) => buildEpisodeRequest(episode, ctx))
    .filter((req): req is StartDownloadRequest => req != null)
  await deps.queueBatchRecords(requests)
  return enqueueResolvedEpisodes(resolved, ctx, {
    ...deps,
    getRecord: (slug) => preBatch.get(slug) ?? null,
  })
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
