/**
 * The shared Admin operations mobile uses for source-free recommendations,
 * with the contract literals the payloads must carry. Mobile never sends
 * `sessionDigest`: that argument is the Web backend's authority, and Admin
 * rejects a request that mixes it with viewer tokens.
 */
import {
  adminClaimSemanticRecommendationEpisodeOperation,
  adminCreateRecommendationViewerOperation,
  adminIssueWatchPlaybackContextOperation,
  adminRecordSemanticRecommendationEvidenceOperation,
  adminRecordSemanticRecommendationPlaybackOperation,
  adminSelectSemanticRecommendationOperation,
  adminUpdateRecommendationViewerOperation,
  adminUserRecommendationsOperation,
} from "@forge/admin-graphql/operations"

export {
  adminClaimSemanticRecommendationEpisodeOperation as CLAIM_RECOMMENDATION_EPISODE,
  adminCreateRecommendationViewerOperation as CREATE_RECOMMENDATION_VIEWER,
  adminIssueWatchPlaybackContextOperation as ISSUE_WATCH_PLAYBACK_CONTEXT,
  adminRecordSemanticRecommendationEvidenceOperation as RECORD_RECOMMENDATION_EVIDENCE,
  adminRecordSemanticRecommendationPlaybackOperation as RECORD_RECOMMENDATION_PLAYBACK,
  adminSelectSemanticRecommendationOperation as SELECT_RECOMMENDATION,
  adminUpdateRecommendationViewerOperation as UPDATE_RECOMMENDATION_VIEWER,
  adminUserRecommendationsOperation as USER_RECOMMENDATIONS,
}

export {
  RECOMMENDATION_OPERATION_NAMES,
  isRecommendationOperation,
} from "./operationNames"

/** Every document mobile sends, keyed by its operation name (for guards). */
export const RECOMMENDATION_DOCUMENTS = {
  UserRecommendations: adminUserRecommendationsOperation,
  CreateRecommendationViewer: adminCreateRecommendationViewerOperation,
  UpdateRecommendationViewer: adminUpdateRecommendationViewerOperation,
  RecordSemanticRecommendationEvidence:
    adminRecordSemanticRecommendationEvidenceOperation,
  SelectSemanticRecommendation: adminSelectSemanticRecommendationOperation,
  ClaimSemanticRecommendationEpisode:
    adminClaimSemanticRecommendationEpisodeOperation,
  IssueWatchPlaybackContext: adminIssueWatchPlaybackContextOperation,
  RecordSemanticRecommendationPlayback:
    adminRecordSemanticRecommendationPlaybackOperation,
} as const

/** Evidence, selection and playback batches carry this contract version. */
export const RECOMMENDATION_EVIDENCE_CONTRACT = "recommendation-evidence-v1"

/** The delivery contract and surface the source-free slate answers with. */
export const USER_RECOMMENDATION_CONTRACT = "user-recommendation-v1"
export const WATCH_FOR_YOU_SURFACE = "watch-for-you-v1"

/** Admin bounds `count` to this range; the default matches the Web row. */
export const USER_RECOMMENDATION_DEFAULT_COUNT = 6
export const USER_RECOMMENDATION_MIN_COUNT = 1
export const USER_RECOMMENDATION_MAX_COUNT = 20
