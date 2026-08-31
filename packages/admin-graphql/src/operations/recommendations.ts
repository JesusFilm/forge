import { adminGraphql } from "../index"

export const adminSemanticRecommendationDeliveryQuery = `
  query SemanticRecommendationDelivery(
    $seedMediaId: ID!
    $locale: String!
    $audioLanguageSlug: String!
    $sessionDigest: String!
    $consentReceiptDigest: String
    $profileTokenDigest: String
    $eligibleHuman: Boolean
  ) {
    semanticRecommendationDelivery(
      seedMediaId: $seedMediaId
      locale: $locale
      audioLanguageSlug: $audioLanguageSlug
      sessionDigest: $sessionDigest
      consentReceiptDigest: $consentReceiptDigest
      profileTokenDigest: $profileTokenDigest
      eligibleHuman: $eligibleHuman
    ) {
      contractVersion
      surfaceVersion
      strategyVersion
      classifierVersion
      requestId
      result
      reason
      expiresAt
      requestedCount
      composedCount
      shortfallReason
      personalization {
        contractVersion
        lane
        executionMode
        effectiveManifestId
        profileState
        projectionVersion
        projectionGeneration
        interestCount
        sessionIntentPresent
        reason
      }
      items {
        id
        position
        targetMediaId
        canonicalHref
        candidateGenerator
        contributors {
          generator
          generatorVersion
          rank
        }
        capability
        videoSlug
        videoTitle
        imageUrl
        sceneIndex
        description
        startSeconds
        endSeconds
        durationSeconds
        similarity
        themes
        demographics
        spiritualContext
        playbackId
      }
    }
  }
` as const

export const adminSemanticRecommendationDeliveryOperation = adminGraphql(
  adminSemanticRecommendationDeliveryQuery,
)

export const adminRecordSemanticRecommendationEvidenceMutation = `
  mutation RecordSemanticRecommendationEvidence(
    $contractVersion: String!
    $capability: String!
    $requestId: ID!
    $itemId: ID!
    $sessionDigest: String!
    $events: [RecommendationEvidenceEventInput!]!
  ) {
    recordSemanticRecommendationEvidence(
      contractVersion: $contractVersion
      capability: $capability
      requestId: $requestId
      itemId: $itemId
      sessionDigest: $sessionDigest
      events: $events
    ) {
      eventId
      status
    }
  }
` as const

export const adminRecordSemanticRecommendationEvidenceOperation = adminGraphql(
  adminRecordSemanticRecommendationEvidenceMutation,
)

export const adminSelectSemanticRecommendationMutation = `
  mutation SelectSemanticRecommendation(
    $contractVersion: String!
    $capability: String!
    $requestId: ID!
    $itemId: ID!
    $sessionDigest: String!
    $eventId: String!
    $occurredAt: String!
    $tabDigest: String
  ) {
    selectSemanticRecommendation(
      contractVersion: $contractVersion
      capability: $capability
      requestId: $requestId
      itemId: $itemId
      sessionDigest: $sessionDigest
      eventId: $eventId
      occurredAt: $occurredAt
      tabDigest: $tabDigest
    ) {
      status
      claimNonce
      canonicalHref
      targetMediaId
    }
  }
` as const

export const adminSelectSemanticRecommendationOperation = adminGraphql(
  adminSelectSemanticRecommendationMutation,
)

export const adminClaimSemanticRecommendationEpisodeMutation = `
  mutation ClaimSemanticRecommendationEpisode(
    $sessionDigest: String!
    $claimNonce: String!
    $mediaId: ID!
  ) {
    claimSemanticRecommendationEpisode(
      sessionDigest: $sessionDigest
      claimNonce: $claimNonce
      mediaId: $mediaId
    ) {
      episodeId
      capability
      activeUntil
      hardUntil
    }
  }
` as const

export const adminClaimSemanticRecommendationEpisodeOperation = adminGraphql(
  adminClaimSemanticRecommendationEpisodeMutation,
)

export const adminRecordSemanticRecommendationPlaybackMutation = `
  mutation RecordSemanticRecommendationPlayback(
    $contractVersion: String!
    $capability: String!
    $episodeId: ID!
    $sessionDigest: String!
    $mediaId: ID!
    $events: [RecommendationPlaybackEventInput!]!
  ) {
    recordSemanticRecommendationPlayback(
      contractVersion: $contractVersion
      capability: $capability
      episodeId: $episodeId
      sessionDigest: $sessionDigest
      mediaId: $mediaId
      events: $events
    ) {
      eventId
      status
      sequence
    }
  }
` as const

export const adminRecordSemanticRecommendationPlaybackOperation = adminGraphql(
  adminRecordSemanticRecommendationPlaybackMutation,
)

export const adminRecordRecommendationContentActionMutation = `
  mutation RecordRecommendationContentAction(
    $contractVersion: String!
    $sessionDigest: String!
    $eventId: String!
    $occurredAt: String!
    $mediaId: ID!
    $actionKind: String!
    $actionDetail: String
  ) {
    recordRecommendationContentAction(
      contractVersion: $contractVersion
      sessionDigest: $sessionDigest
      eventId: $eventId
      occurredAt: $occurredAt
      mediaId: $mediaId
      actionKind: $actionKind
      actionDetail: $actionDetail
    ) {
      actionId
      eventId
      status
      matched
      late
    }
  }
` as const

export const adminRecordRecommendationContentActionOperation = adminGraphql(
  adminRecordRecommendationContentActionMutation,
)

export const adminRecommendationProfileStatusMutation = `
  mutation RecommendationProfileStatus(
    $contractVersion: String!
    $consentContractVersion: String
    $sessionDigest: String!
    $consentReceiptDigest: String
    $profileDigest: String
  ) {
    recommendationProfileStatus(
      contractVersion: $contractVersion
      consentContractVersion: $consentContractVersion
      sessionDigest: $sessionDigest
      consentReceiptDigest: $consentReceiptDigest
      profileDigest: $profileDigest
    ) {
      state
      choice
      privacyGeneration
      expiresAt
      erasureState
      cookieDisposition
      consentChoice
      consentContractVersion
      consentExpiresAt
      consentCookieDisposition
    }
  }
` as const

export const adminRecommendationProfileStatusOperation = adminGraphql(
  adminRecommendationProfileStatusMutation,
)

export const adminTransitionRecommendationProfileMutation = `
  mutation TransitionRecommendationProfile(
    $contractVersion: String!
    $consentContractVersion: String
    $action: String!
    $consentChoice: String
    $sessionDigest: String!
    $existingConsentReceiptDigest: String
    $proposedConsentReceiptDigest: String
    $existingProfileDigest: String
    $proposedProfileDigest: String
  ) {
    transitionRecommendationProfile(
      contractVersion: $contractVersion
      consentContractVersion: $consentContractVersion
      action: $action
      consentChoice: $consentChoice
      sessionDigest: $sessionDigest
      existingConsentReceiptDigest: $existingConsentReceiptDigest
      proposedConsentReceiptDigest: $proposedConsentReceiptDigest
      existingProfileDigest: $existingProfileDigest
      proposedProfileDigest: $proposedProfileDigest
    ) {
      state
      choice
      privacyGeneration
      expiresAt
      erasureState
      cookieDisposition
      consentChoice
      consentContractVersion
      consentExpiresAt
      consentCookieDisposition
    }
  }
` as const

export const adminTransitionRecommendationProfileOperation = adminGraphql(
  adminTransitionRecommendationProfileMutation,
)
