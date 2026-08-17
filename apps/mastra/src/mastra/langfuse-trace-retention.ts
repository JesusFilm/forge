/**
 * Langfuse trace retention sweep (feat-336): the self-built daily job that
 * deletes seeker traces older than the flat retention window from the
 * `forge-mastra` Langfuse project. Configurable retention is a paid Langfuse
 * feature the owner declined, and with retention off Langfuse deletes nothing
 * — ever — so while feat-321 tracing exports RAW conversations
 * (special-category personal data), this sweep IS the retention policy.
 *
 * One policy, one source: the window is `AI_CHAT_RETENTION_DAYS` imported
 * from `ai-chat-retention.ts` — the same 25 days the Postgres purge enforces
 * (owner decision 2026-08-10). Semantics differ deliberately (accepted
 * 2026-08-09): Postgres purges on ROLLING last-activity; this sweep deletes
 * on FIXED per-trace event time. Traces are operator-facing observability,
 * never user-facing history, so the divergence errs privacy-safe. Langfuse
 * has no session-delete API — "delete the session" IS this per-trace sweep.
 *
 * Scheduling (owner decision 2026-08-11, superseding the boot-sweep +
 * setInterval design): ONE run per UTC day, fired by a wall-clock timer at
 * `LANGFUSE_TRACE_RETENTION_FIRE_HOUR_UTC`. Boot only ARMS the timer — it
 * never sweeps — so a restart re-aims at the same wall-clock target and
 * redeploys cannot add runs: runs/day = 1 by construction, which is what
 * lets the per-RUN delete budget equal the per-DAY allocation (see
 * `MAX_DELETE_REQUESTS_PER_RUN`). Every arm logs
 * `event=sweep_scheduled next_fire=<iso>` so a timer that never fires is
 * diagnosable from logs. The fire hour sits in the observed deploy trough
 * (zero merges to main in that UTC hour across the 200-merge/20-day sample,
 * 2026-08-11) to keep a deploy-overlap double-fire — old and new containers
 * coexisting across the firing moment under Railway's healthcheck-gated
 * promotion — improbable; that residual and the symmetric one (a genuine
 * outage straddling the firing moment skips that day, caught up by the next
 * day's run inside the 5-day wall margin) are ACCEPTED at dogfood scale and
 * recorded in the feat-336 ticket, with the deferred mitigation (an atomic
 * per-UTC-day spend-claim ledger in Postgres) named there.
 *
 * Endpoints (verified against the live API reference + langfuse-cli,
 * 2026-08-10):
 *   - LIST: `GET /api/public/v2/observations` with `toStartTime` (start_time
 *     strictly BEFORE the cutoff, ISO 8601), `fields=core` (id/traceId/
 *     start-end times/projectId/parentObservationId/type — NEVER the `io`
 *     group: raw conversation text must not enter this heap, and the row
 *     schema strips unknown fields so even a misbehaving upstream cannot
 *     land content here), base64 `cursor` pagination via `meta.cursor`, rows
 *     deduped to unique traceIds. This is the successor endpoint — the
 *     deprecated `GET /api/public/traces` (list) sits in the tightest rate
 *     bucket and must not be used. Completeness is CONDITIONAL on the
 *     ingestion path: only traces whose observations are indexed on the v2
 *     read surface are sweepable, and legacy-batch-ingested traces never
 *     appear there (verified 2026-08-11 — see the smoke header), so they are
 *     invisible to this sweep; all production traces arrive via OTel, which
 *     does index. The endpoint also exposes NO ordering
 *     parameter (checked 2026-08-10), so a bounded listing cannot guarantee
 *     oldest-first drain — the wall-risk metric below is the backstop, and
 *     the escape hatch for traces aging past the Hobby 30-day visibility
 *     wall is a temporary Core upgrade (see the feat-336 ticket).
 *   - DELETE: `DELETE /api/public/traces` body `{ traceIds }` — ≤50 ids per
 *     request (vendor advisory; larger batches have real-world 502/504
 *     reports), budgeted per run (see `MAX_DELETE_REQUESTS_PER_RUN`).
 *
 * Filter integrity: the sweep never trusts the server-side `toStartTime`
 * filter alone. Every listed row's own `startTime` is re-checked client-side
 * against the cutoff; a row that is unparseable or inside the window is
 * SKIPPED (counted as `filter_skipped`, warned loudly) — so a silently
 * ignored/renamed query param degrades to a no-op sweep with a loud log,
 * never a project-wide delete.
 *
 * Deletion is ASYNCHRONOUS (~15 min, no completion event, no receipt). A
 * trace whose deletion silently failed simply re-lists on a later run and is
 * re-deleted — the sweep is self-healing without remembering anything.
 * Completion is VERIFIED by the restart-proof outcome metric, not by
 * receipt-tracking: every run reports `oldest_age_days` over what it listed
 * and warns `retention_wall_risk` once the oldest listed trace approaches
 * the Hobby 30-day visibility wall — that catches ANY sustained deletion
 * failure (~3 days after traces overstay the 25-day window, leaving a 2-day
 * reaction margin before the wall), whatever the cause. Two stated limits:
 * the metric is computed over LISTED rows and the endpoint exposes no
 * ordering, so on a truncated listing it is a prefix-only statistic — the
 * `list_truncated` warn line is the loud cue that the true oldest unswept
 * trace may be older than reported until the backlog drains. And over this
 * visibility-walled store the warn is a bounded PULSE, not a persistent
 * alarm: rows past the 30-day wall leave the listing, so a long-stalled
 * sweep converges to `listed=0` with the warn silent — absence of the warn
 * is never recovery evidence. The opt-in real-credential smoke
 * (`langfuse-trace-retention.smoke.test.ts`) is the on-demand direct
 * OBSERVATION of upstream deletion convergence (reported to the human
 * runner, never asserted — convergence timing is the vendor's SLA). An
 * earlier in-memory verify-by-requery mechanism (remember submitted ids,
 * re-encounter-check next run) was REMOVED 2026-08-11: at the repo's deploy
 * cadence the process rarely survives two consecutive daily runs, so the
 * signal was de facto inert while its carry-forward rules were the module's
 * subtlest logic; the durable version belongs on the deferred spend-claim
 * ledger if ever needed (see the feat-336 ticket).
 * HTTP 429 + `Retry-After` is a first-class outcome with its own enum
 * reason, never a swallowed error; the backlog carries to the next run.
 *
 * Gating: runs when the Langfuse credential trio (`LANGFUSE_BASE_URL` /
 * `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`) is configured — deliberately
 * NOT on `LANGFUSE_TRACING_ENABLED`: that flag stops NEW exports, but
 * already-exported traces still need retention (kill-switch completeness
 * follows data lifetime). Absent credentials → one quiet no-op line. Nothing
 * here is required at boot.
 *
 * HTTP posture mirrors `services/langfuse-prompt-client.ts` (the house
 * Langfuse client): Basic auth from the key pair, `redirect: "error"`,
 * `AbortSignal.timeout`, byte-capped streaming reads, no-throw result unions,
 * and leak control — log lines carry enums and counts ONLY, never trace ids,
 * user ids, conversation content, or exception text. ONE deliberate
 * divergence (2026-08-11): this module's config comes EXCLUSIVELY from
 * `getLangfuseTraceRetentionConfig()` — same config except `timeoutMs` comes
 * from `LANGFUSE_TRACE_RETENTION_TIMEOUT_MS` (default 15 s), NOT the
 * prompt-tuned `LANGFUSE_TIMEOUT_MS` (default 3 s) it originally inherited:
 * the live batch-DELETE was MEASURED at ~3.4 s for a 2-id batch, so the
 * inherited default would have timed out every production delete leg
 * (deletion still schedules server-side on an aborted socket, so data would
 * die while logs reported failure — the confusing half-broken state). The
 * sweep's caller budget is the daily timer, not the 90 s chat turn.
 *
 * Single-instance assumption (same as the ai-chat purge): Mastra runs one
 * replica; add a leader guard before scaling out — two replicas would spend
 * the ORG-wide delete quota twice. The production-only gate lives at the
 * CALL SITE in `src/mastra/index.ts`, mirroring `startAiChatRetentionPurge`.
 *
 * SECOND CONSUMER — feat-337 per-user erasure (KTD4): the erasure module
 * reuses this module's Langfuse client surface — `listObservationsByUserIdPage`
 * (the by-userId listing primitive below) plus the existing `deleteTraceBatch`
 * — rather than growing its own HTTP copy. The listing requests
 * `fields=core,basic`: `userId` rides the `basic` field group, which (like
 * `core`) carries identifiers and metadata only — the `io` group (raw
 * conversation text) is still NEVER requested, and the strip-mode row schema
 * remains the leak control either way.
 */

