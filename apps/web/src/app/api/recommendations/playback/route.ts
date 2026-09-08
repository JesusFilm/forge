import { z } from "zod"

import {
  claimSemanticRecommendationEpisode,
  issueWatchPlaybackContext,
  recordSemanticRecommendationPlayback,
} from "@/lib/recommendations"
import {
  RECOMMENDATION_EVIDENCE_CONTRACT,
  RECOMMENDATION_PLAYBACK_BODY_BYTES,
  RECOMMENDATION_PLAYBACK_EVENT_LIMIT,
  parseRecommendationEpisodeCapability,
} from "@/lib/recommendation-contracts"
import {
  RecommendationRouteError,
  readStrictRecommendationJson,
} from "@/lib/recommendation-route-policy"
import { assertRecommendationMutationAdmission } from "@/lib/recommendation-mutation-admission"
import {
  recommendationError,
  recommendationJson,
} from "@/lib/recommendation-route-response"
import {
  attachRecommendationSession,
  ensureRecommendationSession,
  readRecommendationSession,
} from "@/lib/recommendation-session"
import { WATCH_CANONICAL_ORIGIN } from "@/lib/routes"

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
          activeMilliseconds: z.number().int().min(0).max(60_000),
          coverage: z.enum(["complete", "partial"]),
          missingReason: z
            .enum(["visibility_unavailable", "player_state_unavailable"])
            .optional(),
        })
        .strict()
        .superRefine((payload, context) => {
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
    mediaId: identifier,
    discoverySource: z.enum([
      "direct",
      "search",
      "share",
      "acquisition",
      "editorial",
    ]),
    provenance: z
      .record(z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), z.string().max(191))
      .refine((value) => Object.keys(value).length <= 8),
  })
  .strict()

const FactsInput = z
  .object({
    action: z.literal("facts"),
    contractVersion: z.literal(RECOMMENDATION_EVIDENCE_CONTRACT),
    capability: z.string().min(1).max(4096),
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
  ContextInput,
  ClaimInput,
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
    if (parsed.data.action === "context") {
      await assertRecommendationMutationAdmission(
        request.headers,
        "playback-context",
      )
      const session = ensureRecommendationSession(request)
      const context = await issueWatchPlaybackContext({
        sessionDigest: session.digest,
        mediaId: parsed.data.mediaId,
        discoverySource: parsed.data.discoverySource,
        provenance: parsed.data.provenance,
      })
      const response = recommendationJson(context)
      attachRecommendationSession(response, session)
      return response
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

    const receipts = await recordSemanticRecommendationPlayback({
      contractVersion: parsed.data.contractVersion,
      capability: parsed.data.capability,
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
