import { adminGraphql } from "../index"

export const adminUserRecommendationsQuery = `
  query UserRecommendations($locale: String!, $audioLanguageSlug: String!, $count: Int,
    $viewerToken: String, $sessionToken: String, $sessionDigest: String,
    $consentReceiptDigest: String, $profileTokenDigest: String) {
    userRecommendations(locale: $locale, audioLanguageSlug: $audioLanguageSlug, count: $count,
      viewerToken: $viewerToken, sessionToken: $sessionToken, sessionDigest: $sessionDigest,
      consentReceiptDigest: $consentReceiptDigest, profileTokenDigest: $profileTokenDigest) {
      contractVersion surfaceVersion requestId result reason expiresAt requestedCount profileCount curatedCount cohort poolVersion
      items { id position targetMediaId canonicalHref capability videoSlug videoTitle imageUrl description durationSeconds generator poolVersion poolKey }
    }
  }
`
export const adminUserRecommendationsOperation = adminGraphql(
  adminUserRecommendationsQuery,
)

export const adminCreateRecommendationViewerMutation = `
  mutation CreateRecommendationViewer {
    createRecommendationViewer { viewerToken sessionToken expiresAt personalization }
  }
`
export const adminCreateRecommendationViewerOperation = adminGraphql(
  adminCreateRecommendationViewerMutation,
)

export const adminUpdateRecommendationViewerMutation = `
  mutation UpdateRecommendationViewer($viewerToken: String!, $sessionToken: String!, $action: String!) {
    updateRecommendationViewer(viewerToken: $viewerToken, sessionToken: $sessionToken, action: $action) {
      state personalization
    }
  }
`
export const adminUpdateRecommendationViewerOperation = adminGraphql(
  adminUpdateRecommendationViewerMutation,
)