import { z } from "zod"

import {
  getLangfuseTraceRetentionConfig,
  type LangfuseConfig,
} from "../config/env"

import { AI_CHAT_RETENTION_DAYS } from "./ai-chat-retention"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * UTC hour of the once-daily firing. 08:00 UTC sits in the observed deploy
 * trough (zero merges to main in that hour across the 200-merge/20-day
 * sample, 2026-08-11: deploys cluster 20:00–03:59 and 10:00–17:00 UTC), so
 * a deploy-overlap double-fire straddling the firing moment stays
 * improbable. Re-aim freely if deploy patterns shift — nothing breaks, the
 * straddle probability just moves.
 */
export const LANGFUSE_TRACE_RETENTION_FIRE_HOUR_UTC = 8

/** Vendor advisory ceiling — larger batches have real-world 502/504 reports. */
export const MAX_TRACE_IDS_PER_DELETE_REQUEST = 50

/**
 * Per-RUN delete-request cap == the per-DAY allocation, because runs/day = 1
 * by construction (wall-clock scheduling, no boot sweep — a restart re-aims
 * at the same firing hour instead of minting a fresh budget; see the module
 * header). The Hobby quota is 50 delete requests/day/org and ≥10/day must
 * stay reserved as feat-337 erasure headroom (an erasure always wins over
 * the sweep), so the sweep's allocation is 40/day = 40/run. Spend is
 * workload-driven (1 request per 50 traces): steady state at dogfood volume
 * is ~1 request/day; the full budget (2,000 traces/run) exists for backlog
 * drains. Accepted residual: a deploy-overlap double-fire could attempt up
 * to 2× this cap on a heavy-backlog day — see the module header.
 */
