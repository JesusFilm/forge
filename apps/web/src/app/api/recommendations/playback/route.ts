import { z } from "zod"

import {
  claimSemanticRecommendationEpisode,
  openRecommendationPlaybackContext,
  recordSemanticRecommendationPlayback,
} from "@/lib/recommendations"
import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECOMMENDATION_PLAYBACK_CONTEXT_CONTRACT,
  RECOMMENDATION_PLAYBACK_BODY_BYTES,
  RECOMMENDATION_PLAYBACK_EVENT_LIMIT,
  RECOMMENDATION_PLAYBACK_SOURCES,
  parseRecommendationEpisodeCapability,
} from "@/lib/recommendation-contracts"
import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import { readRecommendationSession } from "@/lib/recommendation-session"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"

export const dynamic = "force-dynamic"
export const revalidate = 0

const identifier = z.string().min(1).max(191)
const occurredAt = z.string().datetime({ offset: true })
const positionSeconds = z.number().finite().min(0).max(86_400)
const durationSeconds = z.number().finite().positive().max(86_400)
const progress = z.number().finite().min(0).max(1)
const wallElapsedMilliseconds = z
  .number()
  .int()
  .min(0)
  .max(6 * 60 * 60 * 1_000)
const eventBase = { eventId: identifier, occurredAt } as const

const PlaybackEvent = z.discriminatedUnion("kind", [
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_attempt"),
      payload: z
        .object({ initiation: z.enum(["manual", "automatic"]) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_start"),
      payload: z.object({ positionSeconds }).strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_progress"),
      payload: z
        .object({
          positionSeconds,
          durationSeconds: durationSeconds.nullable(),
          progress: progress.nullable(),
          wallElapsedMilliseconds,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_seek"),
      payload: z
        .object({ fromSeconds: positionSeconds, toSeconds: positionSeconds })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_active_visible_playing"),
      payload: z
        .object({
          activeMilliseconds: z.number().int().min(0).max(60_000).optional(),
          startedAt: occurredAt.optional(),
          endedAt: occurredAt.optional(),
          coverage: z.enum(["complete", "partial"]),
          missingReason: z
            .enum(["visibility_unavailable", "player_state_unavailable"])
            .optional(),
        })
        .strict()
        .superRefine((payload, context) => {
          const exact = payload.startedAt != null && payload.endedAt != null
          if (
            (payload.startedAt == null) !== (payload.endedAt == null) ||
            (!exact && payload.activeMilliseconds == null)
          ) {
            context.addIssue({ code: "custom" })
          }
          if (exact) {
            const startedAt = Date.parse(payload.startedAt!)
            const endedAt = Date.parse(payload.endedAt!)
            if (endedAt <= startedAt || endedAt - startedAt > 60_000) {
              context.addIssue({ code: "custom" })
            }
          }
          const valid =
            (payload.coverage === "complete" &&
              payload.missingReason == null) ||
            (payload.coverage === "partial" && payload.missingReason != null)
          if (!valid) context.addIssue({ code: "custom" })
        }),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_end"),
      payload: z
        .object({
          reason: z.enum(["ended", "route_exit", "pagehide", "hidden"]),
          positionSeconds,
          durationSeconds: durationSeconds.nullable(),
          progress: progress.nullable(),
          completed: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_error"),
      payload: z
        .object({
          code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
          positionSeconds,
        })
        .strict(),
    })
    .strict(),
])

const ClaimInput = z
  .object({
    action: z.literal("claim"),
    claimNonce: identifier,
    mediaId: identifier,
  })
  .strict()

const ContextInput = z
  .object({
    action: z.literal("context"),
    contractVersion: z.literal(RECOMMENDATION_PLAYBACK_CONTEXT_CONTRACT),
    mediaId: identifier,
    idempotencyKey: z.string().min(16).max(191),
    source: z.enum(RECOMMENDATION_PLAYBACK_SOURCES),
    sourceRef: identifier.optional(),
    claimNonce: identifier.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.source === "recommendation" && input.claimNonce == null) ||
      (input.source !== "recommendation" && input.claimNonce != null)
    ) {
      context.addIssue({ code: "custom" })
    }
  })

const FactsInput = z
  .object({
    action: z.literal("facts"),
    contractVersion: z.literal(RECOMMENDATION_EVIDENCE_CONTRACT),
    capability: z.string().min(1).max(4096),
    contextId: identifier.optional(),
    episodeId: identifier,
    mediaId: identifier,
    events: z
      .array(PlaybackEvent)
      .min(1)
      .max(RECOMMENDATION_PLAYBACK_EVENT_LIMIT),
  })
  .strict()
  .superRefine((batch, context) => {
    const ids = new Set<string>()
    for (const [index, event] of batch.events.entries()) {
      if (ids.has(event.eventId)) {
        context.addIssue({ code: "custom", path: ["events", index, "eventId"] })
      }
      ids.add(event.eventId)
    }
  })

const PlaybackInput = z.discriminatedUnion("action", [
  ClaimInput,
  ContextInput,
  FactsInput,
])

export async function POST(request: Request) {
  try {
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_PLAYBACK_BODY_BYTES,
    })
    const parsed = PlaybackInput.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    const session = readRecommendationSession(request)
    if (!session) {
      throw new RecommendationRouteError(401, "recommendation_session_required")
    }

    if (parsed.data.action === "claim") {
      const result = await claimSemanticRecommendationEpisode({
        sessionDigest: session.digest,
        claimNonce: parsed.data.claimNonce,
        mediaId: parsed.data.mediaId,
      })
      const episode = parseRecommendationEpisodeCapability(result)
      if (!episode) {
        throw new RecommendationRouteError(502, "invalid_admin_response")
      }
      return recommendationJson({ episode })
    }

    if (parsed.data.action === "context") {
      await assertRecommendationMutationAdmission(
        request.headers,
        "playback-context",
      )
      const result = await openRecommendationPlaybackContext({
        contractVersion: parsed.data.contractVersion,
        sessionDigest: session.digest,
        mediaId: parsed.data.mediaId,
        idempotencyKey: parsed.data.idempotencyKey,
        source: parsed.data.source,
        sourceRef: parsed.data.sourceRef ?? null,
        claimNonce: parsed.data.claimNonce ?? null,
      })
      const episode = parseRecommendationEpisodeCapability(result)
      if (!episode) {
        throw new RecommendationRouteError(502, "invalid_admin_response")
      }
      return recommendationJson({ episode })
    }

    const receipts = await recordSemanticRecommendationPlayback({
      contractVersion: parsed.data.contractVersion,
      capability: parsed.data.capability,
      contextId: parsed.data.contextId ?? null,
      episodeId: parsed.data.episodeId,
      mediaId: parsed.data.mediaId,
      events: parsed.data.events,
      sessionDigest: session.digest,
    })
    return recommendationJson({ receipts })
  } catch (error) {
    return recommendationError(error)
  }
}
