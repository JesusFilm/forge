// Shared route handler for the admin → manager enrichment trigger
// endpoints (`/api/admin-trigger/{scene-analysis,transcript}`,
// feat-119 PR2). Inverse direction of `admin-embed-route.ts`.
//
// Body shape:
//   { items: [{ assetId: number, coreId: string }, ...] }
//
// `assetId` is the integer cms videos.id (Strapi numeric PK), used
// here only as the operator-facing identifier and the storage-key
// prefix manager uses when writing artifacts. The Strapi v5 GraphQL
// surface does NOT expose a numeric `id` filter on `Video`
// (`VideoFiltersInput` only has `documentId` + `coreId`), so the
// CMS lookup uses `coreId`. Admin already has both fields in PR1's
// `missingArtifacts: [{ assetId, coreId, kind }]` projection — the
// wire payload mirrors that shape so the wiring is straight-through.
//
// Per-id flow:
//   1. CMS lookup by coreId → derive { documentId, muxAssetId,
//      subtitleUrl, label, languageBcp47 }. Missing → status
//      "not_found".
//   2. Idempotency check against the in-memory map (5-minute TTL,
//      keyed by `${kind}:${assetId}`). Hit → return existing
//      managerJobId with status "already_in_flight".
//   3. Generate a new managerJobId, store in the map, dispatch via
//      `after()` background-task semantics. Status "started".
//
// The in-memory map is a deliberate deviation from plan D7 (which
// suggested querying EnrichmentJob). Rationale captured in the
// solutions doc and on the JSDoc above `inFlightMap` below.

import { after, NextResponse } from "next/server"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import getClient from "@/cms/client"
import { graphql, type ResultOf } from "@forge/graphql"
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
// CMS lookup — batched by coreId
// ---------------------------------------------------------------------------

/**
 * Strapi v5 videos lookup keyed by coreId. Returns the fields
 * needed to dispatch the scene-analysis or transcript pipeline.
 * Variants and subtitles are returned with relations populated so
 * the dispatcher can pick a primary-language variant + subtitle.
 */
const GET_VIDEOS_FOR_ENRICHMENT = graphql(`
  query GetVideosForAdminTrigger($coreIds: [String]) {
    videos(filters: { coreId: { in: $coreIds } }, pagination: { limit: 100 }) {
      documentId
      coreId
      title
      label
      primaryLanguage {
        coreId
        bcp47
      }
      subtitles(pagination: { limit: -1 }) {
        primary
        aiGenerated
        vttSrc
        language {
          coreId
          bcp47
        }
      }
      variants(pagination: { limit: -1 }) {
        muxVideo {
          assetId
        }
        language {
          coreId
          bcp47
        }
      }
    }
  }
`)

export type CmsVideoForEnrichment = NonNullable<
  ResultOf<typeof GET_VIDEOS_FOR_ENRICHMENT>["videos"][number]
>

/**
 * Resolve the dispatch input fields from a CMS video. Returns
 * `null` when the video is missing the required relations
 * (subtitles in the primary language, primary-language variant
 * with a Mux asset id) — the per-id outcome will be
 * `not_found` in that case.
 *
 * Picks the primary-language variant + subtitle. Prefers
 * `primary === true` and non-aiGenerated subtitles when multiple
 * candidates exist for the same language.
 */
export function resolveDispatchFields(video: CmsVideoForEnrichment): {
  muxAssetId: string
  subtitleUrl: string
  videoLabel: string
  languageBcp47: string
} | null {
  const primaryBcp47 = video.primaryLanguage?.bcp47
  if (!primaryBcp47) return null

  const variantWithMux = (video.variants ?? []).find(
    (v) =>
      v != null &&
      v.language?.bcp47 === primaryBcp47 &&
      typeof v.muxVideo?.assetId === "string" &&
      v.muxVideo.assetId.length > 0,
  )
  const muxAssetId = variantWithMux?.muxVideo?.assetId
  if (!muxAssetId) return null

  const subtitleCandidates = (video.subtitles ?? []).filter(
    (
      s,
    ): s is NonNullable<typeof s> & {
      vttSrc: string
      language: { bcp47: string }
    } =>
      s != null &&
      typeof s.vttSrc === "string" &&
      s.vttSrc.length > 0 &&
      s.language?.bcp47 === primaryBcp47,
  )
  // Prefer primary + non-AI; fall back to any candidate in the
  // primary language. Stable order so test assertions are
  // deterministic.
  subtitleCandidates.sort((a, b) => {
    const aScore = (a.primary ? 0 : 1) + (a.aiGenerated ? 1 : 0)
    const bScore = (b.primary ? 0 : 1) + (b.aiGenerated ? 1 : 0)
    return aScore - bScore
  })
  const subtitle = subtitleCandidates[0]
  if (!subtitle) return null

  return {
    muxAssetId,
    subtitleUrl: subtitle.vttSrc,
    videoLabel: video.label ?? "unknown",
    languageBcp47: primaryBcp47,
  }
}