export const MAX_DELETE_REQUESTS_PER_RUN = 40

/**
 * Listing page size. Measured 2026-08-17 (read-only probe against the
 * production project): ~356 B per `fields=core` row, so a full 500-row page
 * projects to ~178 KB — under the house byte cap
 * (`LANGFUSE_MAX_RESPONSE_BYTES`, default 256 KiB) with ~1.5× headroom.
 * (Observed live pages returned ≤250 rows for limit=500, so real pages sit
 * well below the projection.) The opt-in retention smoke re-measures and
 * asserts this when run (note: its delete leg spends one org delete-quota
 * request per run) — trust the measurement over any estimate here.
 */
export const LANGFUSE_RETENTION_LIST_PAGE_SIZE = 500

/**
 * Page size for the feat-337 by-userId erasure listing — deliberately
 * SEPARATE from the sweep's constant above, which was sized for the SMALLER
 * `fields=core` row (measured ~356 B/row, 2026-08-17). The erasure listing
 * requests `fields=core,basic`, whose rows carry the basic metadata group on
 * top of core. Real measurement (opt-in read smoke, 2026-08-17): 63,323 B
 * per 100-row `fields=core,basic` page — ~633 B/row, so 500 such rows
 * (~316 KB) would breach the 256 KiB `LANGFUSE_MAX_RESPONSE_BYTES` cap and
 * turn a heavy-subject listing into a deterministic `parse_error`. 100 rows
 * keeps the measured page at ~4× headroom under the cap, and 20 pages × 100
 * rows still far exceeds any single subject's plausible trace volume. The
 * smoke re-measures and asserts this on every run — trust the measurement
 * over any estimate here.
 */
export const LANGFUSE_ERASURE_LIST_PAGE_SIZE = 100

/**
 * Per-run listing bound so a pathological backlog cannot spin the general
 * API bucket (30 req/min). 20 pages × 500 rows = 10,000 observations/run
 * against the 2,000-trace delete budget (50 × 40): the delete budget binds
 * while traces average ≤5 observations, the page cap past that. Either
 * bound truncates loudly (`list_truncated=1`) and the backlog carries to
 * the next run.
 */
export const MAX_LIST_PAGES_PER_RUN = 20

/**
 * Loud-warning threshold for the oldest listed trace's age. The Hobby tier
 * hides data older than 30 days from the API entirely (invisible ⇒
 * un-deletable without a paid upgrade); warning at 28 leaves a 2-day margin
 * to act. Sits above window + interval, so a healthy backlog drain does not
 * trip it on day one.
 */
export const RETENTION_WALL_WARN_AGE_DAYS = 28

export type LangfuseTraceRetentionFailureReason =
  | "auth_failed"
  | "timeout"
  | "network_error"
  | "rejected"
  | "parse_error"

/**
 * The COMPOSED per-call failure vocabulary — every reason a single Langfuse
 * HTTP call in this module can fail with, `rate_limited` included. Exported
 * for the feat-337 erasure module (KTD5): the sweep's own
 * `LangfuseTraceRetentionFailureReason` alias deliberately excludes
 * `rate_limited` (the sweep reports 429 as a first-class OUTCOME, not a
 * failure reason), so the alias alone cannot type the erasure module's
 * per-call classification.
 */
export type LangfuseErasureListFailureReason =
  | LangfuseTraceRetentionFailureReason
  | "rate_limited"

type LangfuseHttpFailure = {
  ok: false
  reason: LangfuseErasureListFailureReason
  status?: number
  /** Parsed from `Retry-After` on a 429 (seconds form only). */
  retryAfterSeconds?: number
}

export type LangfuseListObservationsResult =
  | {
      ok: true
      /**
       * Unique trace ids on this page whose OWN startTime passed the
       * client-side window re-check (order preserved, page-local dedupe).
       */
      traceIds: string[]
      observationCount: number
      /** Rows skipped by the client-side re-check (in-window/unparseable). */
      filterSkipped: number
      /** Epoch ms of the oldest valid row on this page; absent when none. */
      oldestStartTimeMs?: number
      nextCursor?: string
    }
  | LangfuseHttpFailure

export type LangfuseDeleteTracesResult = { ok: true } | LangfuseHttpFailure

/** Count/enum fields shared by every non-skipped sweep outcome. */
export type LangfuseSweepStats = {
  listedObservations: number
  uniqueTraces: number
  /** Delete requests ATTEMPTED — each spends quota whether or not it 2xx'd. */
  deleteRequests: number
  deletedSubmitted: number
  /** Rows the client-side window re-check refused (loud when non-zero). */
  filterSkipped: number
  /** Whole days; absent when the run listed no valid rows. */
  oldestAgeDays?: number
  /** A FULL page came back with no cursor — pagination contract suspect. */
  paginationSuspect: boolean
  /** Listing stopped with backlog remaining (pages/ids/429/failure). */
  listTruncated: boolean
}

export type LangfuseTraceRetentionSweepResult =
  | { outcome: "skipped"; reason: "config_missing" }
  | ({ outcome: "swept" } & LangfuseSweepStats)
  | ({
      outcome: "rate_limited"
      /** The stage that 429ed last — delete overwrites list. */
      stage: "list" | "delete"
      retryAfterSeconds?: number
    } & LangfuseSweepStats)
  | ({
      outcome: "failed"
      stage: "list" | "delete"
      reason: LangfuseTraceRetentionFailureReason
      status?: number
    } & LangfuseSweepStats)

