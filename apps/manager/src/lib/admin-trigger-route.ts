// Shared route handler for the admin → manager enrichment trigger
// endpoints (`/api/admin-trigger/{scene-analysis,transcript}`,
// feat-119 PR2). Inverse direction of `admin-embed-route.ts`.
//
// Body shape:
//   { items: [{ assetId: number, coreId: string }, ...] }
//
// `assetId` is the operator-facing identifier + storage-key prefix
// manager uses when writing source artifacts (`{assetId}/scene-analysis.json`,
// `{assetId}/transcript.json`). Transcript embedding vectors are now produced
// by Mastra and written through Admin ingest, not by this route. `coreId` is
// admin's stable identifier for the same video.
//
// Per-id flow:
//   1. Admin lookup by coreId via `videosByCoreIds` GraphQL query →
//      derive { muxAssetId, subtitleUrl, label, primaryLanguageBcp47 }
//      (feat-125). Missing row → status "not_found". Missing required
//      fields for that trigger kind → status "validation_failed".
//   2. Idempotency check against the in-memory map (5-minute TTL,
//      keyed by `${kind}:${assetId}`). Hit → return existing
//      managerJobId with status "already_in_flight".
//   3. Generate a new managerJobId, store in the map, enqueue via
//      `after()` background-task semantics. Status "started".
//
// Admin owns the video catalogue now (R6 of the migration playbook),
// so this route resolves dispatch fields through Admin's
// `videosByCoreIds` contract and carries no legacy catalogue lookup path.
//
// The in-memory map is a deliberate deviation from plan D7 (which
// suggested querying EnrichmentJob). Rationale captured in the
// solutions doc and on the JSDoc above `inFlightMap` below.

