export const SEMANTIC_RECOMMENDATION_CONTRACT =
  "semantic-recommendation-v1" as const
export const RECOMMENDATION_EVIDENCE_CONTRACT =
  "recommendation-evidence-v1" as const
export const RECOMMENDATION_CONTENT_ACTION_CONTRACT =
  "recommendation-content-action-v1" as const
export const RECOMMENDATION_PROFILE_CONTRACT =
  "recommendation-profile-v1" as const
export const WATCH_RECOMMENDATION_SURFACE = "watch-below-player-v1" as const
export const CONTEXTUAL_RECOMMENDATION_FALLBACK_CAPABILITY =
  "contextual-fallback-unattributed-v1" as const
export const RECOMMENDATION_TAB_CORRELATION_KEY =
  "forge.recommendation.tab-correlation-v1" as const

export const RECOMMENDATION_EVIDENCE_BODY_BYTES = 8 * 1024
export const RECOMMENDATION_PLAYBACK_EVENT_LIMIT = 16
export const RECOMMENDATION_PLAYBACK_BODY_BYTES =
  RECOMMENDATION_EVIDENCE_BODY_BYTES
export const RECOMMENDATION_CONTENT_ACTION_BODY_BYTES = 2 * 1024
export const RECOMMENDATION_PROFILE_BODY_BYTES = 1024

export type RecommendationEpisodeCapability = {
  episodeId: string
  capability: string
  activeUntil: string
  hardUntil: string
}

export function parseRecommendationEpisodeCapability(
  value: unknown,
): RecommendationEpisodeCapability | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const episode = value as Record<string, unknown>
  const activeUntil =
    typeof episode.activeUntil === "string"
      ? Date.parse(episode.activeUntil)
      : Number.NaN
  const hardUntil =
    typeof episode.hardUntil === "string"
      ? Date.parse(episode.hardUntil)
      : Number.NaN
  if (
    typeof episode.episodeId !== "string" ||
    episode.episodeId.length < 1 ||
    episode.episodeId.length > 191 ||
    typeof episode.capability !== "string" ||
    episode.capability.length < 1 ||
    episode.capability.length > 4096 ||
    !Number.isFinite(activeUntil) ||
    !Number.isFinite(hardUntil) ||
    hardUntil < activeUntil
  ) {
    return null
  }
  return {
    episodeId: episode.episodeId,
    capability: episode.capability,
    activeUntil: episode.activeUntil as string,
    hardUntil: episode.hardUntil as string,
  }
}

export type RecommendationPlaybackEvent =
  | {
      eventId: string
      kind: "playback_attempt"
      occurredAt: string
      payload: { initiation: "manual" | "automatic" }
    }
  | {
      eventId: string
      kind: "playback_start"
      occurredAt: string
      payload: { positionSeconds: number }
    }
  | {
      eventId: string
      kind: "playback_progress"
      occurredAt: string
      payload: {
        positionSeconds: number
        durationSeconds: number | null
        progress: number | null
        wallElapsedMilliseconds: number
      }
    }
  | {
      eventId: string
      kind: "playback_seek"
      occurredAt: string
      payload: { fromSeconds: number; toSeconds: number }
    }
  | {
      eventId: string
      kind: "playback_active_visible_playing"
      occurredAt: string
      payload:
        | { activeMilliseconds: number; coverage: "complete" }
        | {
            activeMilliseconds: number
            coverage: "partial"
            missingReason: "visibility_unavailable" | "player_state_unavailable"
          }
    }
  | {
      eventId: string
      kind: "playback_end"
      occurredAt: string
      payload: {
        reason: "ended" | "route_exit" | "pagehide" | "hidden"
        positionSeconds: number
        durationSeconds: number | null
        progress: number | null
        completed: boolean
      }
    }
  | {
      eventId: string
      kind: "playback_error"
      occurredAt: string
      payload: { code: string; positionSeconds: number }
    }