/** The credential-trio gate — deliberately ignorant of LANGFUSE_TRACING_ENABLED. */
export function isLangfuseTraceRetentionConfigured(
  config: LangfuseConfig = getLangfuseTraceRetentionConfig(),
): boolean {
  return Boolean(config.baseUrl && config.publicKey && config.secretKey)
}

// Copied from services/langfuse-prompt-client.ts (the single-attempt
// result-union convention family; several copies exist repo-wide — see
// docs/solutions/conventions/single-service-http-client-result-union-convention.md,
// whose extraction trigger has fired; consolidating them is tracked
// follow-up work, not this module's scope). Joins relative to a normalized
// trailing-slash base so a path-prefixed base URL keeps its prefix.
function endpoint(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL(path, normalized)
}

/**
 * Byte-capped streaming JSON read (feat-202 OOM-guard family — see the
 * provenance note on `endpoint` above). Streams the body with a running byte
 * counter, cancels the reader (aborting the socket) past `maxBytes`, and
 * returns `undefined` on failure. The catch must never log the caught error:
 * a JSON.parse SyntaxError can embed raw body fragments.
 *
 * DELIBERATE DIVERGENCE from the sibling copies: a `TimeoutError`/
 * `AbortError` thrown mid-body-read is RETHROWN instead of swallowed, so the
 * caller classifies a genuine upstream-latency incident as `timeout` rather
 * than `parse_error` (the documented misclassification defect from PR #1621
 * — in a background job whose only operator signal is the log line, the
 * wrong reason steers the operator at the wrong root cause).
 */
async function readJsonBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const stream = response.body
  if (!stream) return undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(merged))
  } catch (error) {
    const errorName = (error as { name?: string } | null | undefined)?.name
    if (errorName === "TimeoutError" || errorName === "AbortError") throw error
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Cleanup must never escape the no-throw boundary.
    }
  }
}

function basicAuthHeader(config: LangfuseConfig): string {
  return `Basic ${Buffer.from(
    `${config.publicKey}:${config.secretKey}`,
  ).toString("base64")}`
}

/** Seconds form of `Retry-After` only; the HTTP-date form maps to undefined. */
function retryAfterSecondsFrom(response: Response): number | undefined {
  const raw = response.headers.get("retry-after")
  if (raw === null) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/**
 * Best-effort drain of a response body this module will not read (failure
 * statuses, the delete 200) so the socket frees. Never throws.
 */
async function drainBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Draining is best-effort; never let cleanup escape.
  }
}

// Copied classification from services/langfuse-prompt-client.ts
// (failureForStatus): 401/403 -> auth_failed, 429 -> rate_limited (+
// Retry-After), other 4xx -> rejected, 5xx -> network_error. No body is read
// on error statuses — nothing here ever surfaces upstream text.
function failureForStatus(response: Response): LangfuseHttpFailure {
  const status = response.status
  if (status === 401 || status === 403) {
    return { ok: false, reason: "auth_failed", status }
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      status,
      retryAfterSeconds: retryAfterSecondsFrom(response),
    }
  }
  return {
    ok: false,
    reason: status >= 400 && status < 500 ? "rejected" : "network_error",
    status,
  }
}

function failureForThrow(error: unknown): LangfuseHttpFailure {
  // Classify on the typed surface, not the message. `AbortSignal.timeout`
  // rejects with TimeoutError; a manual abort gives AbortError.
  const errorName = (error as { name?: string } | null | undefined)?.name
  if (errorName === "TimeoutError" || errorName === "AbortError") {
    return { ok: false, reason: "timeout" }
  }
  return { ok: false, reason: "network_error" }
}

