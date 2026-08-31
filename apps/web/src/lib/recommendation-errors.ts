export type RecommendationRuntimeErrorCode =
  | "delivery_unavailable"
  | "evidence_unavailable"
  | "selection_unavailable"
  | "episode_unavailable"
  | "playback_unavailable"
  | "content_action_unavailable"
  | "profile_unavailable"
  | "claim_invalid"
  | "evidence_failed"
  | "deadline"
  | "request_failed"

const MESSAGE_BY_CODE: Record<RecommendationRuntimeErrorCode, string> = {
  delivery_unavailable: "Semantic recommendation delivery unavailable",
  evidence_unavailable: "Semantic recommendation evidence unavailable",
  selection_unavailable: "Semantic recommendation selection unavailable",
  episode_unavailable: "Semantic recommendation episode unavailable",
  playback_unavailable: "Semantic recommendation playback unavailable",
  content_action_unavailable: "Recommendation content action unavailable",
  profile_unavailable: "Recommendation profile control unavailable",
  claim_invalid: "Semantic recommendation claim is invalid",
  evidence_failed: "Semantic recommendation evidence failed",
  deadline: "Semantic recommendation request deadline exceeded",
  request_failed: "Semantic recommendation request failed",
}

export class RecommendationRuntimeError extends Error {
  constructor(readonly code: RecommendationRuntimeErrorCode) {
    super(MESSAGE_BY_CODE[code])
    this.name = "RecommendationRuntimeError"
  }
}
