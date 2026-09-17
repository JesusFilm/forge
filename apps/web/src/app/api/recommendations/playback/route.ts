import { observeEvidenceResponse } from "@/lib/recommendation-evidence-response"
import { assertRecommendationHumanAdmission } from "@/lib/recommendation-human-admission"
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
      kind: z.literal("playback_viewing_mode"),
      payload: z
        .object({
          version: z.literal("sound-off-viewing-v1"),
          mode: z.enum(["sound_off", "sound_on"]),
          preview: z.boolean(),
          activeMilliseconds: z.number().int().min(1).max(60_000),
          fromSeconds: positionSeconds,
          toSeconds: positionSeconds,
          durationSeconds: durationSeconds.nullable(),
          playbackRate: z.number().finite().min(0.25).max(4),
        })
        .strict()
        .refine(
          (value) =>
            value.toSeconds > value.fromSeconds &&
            value.toSeconds - value.fromSeconds <=
              (value.activeMilliseconds / 1_000) * value.playbackRate + 0.5,
        ),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_attempt"),
      payload: z
        .object({
          initiation: z.enum(["manual", "automatic"]),
        })
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
      kind: z.literal("playback_observation"),
      payload: z
        .object({
          version: z.literal("playback-observations-v1"),
          elapsedMilliseconds: wallElapsedMilliseconds,
          visibility: z.enum(["visible", "hidden", "unknown"]),
          playerState: z.enum(["playing", "paused", "buffering", "unknown"]),
          startObserved: z.boolean(),
          errorObserved: z.boolean(),
          seekCount: z.number().int().min(0).max(65535),
          navigationCount: z.number().int().min(0).max(65535),
          qoeCount: z.number().int().min(0).max(65535),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_navigation"),
      payload: z
        .object({
          action: z.enum([
            "pause",
            "resume",
            "hidden",
            "visible",
            "bfcache_suspend",
            "bfcache_resume",
          ]),
          cause: z.literal("unknown"),
          positionSeconds,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("playback_qoe"),
      payload: z
        .object({
          action: z.enum(["waiting", "stalled", "buffering_end"]),
          cause: z.literal("unknown"),
          positionSeconds,
        })
        .strict(),
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
  let action: "playback" | "context" | "claim" | "facts" = "playback"
  try {
    assertRecommendationHumanAdmission(request)
    const raw = await readStrictRecommendationJson(request, {
      expectedOrigin: WATCH_CANONICAL_ORIGIN,
      maxBytes: RECOMMENDATION_PLAYBACK_BODY_BYTES,
    })
    const parsed = PlaybackInput.safeParse(raw)
    if (!parsed.success) {
      throw new RecommendationRouteError(400, "invalid_body")
    }
    action = parsed.data.action
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
      observeEvidenceResponse(request, action, response.status)
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
      observeEvidenceResponse(request, action, 200)
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
    observeEvidenceResponse(request, action, 200, undefined, receipts)
    return recommendationJson({ receipts })
  } catch (error) {
    const response = recommendationError(error)
    observeEvidenceResponse(request, action, response.status, error)
    return response
  }
}