// The ROW schema deliberately has NO passthrough: zod's default strip drops
// every unlisted field at parse, so even an upstream that ignores
// `fields=core` and returns the io group cannot land conversation text in
// this module's memory beyond the transient body buffer. The envelope and
// meta keep passthrough for additive contract evolution.
// Row fields widened by exactly `userId` for the feat-337 by-userId listing
// (KTD4). `z.unknown()` keys are effectively optional, so the retention
// listing (which never requests `basic`) parses identically — its rows just
// carry `userId: undefined`, which it never reads.
const ObservationsPageSchema = z
  .object({
    data: z.array(
      z.object({
        traceId: z.unknown(),
        startTime: z.unknown(),
        userId: z.unknown(),
      }),
    ),
    meta: z
      .object({ cursor: z.string().nullable().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()

/**
 * One page of `GET /api/public/v2/observations`, filtered to the retention
 * window via `toStartTime` AND re-checked client-side: only rows whose own
 * `startTime` parses and falls strictly before the cutoff contribute trace
 * ids (see "Filter integrity" in the module header). `fields=core` keeps the
 * io group out; only string `traceId`s leave this function.
 */
export async function listExpiredObservationsPage({
  config,
  toStartTimeIso,
  cursor,
  fetchImpl = fetch,
}: {
  config: LangfuseConfig
  toStartTimeIso: string
  cursor?: string
  fetchImpl?: typeof fetch
}): Promise<LangfuseListObservationsResult> {
  // The cutoff anchors the mass-delete guard: a NaN cutoff makes every row's
  // re-check comparison false — i.e. NOTHING gets skipped and the guard
  // silently fails OPEN to whatever the server returned. Unreachable from the
  // sweep (toISOString is always parseable), but refusing it here makes the
  // guard total for any direct caller, before a request is even spent.
  const cutoffMs = Date.parse(toStartTimeIso)
  if (Number.isNaN(cutoffMs)) return { ok: false, reason: "parse_error" }
  const url = endpoint(config.baseUrl ?? "", "api/public/v2/observations")
  url.searchParams.set("toStartTime", toStartTimeIso)
  url.searchParams.set("fields", "core")
  url.searchParams.set("limit", String(LANGFUSE_RETENTION_LIST_PAGE_SIZE))
  if (cursor !== undefined) url.searchParams.set("cursor", cursor)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: basicAuthHeader(config),
        "user-agent": config.userAgent,
      },
      // No legitimate redirect exists; following one would re-send the
      // full-project-access Basic credentials to an unvetted host.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    return failureForThrow(error)
  }

  if (!response.ok) {
    await drainBody(response)
    return failureForStatus(response)
  }

  let body: unknown
  try {
    body = await readJsonBodyCapped(response, config.maxResponseBytes)
  } catch (error) {
    // A mid-body-read timeout/abort is a latency incident, not a parse
    // failure — see the readJsonBodyCapped divergence note.
    return failureForThrow(error)
  }
  const parsed = ObservationsPageSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, reason: "parse_error", status: response.status }
  }

  const traceIds: string[] = []
  const seen = new Set<string>()
  let filterSkipped = 0
  let oldestStartTimeMs: number | undefined
  for (const row of parsed.data.data) {
    const { traceId, startTime } = row
    if (typeof traceId !== "string" || traceId.length === 0) continue
    // Client-side window re-check: never mark a trace for deletion the row's
    // own startTime does not prove expired (filter integrity, module header).
    const startTimeMs =
      typeof startTime === "string" ? Date.parse(startTime) : Number.NaN
    if (Number.isNaN(startTimeMs) || startTimeMs >= cutoffMs) {
      filterSkipped += 1
      continue
    }
    if (oldestStartTimeMs === undefined || startTimeMs < oldestStartTimeMs) {
      oldestStartTimeMs = startTimeMs
    }
    if (seen.has(traceId)) continue
    seen.add(traceId)
    traceIds.push(traceId)
  }
  const nextCursor = parsed.data.meta?.cursor ?? undefined
  return {
    ok: true,
    traceIds,
    observationCount: parsed.data.data.length,
    filterSkipped,
    ...(oldestStartTimeMs !== undefined ? { oldestStartTimeMs } : {}),
    ...(nextCursor ? { nextCursor } : {}),
  }
}

/** One readable listed row of the feat-337 by-userId listing. */
export type LangfuseUserObservationRow = {
  traceId: string
  userId: string
}

export type LangfuseListObservationsByUserIdResult =
  | {
      ok: true
      /**
       * Every row with a readable non-empty string `traceId` AND `userId`,
       * projected field-by-field to exactly those two fields, in server
       * order. Deliberately NOT deduped and NOT filtered to the requested
       * userId — the caller (feat-337 U6) re-checks `userId === target`
       * per row, then dedupes to unique trace ids (list → re-check → dedupe).
       */
      rows: LangfuseUserObservationRow[]
      /** Raw row count on this page, readable or not. */
      observationCount: number
      /**
       * Rows WITHOUT a readable non-empty string `userId` — the R7 refusal
       * signal: a non-zero count (or `observationCount` exceeding
       * `rows.length + missingTraceIdCount`) means the listing cannot prove
       * per-row ownership, and the erasure caller must refuse the Langfuse
       * half rather than delete unproven rows. Never silently dropped.
       */
      missingUserIdCount: number
      /**
       * Rows whose `userId` IS readable but whose `traceId` is not — visible
       * (undeletable) rather than vanished. Counted separately so the caller
       * can tell "ownership unprovable" from "target unaddressable".
       */
      missingTraceIdCount: number
      nextCursor?: string
    }
  | LangfuseHttpFailure

/**
 * One page of `GET /api/public/v2/observations` filtered by the `userId`
 * QUERY param (never the structured `filter` param, which would take
 * precedence) with `fields=core,basic` — `userId` rides the `basic` field
 * group; the `io` group (raw conversation text) is never requested, and the
 * strip-mode row schema drops it even from a misbehaving upstream. The R7
 * listing primitive for the feat-337 erasure module (KTD4); see the result
 * type above for the list → re-check → dedupe contract split with the caller.
 *
 * EMPIRICAL (2026-08-17, one-call read-only probe against the real
 * `forge-mastra` project): `GET /api/public/v2/observations?fields=core,basic&limit=10`
 * returned 200 with 10 rows, every row carrying a non-empty string `userId` —
 * the typings' claim that `basic` serves `userId` is confirmed real.
 *
 * A blank `userId` is refused BEFORE any request: an empty filter would list
 * the whole project, failing the erasure guard OPEN (mirrors the sibling's
 * NaN-cutoff refusal).
 */