import { after, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import {
  lookupVideosByCoreIdFromAdmin,
  type AdminVideoLookupEnvelope,
  type VideoForEnrichment,
} from "@/lib/admin-video-lookup"
import { validateAdminTriggerBearer } from "@/lib/admin-trigger-auth"

// ---------------------------------------------------------------------------
// Wire shape (validated with zod at the route boundary)
// ---------------------------------------------------------------------------

export const TriggerKindSchema = z.enum(["scene-analysis", "transcript"])
export type TriggerKind = z.infer<typeof TriggerKindSchema>

// NOT `.strict()` deliberately: per Postel's law for distributed
// systems, the receiver tolerates unknown fields so a future admin
// deploy can add an optional per-item field (e.g. priority) without
// requiring a coordinated lock-step rollout. The deploy-ordering
// invariant documented in the solutions doc is "receiver-first"
// (manager deploys ADMIN_TRIGGER_API_KEYS before admin sends), but
// that ordering only protects required-key additions; unknown-field
// tolerance is what protects optional-field additions.
export const AdminTriggerItemSchema = z.object({
  assetId: z.number().int().positive(),
  coreId: z.string().min(1),
})

export type AdminTriggerItem = z.infer<typeof AdminTriggerItemSchema>

export const AdminTriggerBodySchema = z
  .object({
    items: z
      .array(AdminTriggerItemSchema)
      .min(1, "at least one item required")
      .max(100, "max 100 items per call"),
  })
  .strict()
  .transform((parsed) => {
    // Dedupe by assetId — duplicate assetIds in a single call would
    // surface as repeated `already_in_flight` results which is
    // wasteful but technically correct. Dedupe at the boundary so
    // operators don't accidentally double-charge themselves.
    const seen = new Map<number, AdminTriggerItem>()
    for (const item of parsed.items) {
      if (!seen.has(item.assetId)) seen.set(item.assetId, item)
    }
    return { items: [...seen.values()] }
  })

export type AdminTriggerBody = z.infer<typeof AdminTriggerBodySchema>

// ---------------------------------------------------------------------------
// Per-id outcome envelope — discriminated by `status`.
// ---------------------------------------------------------------------------

export type AdminTriggerStatus =
  | "started"
  | "already_in_flight"
  | "not_found"
  | "validation_failed"

export type AdminTriggerResult = {
  assetId: number
  coreId: string
  managerJobId: string | null
  status: AdminTriggerStatus
  message?: string
}

// ---------------------------------------------------------------------------
// In-memory idempotency map (deviation from plan D7).
//
// Keyed by `${kind}:${assetId}`, value is `{ managerJobId,
// expiresAt }` with a 5-minute TTL. Pruned lazily on each lookup.
//
// Deliberately simpler than EnrichmentJob-backed idempotency because:
//   1. EnrichmentJob belongs to the legacy Manager job model, while this
//      Admin-trigger path is keyed by the source `assetId`. Bridging the two
//      models would reintroduce deleted catalogue coupling just to dedupe.
//   2. The existing `/api/scene-analysis` route does NOT create an
//      EnrichmentJob, so the table doesn't reflect "is a scene-
//      analysis pipeline currently running for this video?" anyway.
//   3. The realistic threat is operator double-click within seconds,
//      not multi-instance concurrency. Each Next.js instance has its
//      own map; on multi-instance deploys a double-fire produces two
//      pipeline runs that both write the same S3 key — wasteful but
//      not corrupting (S3 PUT is overwrite).
//
// If concurrency-correctness becomes load-bearing, swap to a
// DB-backed mechanism via a follow-up ticket. The shape behind
// `processAdminTriggerRequest` doesn't change.
// ---------------------------------------------------------------------------

const DEFAULT_DISPATCH_CONCURRENCY = 3
const DEFAULT_MAX_PENDING_DISPATCHES = 300

type InFlightEntry = { managerJobId: string; expiresAt: number | null }

// Module-level so it survives across requests on the same process.
const inFlightMap = new Map<string, InFlightEntry>()

type QueuedAdminTriggerJob = {
  kind: TriggerKind
  item: AdminTriggerItem
  managerJobId: string
  key: string
  dispatchInput: AdminTriggerDispatchInput
  dispatch: AdminTriggerDispatcher
  done: Promise<void>
  resolveDone: () => void
}

const dispatchQueue: QueuedAdminTriggerJob[] = []
let activeDispatches = 0
let dispatchConcurrency = DEFAULT_DISPATCH_CONCURRENCY
let maxPendingDispatches = DEFAULT_MAX_PENDING_DISPATCHES

function pruneExpired(now: number): void {
  for (const [key, entry] of inFlightMap) {
    if (entry.expiresAt == null) continue
    if (entry.expiresAt < now) inFlightMap.delete(key)
  }
}

function inFlightKey(kind: TriggerKind, assetId: number): string {
  return `${kind}:${assetId}`
}

/**
 * Test-only: clear the in-memory idempotency map. Exported so unit
 * tests can run isolated from each other without process restart.
 * Production code MUST NOT call this — it would erase legitimate
 * in-flight markers and re-enable double-dispatch.
 */
export function __clearInFlightMapForTests(): void {
  inFlightMap.clear()
  dispatchQueue.splice(0, dispatchQueue.length)
  activeDispatches = 0
  dispatchConcurrency = DEFAULT_DISPATCH_CONCURRENCY
  maxPendingDispatches = DEFAULT_MAX_PENDING_DISPATCHES
}

/**
 * Test-only: override queue width so unit tests can prove queuing
 * behavior without relying on the production cap.
 */
export function __setDispatchConcurrencyForTests(concurrency: number): void {
  dispatchConcurrency = Math.max(1, Math.floor(concurrency))
  drainDispatchQueue()
}

/**
 * Test-only: override the pending queue cap so tests can prove the
 * backpressure branch without filling hundreds of jobs.
 */
export function __setMaxPendingDispatchesForTests(maxPending: number): void {
  maxPendingDispatches = Math.max(1, Math.floor(maxPending))
}

function pendingDispatchCount(): number {
  return activeDispatches + dispatchQueue.length
}

function enqueueDispatch(job: QueuedAdminTriggerJob): Promise<void> {
  dispatchQueue.push(job)
  console.warn(
    JSON.stringify({
      event: "admin-trigger.dispatch.queued",
      kind: job.kind,
      assetId: job.item.assetId,
      coreId: job.item.coreId,
      managerJobId: job.managerJobId,
      queueDepth: dispatchQueue.length,
      activeDispatches,
    }),
  )
  drainDispatchQueue()
  return job.done
}

function drainDispatchQueue(): void {
  while (activeDispatches < dispatchConcurrency) {
    const job = dispatchQueue.shift()
    if (!job) return

    activeDispatches++
    void runQueuedDispatch(job)
  }
}

async function runQueuedDispatch(job: QueuedAdminTriggerJob): Promise<void> {
  try {
    // Use console.warn (stderr) for structured runtime events —
    // Railway logsV2 silences console.log (stdout) from Next.js
    // App Router runtime handlers. See
    // docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md.
    console.warn(
      JSON.stringify({
        event: "admin-trigger.dispatch.running",
        kind: job.kind,
        assetId: job.item.assetId,
        coreId: job.item.coreId,
        managerJobId: job.managerJobId,
        queueDepth: dispatchQueue.length,
        activeDispatches,
        dispatchConcurrency,
      }),
    )
    await job.dispatch(job.dispatchInput)
    console.warn(
      JSON.stringify({
        event: "admin-trigger.dispatch.complete",
        kind: job.kind,
        assetId: job.item.assetId,
        coreId: job.item.coreId,
        managerJobId: job.managerJobId,
      }),
    )
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "admin-trigger.dispatch.error",
        kind: job.kind,
        assetId: job.item.assetId,
        coreId: job.item.coreId,
        managerJobId: job.managerJobId,
        error: err instanceof Error ? err.message : String(err),
      }),
    )
  } finally {
    // Release the in-flight slot once the dispatch settles
    // (success OR failure) so a re-trigger after pipeline finish
    // (operator decided to re-run) is allowed without waiting out
    // the TTL.
    inFlightMap.delete(job.key)
    activeDispatches--
    job.resolveDone()
    drainDispatchQueue()
  }
}

