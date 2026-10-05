import { adminGraphql } from "../index"

export const adminSemanticRecommendationDeliveryQuery = `
  query SemanticRecommendationDelivery(
    $seedMediaId: ID!
    $locale: String!
    $audioLanguageSlug: String!
    $sessionDigest: String!
    $consentReceiptDigest: String
    $profileTokenDigest: String
    $trafficCategory: String
    $eligibleHuman: Boolean
    $clientDeliveryContract: String
  ) {
    semanticRecommendationDelivery(
      seedMediaId: $seedMediaId
      locale: $locale
      audioLanguageSlug: $audioLanguageSlug
      sessionDigest: $sessionDigest
      consentReceiptDigest: $consentReceiptDigest
      profileTokenDigest: $profileTokenDigest
      trafficCategory: $trafficCategory
      eligibleHuman: $eligibleHuman
      clientDeliveryContract: $clientDeliveryContract
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

// This private recovery document may require the new Admin schema. Keep the
// ordinary delivery document above compatible with older Admin deployments.
export const adminPrivateSemanticRecommendationFallbackQuery = `
  query PrivateSemanticRecommendationFallback(
    $seedMediaId: ID!
    $locale: String!
    $audioLanguageSlug: String!
    $sessionDigest: String!
  ) {
    semanticRecommendationDelivery(
      seedMediaId: $seedMediaId
      locale: $locale
      audioLanguageSlug: $audioLanguageSlug
      sessionDigest: $sessionDigest
      privatePreviewFallback: true
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

export const adminPrivateSemanticRecommendationFallbackOperation = adminGraphql(
  adminPrivateSemanticRecommendationFallbackQuery,
)

export const adminPrecomputedWatchPreviewDeliveryQuery = `
  query PrecomputedWatchPreviewDelivery(
    $seedMediaId: ID!
    $locale: String!
    $audioLanguageSlug: String!
    $sessionDigest: String!
  ) {
    precomputedWatchPreviewDelivery(
      seedMediaId: $seedMediaId
      locale: $locale
      audioLanguageSlug: $audioLanguageSlug
      sessionDigest: $sessionDigest
    ) {
      contractVersion
      surfaceVersion
      strategyVersion
      classifierVersion
      generationId
      requestId
      result
      reason
      expiresAt
      requestedCount
      composedCount
      shortfallReason
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

export const adminPrecomputedWatchPreviewDeliveryOperation = adminGraphql(
  adminPrecomputedWatchPreviewDeliveryQuery,
)

export const adminPrivatePrecomputedWatchVisitDeliveryQuery = `
  query PrivatePrecomputedWatchVisitDelivery(
    $visitId: ID!
    $browserDigest: String!
    $consentReceiptDigest: String
    $profileTokenDigest: String
    $seedMediaId: ID!
    $locale: String!
    $audioLanguageSlug: String!
    $sessionDigest: String!
    $trafficCategory: String!
    $clientDeliveryContract: String
  ) {
    privatePrecomputedWatchVisitDelivery(
      visitId: $visitId
      browserDigest: $browserDigest
      consentReceiptDigest: $consentReceiptDigest
      profileTokenDigest: $profileTokenDigest
      seedMediaId: $seedMediaId
      locale: $locale
      audioLanguageSlug: $audioLanguageSlug
      sessionDigest: $sessionDigest
      trafficCategory: $trafficCategory
      clientDeliveryContract: $clientDeliveryContract
    ) {
      status
      visitId
      experimentId
      generationId
      arm
      reason
      qualification
      measurementStatus
      delivery {
        contractVersion
        surfaceVersion
        strategyVersion
        classifierVersion
        generationId
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
          contributors { generator generatorVersion rank }
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
  }
` as const

export const adminPrivatePrecomputedWatchVisitDeliveryOperation = adminGraphql(
  adminPrivatePrecomputedWatchVisitDeliveryQuery,
)

export const adminRecordSemanticRecommendationEvidenceMutation = `
  mutation RecordSemanticRecommendationEvidence(
    $contractVersion: String!
    $capability: String!
    $requestId: ID!
    $itemId: ID!
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $events: [RecommendationEvidenceEventInput!]!
  ) {
    recordSemanticRecommendationEvidence(
      contractVersion: $contractVersion
      capability: $capability
      requestId: $requestId
      itemId: $itemId
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
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
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $eventId: String!
    $occurredAt: String!
    $tabDigest: String
    $claimNonce: String!
  ) {
    selectSemanticRecommendation(
      contractVersion: $contractVersion
      capability: $capability
      requestId: $requestId
      itemId: $itemId
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
      eventId: $eventId
      occurredAt: $occurredAt
      tabDigest: $tabDigest
      claimNonce: $claimNonce
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

// Keep the public operation unchanged for flag-off and older Admin servers.
// Only the gated private Watch test sends its signed browser-cookie digest.
export const adminSelectPrivatePrecomputedRecommendationMutation = `
  mutation SelectPrivatePrecomputedRecommendation(
    $contractVersion: String!
    $capability: String!
    $requestId: ID!
    $itemId: ID!
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $eventId: String!
    $occurredAt: String!
    $tabDigest: String
    $claimNonce: String!
    $browserDigest: String
  ) {
    selectSemanticRecommendation(
      contractVersion: $contractVersion
      capability: $capability
      requestId: $requestId
      itemId: $itemId
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
      eventId: $eventId
      occurredAt: $occurredAt
      tabDigest: $tabDigest
      claimNonce: $claimNonce
      browserDigest: $browserDigest
    ) {
      status
      claimNonce
      canonicalHref
      targetMediaId
    }
  }
` as const

export const adminSelectPrivatePrecomputedRecommendationOperation =
  adminGraphql(adminSelectPrivatePrecomputedRecommendationMutation)

export const adminClaimSemanticRecommendationEpisodeMutation = `
  mutation ClaimSemanticRecommendationEpisode(
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $claimNonce: String!
    $mediaId: ID!
  ) {
    claimSemanticRecommendationEpisode(
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
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

export const adminIssueWatchPlaybackContextMutation = `
  mutation IssueWatchPlaybackContext(
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $mediaId: ID!
    $discoverySource: String!
    $provenance: JSON!
  ) {
    issueWatchPlaybackContext(
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
      mediaId: $mediaId
      discoverySource: $discoverySource
      provenance: $provenance
    ) {
      claimNonce
      contextVersion
    }
  }
` as const

export const adminIssueWatchPlaybackContextOperation = adminGraphql(
  adminIssueWatchPlaybackContextMutation,
)

export const adminRecordSemanticRecommendationPlaybackMutation = `
  mutation RecordSemanticRecommendationPlayback(
    $contractVersion: String!
    $capability: String!
    $episodeId: ID!
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $mediaId: ID!
    $events: [RecommendationPlaybackEventInput!]!
  ) {
    recordSemanticRecommendationPlayback(
      contractVersion: $contractVersion
      capability: $capability
      episodeId: $episodeId
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
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
    $sessionDigest: String
    $viewerToken: String
    $sessionToken: String
    $eventId: String!
    $occurredAt: String!
    $mediaId: ID!
    $actionKind: String!
    $actionDetail: String
  ) {
    recordRecommendationContentAction(
      contractVersion: $contractVersion
      sessionDigest: $sessionDigest
      viewerToken: $viewerToken
      sessionToken: $sessionToken
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

export const adminRecordWatchSurfaceExposureMutation = `
  mutation RecordWatchSurfaceExposure($events: JSON!) {
    recordWatchSurfaceExposure(events: $events) {
      eventId
      status
    }
  }
` as const

export const adminRecordWatchSurfaceExposureOperation = adminGraphql(
  adminRecordWatchSurfaceExposureMutation,
)

export const adminIssueWatchSurfaceDeliveryMutation = `
  mutation IssueWatchSurfaceDelivery($manifest: JSON!, $attemptId: String!, $trafficCategory: String!) {
    issueWatchSurfaceDelivery(manifest: $manifest, attemptId: $attemptId, trafficCategory: $trafficCategory)
  }
` as const

export const adminIssueWatchSurfaceDeliveryOperation = adminGraphql(
  adminIssueWatchSurfaceDeliveryMutation,
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