export async function listObservationsByUserIdPage({
  config,
  userId,
  cursor,
  fetchImpl = fetch,
}: {
  config: LangfuseConfig
  userId: string
  cursor?: string
  fetchImpl?: typeof fetch
}): Promise<LangfuseListObservationsByUserIdResult> {
  if (userId.trim().length === 0) return { ok: false, reason: "parse_error" }
  const url = endpoint(config.baseUrl ?? "", "api/public/v2/observations")
  url.searchParams.set("userId", userId)
  url.searchParams.set("fields", "core,basic")
  url.searchParams.set("limit", String(LANGFUSE_ERASURE_LIST_PAGE_SIZE))
  if (cursor !== undefined) url.searchParams.set("cursor", cursor)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: basicAuthHeader(config),
        "user-agent": config.userAgent,
      },
      // No legitimate redirect exists; following one would re-send the
      // full-project-access Basic credentials to an unvetted host.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    return failureForThrow(error)
  }

  if (!response.ok) {
    await drainBody(response)
    return failureForStatus(response)
  }

  let body: unknown
  try {
    body = await readJsonBodyCapped(response, config.maxResponseBytes)
  } catch (error) {
    // A mid-body-read timeout/abort is a latency incident, not a parse
    // failure — see the readJsonBodyCapped divergence note.
    return failureForThrow(error)
  }
  const parsed = ObservationsPageSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, reason: "parse_error", status: response.status }
  }

  const rows: LangfuseUserObservationRow[] = []
  let missingUserIdCount = 0
  let missingTraceIdCount = 0
  for (const row of parsed.data.data) {
    const { traceId, userId: rowUserId } = row
    // Ownership readability first: a row whose userId cannot be read is the
    // refusal signal regardless of its traceId's shape.
    if (typeof rowUserId !== "string" || rowUserId.length === 0) {
      missingUserIdCount += 1
      continue
    }
    if (typeof traceId !== "string" || traceId.length === 0) {
      missingTraceIdCount += 1
      continue
    }
    // Field-by-field projection — never the parsed row object itself.
    rows.push({ traceId, userId: rowUserId })
  }
  const nextCursor = parsed.data.meta?.cursor ?? undefined
  return {
    ok: true,
    rows,
    observationCount: parsed.data.data.length,
    missingUserIdCount,
    missingTraceIdCount,
    ...(nextCursor ? { nextCursor } : {}),
  }
}

/**
 * One `DELETE /api/public/traces` batch (≤50 ids — the caller chunks).
 * Deletion is asynchronous upstream: 2xx means ACCEPTED, not gone — nothing
 * is remembered about it; an undeleted trace re-lists on a later run and is
 * re-deleted (self-healing), and completion is verified by the
 * `oldest_age_days` / `retention_wall_risk` outcome metric (plus, on demand,
 * the opt-in smoke). See the module header.
 */
export async function deleteTraceBatch({
  config,
  traceIds,
  fetchImpl = fetch,
}: {
  config: LangfuseConfig
  traceIds: string[]
  fetchImpl?: typeof fetch
}): Promise<LangfuseDeleteTracesResult> {
  const url = endpoint(config.baseUrl ?? "", "api/public/traces")

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "DELETE",
      headers: {
        authorization: basicAuthHeader(config),
        "content-type": "application/json",
        "user-agent": config.userAgent,
      },
      body: JSON.stringify({ traceIds }),
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    return failureForThrow(error)
  }

  // Neither the 200 body (`{ message }`) nor an error body is consumed —
  // drain both so the socket frees.
  await drainBody(response)
  if (!response.ok) return failureForStatus(response)
  return { ok: true }
}

/**
 * One sweep run: list the expired window (bounded pages, client-side window
 * re-check), then delete in ≤50-id batches under the per-run request budget.
 * A list-stage failure or 429 still deletes what was already collected
 * (every collected id passed the window re-check, and the delete quota is a
 * separate bucket). Never throws for API-shaped failures — every outcome is
 * an enum the caller logs. See the module header for the full contract.
 */