type LookupClient = {
  query: (vars: {
    query: typeof GET_VIDEOS_FOR_ENRICHMENT
    variables: { coreIds: string[] }
    fetchPolicy: "no-cache"
  }) => Promise<{ data?: ResultOf<typeof GET_VIDEOS_FOR_ENRICHMENT> }>
}

// Bound the cms lookup so a hung Strapi can't pin manager request
// workers indefinitely. Admin's outbound client uses a 15s ceiling
// (apps/admin/src/services/manager-trigger.service.ts), so the cms
// lookup must finish in well under that to leave room for the
// trigger response itself. 10s is generous for a 100-row coreId
// filter against Strapi v5's flat videos query.
const CMS_LOOKUP_TIMEOUT_MS = 10_000

async function lookupVideosByCoreId(
  coreIds: string[],
  client?: LookupClient,
): Promise<Map<string, CmsVideoForEnrichment>> {
  const apollo = client ?? (getClient() as unknown as LookupClient)
  const queryPromise = apollo.query({
    query: GET_VIDEOS_FOR_ENRICHMENT,
    variables: { coreIds },
    fetchPolicy: "no-cache",
  })
  const result = await Promise.race([
    queryPromise,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(
          Object.assign(
            new Error(`cms lookup timed out after ${CMS_LOOKUP_TIMEOUT_MS}ms`),
            { name: "TimeoutError" },
          ),
        )
      }, CMS_LOOKUP_TIMEOUT_MS)
      // Don't keep the event loop alive on this timer if the query
      // resolves first (Promise.race ignores the loser).
      timer.unref?.()
    }),
  ])
  const out = new Map<string, CmsVideoForEnrichment>()
  for (const video of result.data?.videos ?? []) {
    if (video?.coreId) out.set(video.coreId, video)
  }
  return out
}

// ---------------------------------------------------------------------------
// Dispatch input (the manager-side invocation contract).
// Per kind: one of these shapes is what the kind-specific pipeline
// dispatcher receives.
// ---------------------------------------------------------------------------

export type AdminTriggerDispatchInput = {
  assetId: number
  coreId: string
  documentId: string
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
  // Test seam — defaults to the live Apollo client + Next's after().
  cmsClient?: LookupClient
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
  let videos: Map<string, CmsVideoForEnrichment>
  try {
    videos = await lookupVideosByCoreId(coreIds, args.cmsClient)
  } catch (error) {
    // Apollo / network failure during the cms lookup. Surface a
    // 502 with a clear reason so the admin-side outbound client
    // maps it to `DISPATCH_FAILED { reason: "remote_5xx" }` rather
    // than crashing on an empty-body 500.
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      JSON.stringify({
        event: "admin-trigger.cms-lookup.error",
        kind: args.kind,
        coreIds,
        error: message,
      }),
    )
    return NextResponse.json(
      {
        error: "cms lookup failed",
        reason: "cms_unreachable",
        message,
      },
      { status: 502 },
    )
  }

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
        message: "cms video not found for coreId",
      })
      continue
    }

    const fields = resolveDispatchFields(video)
    if (!fields) {
      results.push({
        assetId: item.assetId,
        coreId: item.coreId,
        managerJobId: null,
        status: "validation_failed",
        message:
          "cms video missing required dispatch fields (primary-language subtitle or mux variant)",
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
      documentId: video.documentId,
      muxAssetId: fields.muxAssetId,
      subtitleUrl: fields.subtitleUrl,
      videoLabel: fields.videoLabel,
      languageBcp47: fields.languageBcp47,
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
        console.log(
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
