// Shared route handler for the admin → manager enrichment trigger
// endpoints (`/api/admin-trigger/{scene-analysis,transcript}`,
// feat-119 PR2). Inverse direction of `admin-embed-route.ts`.
//
// Body shape:
//   { items: [{ assetId: number, coreId: string }, ...] }
//
// `assetId` is the operator-facing identifier + storage-key prefix
// manager uses when writing artifacts (`{assetId}/scene-analysis.json`,
// `{assetId}/embeddings.json`). `coreId` is admin's stable identifier
// for the same video.
//
// Per-id flow:
//   1. Admin lookup by coreId via `videosByCoreIds` GraphQL query →
//      derive { muxAssetId, subtitleUrl, label, primaryLanguageBcp47 }
//      (feat-125). Missing row → status "not_found". Missing mux or
//      subtitle → status "validation_failed".
//   2. Idempotency check against the in-memory map (5-minute TTL,
//      keyed by `${kind}:${assetId}`). Hit → return existing
//      managerJobId with status "already_in_flight".
//   3. Generate a new managerJobId, store in the map, dispatch via
//      `after()` background-task semantics. Status "started".
//
// Pre-feat-125 the lookup hit Strapi GraphQL via Apollo; admin owns
// the video catalogue now (R6 of the migration playbook), so the
// lookup moved to admin's `videosByCoreIds`. Manager keeps no
// Strapi coupling on this code path.
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
//   1. EnrichmentJob is keyed by Strapi documentId, not integer
//      assetId. Bridging would require an extra CMS round-trip per
//      call just to dedupe.
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

const IN_FLIGHT_TTL_MS = 5 * 60 * 1000

type InFlightEntry = { managerJobId: string; expiresAt: number }

// Module-level so it survives across requests on the same process.
const inFlightMap = new Map<string, InFlightEntry>()

function pruneExpired(now: number): void {
  for (const [key, entry] of inFlightMap) {
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
//   - row present, but muxAssetId
//     or subtitleUrl is null       → status "validation_failed"
//   - row complete                 → dispatch
// ---------------------------------------------------------------------------

type AdminLookupClient = (
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
  muxAssetId: string
  subtitleUrl: string
  videoLabel: string
  languageBcp47: string
}

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
        coreIds,
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
    // a row with null mux or subtitle as validation_failed —
    // operator-actionable signal that the upstream catalogue is
    // missing required dispatch data for this video.
    if (
      video.muxAssetId == null ||
      video.subtitleUrl == null ||
      video.primaryLanguageBcp47 == null
    ) {
      results.push({
        assetId: item.assetId,
        coreId: item.coreId,
        managerJobId: null,
        status: "validation_failed",
        message:
          "admin video missing required dispatch fields (primary-language subtitle or mux variant)",
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
    inFlightMap.set(key, {
      managerJobId,
      expiresAt: now + IN_FLIGHT_TTL_MS,
    })

    const dispatchInput: AdminTriggerDispatchInput = {
      assetId: item.assetId,
      coreId: item.coreId,
      muxAssetId: video.muxAssetId,
      subtitleUrl: video.subtitleUrl,
      videoLabel: video.label ?? "unknown",
      languageBcp47: video.primaryLanguageBcp47,
    }

    schedule(async () => {
      // Wrap the ENTIRE callback body in try/finally so the
      // in-flight slot is released regardless of where in the cb a
      // throw originates (the dispatch itself, the structured-log
      // JSON.stringify above the await, or any future side-effect
      // added between them). A naive `try { await dispatch } finally
      // { delete }` only covers the await path — a synchronous throw
      // earlier in the cb would leak the slot until TTL prune,
      // blocking re-triggers for up to 5 minutes.
      try {
        // Use console.warn (stderr) for structured runtime events —
        // Railway logsV2 silences console.log (stdout) from Next.js
        // App Router runtime handlers. See
        // docs/solutions/runtime-errors/railway-logsv2-silences-nextjs-stdout-runtime-20260518.md.
        console.warn(
          JSON.stringify({
            event: "admin-trigger.dispatch",
            kind: args.kind,
            assetId: item.assetId,
            coreId: item.coreId,
            managerJobId,
          }),
        )
        await args.dispatch(dispatchInput)
      } finally {
        // Release the in-flight slot once the dispatch settles
        // (success OR failure) so a re-trigger after pipeline
        // finish (operator decided to re-run) is allowed without
        // waiting out the TTL.
        inFlightMap.delete(key)
      }
    })

    results.push({
      assetId: item.assetId,
      coreId: item.coreId,
      managerJobId,
      status: "started",
    })
  }

  return NextResponse.json({ results }, { status: 200 })
}