export async function runLangfuseTraceRetentionSweep({
  config = getLangfuseTraceRetentionConfig(),
  fetchImpl = fetch,
  now = () => Date.now(),
}: {
  config?: LangfuseConfig
  fetchImpl?: typeof fetch
  now?: () => number
} = {}): Promise<LangfuseTraceRetentionSweepResult> {
  if (!isLangfuseTraceRetentionConfigured(config)) {
    return { outcome: "skipped", reason: "config_missing" }
  }

  const nowMs = now()
  const toStartTimeIso = new Date(
    nowMs - AI_CHAT_RETENTION_DAYS * DAY_MS,
  ).toISOString()

  // ── List (bounded) ────────────────────────────────────────────────────────
  const idBudget =
    MAX_TRACE_IDS_PER_DELETE_REQUEST * MAX_DELETE_REQUESTS_PER_RUN
  const uniqueTraceIds = new Set<string>()
  let listedObservations = 0
  let filterSkipped = 0
  let oldestStartTimeMs: number | undefined
  let paginationSuspect = false
  let cursor: string | undefined
  let pages = 0
  let moreRemained = false
  let rateLimited:
    | { stage: "list" | "delete"; retryAfterSeconds?: number }
    | undefined
  let listFailure:
    | { reason: LangfuseTraceRetentionFailureReason; status?: number }
    | undefined

  for (;;) {
    if (pages >= MAX_LIST_PAGES_PER_RUN || uniqueTraceIds.size >= idBudget) {
      moreRemained = true
      break
    }
    const page = await listExpiredObservationsPage({
      config,
      toStartTimeIso,
      cursor,
      fetchImpl,
    })
    if (!page.ok) {
      // Either way, stop listing but still delete what was collected —
      // every collected id already passed the window re-check.
      moreRemained = true
      if (page.reason === "rate_limited") {
        rateLimited = {
          stage: "list",
          retryAfterSeconds: page.retryAfterSeconds,
        }
      } else {
        listFailure = { reason: page.reason, status: page.status }
      }
      break
    }
    pages += 1
    listedObservations += page.observationCount
    filterSkipped += page.filterSkipped
    if (
      page.oldestStartTimeMs !== undefined &&
      (oldestStartTimeMs === undefined ||
        page.oldestStartTimeMs < oldestStartTimeMs)
    ) {
      oldestStartTimeMs = page.oldestStartTimeMs
    }
    for (const id of page.traceIds) uniqueTraceIds.add(id)
    if (!page.nextCursor) {
      // A FULL page with no cursor smells like a drifted pagination
      // contract — a wrong cursor field would silently cap every sweep at
      // page one, so the caller warns loudly on this flag.
      if (page.observationCount >= LANGFUSE_RETENTION_LIST_PAGE_SIZE) {
        paginationSuspect = true
      }
      break
    }
    cursor = page.nextCursor
  }

  // ── Delete (budgeted) ─────────────────────────────────────────────────────
  const ids = [...uniqueTraceIds]
  const submittedIds: string[] = []
  let deleteRequests = 0
  let deleteFailure:
    | { reason: LangfuseTraceRetentionFailureReason; status?: number }
    | undefined
  while (
    submittedIds.length < ids.length &&
    deleteRequests < MAX_DELETE_REQUESTS_PER_RUN
  ) {
    const chunk = ids.slice(
      submittedIds.length,
      submittedIds.length + MAX_TRACE_IDS_PER_DELETE_REQUEST,
    )
    // Count the ATTEMPT before the call: a failed or 429'd request still
    // spends the org-wide per-day delete quota, and the per-run spend count
    // is the observable actual spend is reconstructed from after the fact.
    deleteRequests += 1
    const result = await deleteTraceBatch({
      config,
      traceIds: chunk,
      fetchImpl,
    })
    if (!result.ok) {
      if (result.reason === "rate_limited") {
        rateLimited = {
          stage: "delete",
          retryAfterSeconds: result.retryAfterSeconds,
        }
      } else {
        deleteFailure = { reason: result.reason, status: result.status }
      }
      break
    }
    submittedIds.push(...chunk)
  }

  const stats: LangfuseSweepStats = {
    listedObservations,
    uniqueTraces: uniqueTraceIds.size,
    deleteRequests,
    deletedSubmitted: submittedIds.length,
    filterSkipped,
    ...(oldestStartTimeMs !== undefined
      ? { oldestAgeDays: Math.floor((nowMs - oldestStartTimeMs) / DAY_MS) }
      : {}),
    paginationSuspect,
    listTruncated: moreRemained,
  }

  if (deleteFailure) {
    return { outcome: "failed", stage: "delete", ...deleteFailure, ...stats }
  }
  if (listFailure) {
    return { outcome: "failed", stage: "list", ...listFailure, ...stats }
  }
  if (rateLimited) {
    return {
      outcome: "rate_limited",
      stage: rateLimited.stage,
      ...(rateLimited.retryAfterSeconds !== undefined
        ? { retryAfterSeconds: rateLimited.retryAfterSeconds }
        : {}),
      ...stats,
    }
  }
  return { outcome: "swept", ...stats }
}

/**
 * Enum/count-only plain-string logging (Railway logsV2 silences JSON stdout).
 * A run that cannot list or delete logs loudly EVERY run — silent
 * under-deletion is the known DIY-retention failure mode this exists to
 * catch. The advisory lines (filter/pagination suspicion, wall risk) fire on
 * every non-skipped outcome, failed runs included. Never trace ids, user
 * ids, or exception text.
 */