// ---------------------------------------------------------------------------
// Admin lookup — batched by coreId (feat-125)
//
// The lookup helper lives in `admin-video-lookup.ts` and mirrors the
// shape of `admin-embed-trigger.ts` (the inverse direction). It hits
// admin's `videosByCoreIds` GraphQL query, which does the primary-
// language variant + subtitle picker server-side and returns a
// flat `VideoForEnrichment` row per coreId.
//
// Per coreId, manager classifies:
//   - row missing entirely         → status "not_found"
//   - row present, but required dispatch fields
//     are null                     → status "validation_failed"
//     (scene-analysis and transcript require mux; subtitle is used
//     directly when present and can otherwise be generated from Mux)
//   - row complete                 → dispatch
// ---------------------------------------------------------------------------

/**
 * @public Exported so test seams + future custom-client injections
 * can type-check against the lookup contract. The only production
 * caller passes `lookupVideosByCoreIdFromAdmin`; tests pass
 * inline mocks via `ProcessAdminTriggerArgs.adminLookup`.
 */
export type AdminLookupClient = (
  coreIds: readonly string[],
) => Promise<AdminVideoLookupEnvelope>

// ---------------------------------------------------------------------------
// Dispatch input (the manager-side invocation contract).
// Per kind: one of these shapes is what the kind-specific pipeline
// dispatcher receives.
// ---------------------------------------------------------------------------

export type AdminTriggerDispatchInput = {
  assetId: number
  coreId: string
  adminVideoId: string
  muxAssetId: string
  subtitleUrl: string
  videoLabel: string
  languageBcp47: string
}

// The resolved value isn't inspected by the route handler — only
// settlement/rejection. Keeping `Promise<unknown>` (rather than
// `Promise<void>`) lets each dispatcher return its pipeline's
// typed result object without an extra `async (input) => { await ...; }`
// wrapper at every call site.
export type AdminTriggerDispatcher = (
  input: AdminTriggerDispatchInput,
) => Promise<unknown>

// ---------------------------------------------------------------------------
// Shared processor — used by both kind routes.
// ---------------------------------------------------------------------------

export type ProcessAdminTriggerArgs = {
  request: Request
  kind: TriggerKind
  dispatch: AdminTriggerDispatcher
  // Test seam — defaults to the live `lookupVideosByCoreIdFromAdmin`
  // helper (fetch + bearer + AbortSignal.timeout). Override in tests
  // to inject a deterministic envelope.
  adminLookup?: AdminLookupClient
  scheduleAfter?: (cb: () => Promise<void>) => void
}