function logSweepResult(result: LangfuseTraceRetentionSweepResult): void {
  if (result.outcome === "skipped") {
    console.info(
      "[langfuse-retention] event=sweep_skipped reason=config_missing",
    )
    return
  }
  if (result.filterSkipped > 0) {
    console.warn(
      `[langfuse-retention] event=list_filter_suspect skipped=${result.filterSkipped}`,
    )
  }
  if (result.paginationSuspect) {
    console.warn(
      "[langfuse-retention] event=list_pagination_suspect reason=full_page_without_cursor",
    )
  }
  if (result.listTruncated) {
    // A truncated listing makes oldest_age_days a PREFIX-ONLY statistic (the
    // endpoint exposes no ordering), so the sole runtime outcome metric can
    // under-report the true oldest unswept trace until the backlog drains —
    // warn loudly so a truncated run never reads as a fully-measured one.
    console.warn(
      "[langfuse-retention] event=list_truncated oldest_age_basis=listed_prefix_only",
    )
  }
  if (
    result.oldestAgeDays !== undefined &&
    result.oldestAgeDays >= RETENTION_WALL_WARN_AGE_DAYS
  ) {
    console.warn(
      `[langfuse-retention] event=retention_wall_risk oldest_age_days=${result.oldestAgeDays}`,
    )
  }
  const counts = `listed=${result.listedObservations} traces=${result.uniqueTraces} delete_requests=${result.deleteRequests} deleted_submitted=${result.deletedSubmitted}`
  if (result.outcome === "failed") {
    const status = result.status !== undefined ? ` status=${result.status}` : ""
    console.warn(
      `[langfuse-retention] event=sweep_failed stage=${result.stage} reason=${result.reason}${status} ${counts}`,
    )
    return
  }
  if (result.outcome === "rate_limited") {
    const retryAfter =
      result.retryAfterSeconds !== undefined
        ? ` retry_after_s=${result.retryAfterSeconds}`
        : ""
    console.warn(
      `[langfuse-retention] event=sweep_rate_limited stage=${result.stage}${retryAfter} ${counts}`,
    )
    return
  }
  const oldest =
    result.oldestAgeDays !== undefined
      ? ` oldest_age_days=${result.oldestAgeDays}`
      : ""
  console.info(
    `[langfuse-retention] event=sweep_complete ${counts} carried_over=${result.uniqueTraces - result.deletedSubmitted}${oldest} list_truncated=${result.listTruncated ? 1 : 0}`,
  )
}

/**
 * Milliseconds from `nowMs` until the NEXT occurrence of `fireHourUtc`:00:00
 * UTC, strictly in the future — at exactly the firing instant the next fire
 * is tomorrow's, so a re-arm immediately after firing never re-fires today.
 * Pure and exported for the wall-clock scheduling tests.
 */
export function msUntilNextUtcFireHour(
  nowMs: number,
  fireHourUtc: number,
): number {
  const target = new Date(nowMs)
  target.setUTCHours(fireHourUtc, 0, 0, 0)
  let targetMs = target.getTime()
  if (targetMs <= nowMs) targetMs += DAY_MS
  return targetMs - nowMs
}

/**
 * Boot-time entry point: ARMS the once-daily wall-clock timer — it never
 * sweeps at boot, so a restart re-aims at the same firing hour instead of
 * spending delete budget (runs/day = 1 by construction; see the module
 * header). Every arm — boot and each post-fire re-arm — logs
 * `event=sweep_scheduled next_fire=<iso>` so a timer that never fires is
 * diagnosable from logs. Re-arming happens AFTER the sweep settles (the
 * timer chain, not an interval), so runs can never overlap in-process. A
 * failed run logs and waits for the next day's fire; it never crashes the
 * service. Timers are unref'd so they cannot hold the process open. No-ops
 * (returns null) with one quiet line unless the Langfuse credential trio is
 * configured — NOT gated on `LANGFUSE_TRACING_ENABLED` (see the module
 * header). The production-only gate lives at the call site in `index.ts`.
 */
export function startLangfuseTraceRetention({
  getConfig = getLangfuseTraceRetentionConfig,
  fetchImpl = fetch,
  fireHourUtc = LANGFUSE_TRACE_RETENTION_FIRE_HOUR_UTC,
  now = () => Date.now(),
}: {
  getConfig?: () => LangfuseConfig
  fetchImpl?: typeof fetch
  fireHourUtc?: number
  now?: () => number
} = {}): { stop: () => void } | null {
  const config = getConfig()
  if (!isLangfuseTraceRetentionConfigured(config)) {
    console.info(
      "[langfuse-retention] event=retention_disabled reason=config_missing",
    )
    return null
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  // UTC day (epoch days) of the last fire. Guards the runs/day = 1 premise
  // against a backward wall-clock step (NTP slew/step during the ~24h wait):
  // setTimeout waits on the MONOTONIC clock while the re-arm reads the WALL
  // clock, so a backward step landing before the firing hour could otherwise
  // aim the re-arm at the SAME UTC day and double that day's delete-budget
  // spend. In-memory on purpose — a restart forgets it, but a restart also
  // only ARMS (no sweep), so the premise survives.
  let lastFiredUtcDay: number | undefined
  const arm = () => {
    if (stopped) return
    const nowMs = now()
    let delayMs = msUntilNextUtcFireHour(nowMs, fireHourUtc)
    if (lastFiredUtcDay !== undefined) {
      while (Math.floor((nowMs + delayMs) / DAY_MS) <= lastFiredUtcDay) {
        delayMs += DAY_MS
      }
    }
    console.info(
      `[langfuse-retention] event=sweep_scheduled next_fire=${new Date(nowMs + delayMs).toISOString()}`,
    )
    timer = setTimeout(() => {
      lastFiredUtcDay = Math.floor(now() / DAY_MS)
      void runLangfuseTraceRetentionSweep({ config, fetchImpl, now })
        .then(logSweepResult)
        .catch(() => {
          // Count/enum-only logging — never the caught error (leak control).
          console.warn(
            "[langfuse-retention] event=sweep_failed reason=unexpected_error",
          )
        })
        .finally(arm)
    }, delayMs)
    timer.unref?.()
  }

  arm()
  return {
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