export async function processAdminTriggerRequest(
  args: ProcessAdminTriggerArgs,
): Promise<Response> {
  const auth = validateAdminTriggerBearer(args.request)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status })
  }

  let rawBody: unknown
  try {
    rawBody = await args.request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = AdminTriggerBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { items } = parsed.data
  const coreIds = items.map((i) => i.coreId)
  const adminLookup = args.adminLookup ?? lookupVideosByCoreIdFromAdmin
  const envelope = await adminLookup(coreIds)
  if (!envelope.ok) {
    // Surface admin's lookup failure with a clear reason so admin's
    // outbound classifier maps it to `DISPATCH_FAILED { reason:
    // "remote_5xx" }` rather than crashing on an empty-body 500.
    // `config_missing` is operator-fixable misconfig → 503; every
    // other reason is upstream-side and surfaces as 502 (matches
    // the `admin-embed-route.ts` envelope shape on the inverse
    // direction).
    console.error(
      JSON.stringify({
        event: "admin-trigger.admin-lookup.error",
        kind: args.kind,
        reason: envelope.reason,
        messages: envelope.messages,
        // Log only the cardinality, not the full coreIds list —
        // log-line size is bounded regardless of batch size, and
        // operational triage rarely needs the exact IDs (request
        // body is the source of truth).
        coreIdCount: coreIds.length,
      }),
    )
    const status = envelope.reason === "config_missing" ? 503 : 502
    return NextResponse.json(
      {
        error: "admin lookup failed",
        reason:
          envelope.reason === "config_missing"
            ? "config_missing"
            : "admin_unreachable",
        upstreamReason: envelope.reason,
        messages: envelope.messages,
        retryable: envelope.retryable,
      },
      { status },
    )
  }
  const videos: Map<string, VideoForEnrichment> = envelope.data

  const now = Date.now()
  pruneExpired(now)

  const schedule =
    args.scheduleAfter ??
    ((cb: () => Promise<void>) => {
      after(async () => {
        try {
          await cb()
        } catch (err) {
          console.error(
            JSON.stringify({
              event: "admin-trigger.dispatch.error",
              kind: args.kind,
              error: err instanceof Error ? err.message : String(err),
            }),
          )
        }
      })
    })

  const results: AdminTriggerResult[] = []
  const queuedJobs: QueuedAdminTriggerJob[] = []

  for (const item of items) {
    const video = videos.get(item.coreId)
    if (!video) {
      results.push({
        assetId: item.assetId,
        coreId: item.coreId,
        managerJobId: null,
        status: "not_found",
        message: "admin returned no video for coreId",
      })
      continue
    }

    // Admin's `videosByCoreIds` resolver does the primary-language
    // variant + best-subtitle picker server-side. Manager classifies
    // a row with null mux or primary language as validation_failed —
    // operator-actionable signal that the upstream catalogue is
    // missing required dispatch data for this video. Name the
    // specific gap(s) so operators don't chase the wrong upstream
    // signal — primary-language absence cascades into null
    // mux/subtitle via the picker, so reporting only the symptom
    // would hide the real data gap.
    if (video.muxAssetId == null || video.primaryLanguageBcp47 == null) {
      const missing: string[] = []
      if (video.primaryLanguageBcp47 == null) missing.push("primary language")
      if (video.muxAssetId == null) missing.push("mux variant")
      results.push({
        assetId: item.assetId,
        coreId: item.coreId,
        managerJobId: null,
        status: "validation_failed",
        message: `admin video missing required dispatch fields (${missing.join(", ")})`,
      })
      continue
    }

    const key = inFlightKey(args.kind, item.assetId)
    const existing = inFlightMap.get(key)
    if (existing) {
      results.push({
        assetId: item.assetId,
        coreId: item.coreId,
        managerJobId: existing.managerJobId,
        status: "already_in_flight",
      })
      continue
    }

    const managerJobId = randomUUID()

    const dispatchInput: AdminTriggerDispatchInput = {
      assetId: item.assetId,
      coreId: item.coreId,
      adminVideoId: video.id,
      muxAssetId: video.muxAssetId,
      subtitleUrl: video.subtitleUrl ?? "",
      videoLabel: video.label ?? "unknown",
      languageBcp47: video.primaryLanguageBcp47,
    }

    let resolveDone: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    queuedJobs.push({
      kind: args.kind,
      item,
      managerJobId,
      key,
      dispatchInput,
      dispatch: args.dispatch,
      done,
      resolveDone,
    })

    results.push({
      assetId: item.assetId,
      coreId: item.coreId,
      managerJobId,
      status: "started",
    })
  }

  const pendingAfterThisRequest = pendingDispatchCount() + queuedJobs.length
  if (pendingAfterThisRequest > maxPendingDispatches) {
    console.error(
      JSON.stringify({
        event: "admin-trigger.dispatch.queue_full",
        kind: args.kind,
        itemCount: queuedJobs.length,
        queueDepth: dispatchQueue.length,
        activeDispatches,
        maxPendingDispatches,
      }),
    )
    return NextResponse.json(
      {
        error: "manager dispatch queue full",
        retryable: true,
        queueDepth: dispatchQueue.length,
        activeDispatches,
        maxPendingDispatches,
      },
      { status: 503 },
    )
  }

  if (queuedJobs.length > 0) {
    for (const job of queuedJobs) {
      inFlightMap.set(job.key, {
        managerJobId: job.managerJobId,
        expiresAt: null,
      })
      console.warn(
        JSON.stringify({
          event: "admin-trigger.dispatch.accepted",
          kind: job.kind,
          assetId: job.item.assetId,
          coreId: job.item.coreId,
          managerJobId: job.managerJobId,
        }),
      )
    }

    schedule(async () => {
      await Promise.all(queuedJobs.map((job) => enqueueDispatch(job)))
    })
  }

  return NextResponse.json({ results }, { status: 200 })
}
