/**
 * Real wiring for the playback episode recorder: the viewer store, the
 * pending-claim and discovery stores, and the three Admin mutations. The
 * adapter calls the factory once per media session; null means the feature
 * is off or unprovisioned, and the adapter records nothing.
 */
import { AppState } from "react-native"

import { getApiToken } from "../config"
import { isRecommendationClientEnabled } from "./enabled"
import {
  CLAIM_RECOMMENDATION_EPISODE,
  ISSUE_WATCH_PLAYBACK_CONTEXT,
  RECORD_RECOMMENDATION_PLAYBACK,
} from "./operations"
import {
  DIRECT_DISCOVERY,
  getPlaybackDiscoveryStore,
} from "./playbackDiscovery"
import {
  createRecommendationPlaybackRecorder,
  type PlaybackRecorderDeps,
  type RecommendationPlaybackRecorder,
} from "./playbackRecorder"
import { getPendingClaimStore } from "./selection"
import { EVIDENCE_DEADLINE_MS, mutateWithDeadline } from "./transport"
import {
  getRecommendationViewerStore,
  viewerIdentityBridge,
} from "./viewerIdentityClient"

export type PlaybackRecorderInput =
  | {
      mode?: "watch"
      /** The Admin video id: the media the episode is claimed for. */
      mediaId: string
      /** Keys a surface may have marked the discovery under (slug, media id). */
      discoveryKeys: ReadonlyArray<string | null | undefined>
    }
  | {
      /** An Explore clip: `direct`, with no discovery keys and no pending claim. */
      mode: "clip"
      mediaId: string
    }

type AttributionDeps = Pick<
  PlaybackRecorderDeps,
  | "mode"
  | "discoveryKeys"
  | "takePendingNonce"
  | "restorePendingNonce"
  | "takeDiscovery"
>

/** The device is "visible" unless the app is genuinely in the background. */
export function isAppForeground(): boolean {
  return AppState.currentState !== "background"
}

/** False when the feature is off or has no bearer: nothing is sent at all. */
export function isPlaybackRecorderAvailable(): boolean {
  return isRecommendationClientEnabled() && Boolean(getApiToken())
}

function attributionFor(input: PlaybackRecorderInput): AttributionDeps {
  if (input.mode === "clip") {
    // The stores stay out of reach: Home's nonce and a search mark for this
    // video belong to the watch page that opens it next.
    return {
      mode: "clip",
      discoveryKeys: [],
      takePendingNonce: () => null,
      restorePendingNonce: () => undefined,
      takeDiscovery: () => DIRECT_DISCOVERY,
    }
  }
  return {
    discoveryKeys: input.discoveryKeys,
    takePendingNonce: (mediaId) => getPendingClaimStore().take(mediaId),
    restorePendingNonce: (claim) => getPendingClaimStore().restore(claim),
    takeDiscovery: (keys) => getPlaybackDiscoveryStore().take(keys),
  }
}

export function createPlaybackRecorderForMedia(
  input: PlaybackRecorderInput,
): RecommendationPlaybackRecorder | null {
  if (!isPlaybackRecorderAvailable()) return null
  return createRecommendationPlaybackRecorder({
    ...viewerIdentityBridge(),
    ...attributionFor(input),
    mediaId: input.mediaId,
    claimEpisode: async (identity, claimNonce, mediaId) => {
      const data = await mutateWithDeadline(
        CLAIM_RECOMMENDATION_EPISODE,
        { ...identity, claimNonce, mediaId },
        EVIDENCE_DEADLINE_MS,
      )
      return data.claimSemanticRecommendationEpisode
    },
    issueContext: async (identity, mediaId, discovery) => {
      const data = await mutateWithDeadline(
        ISSUE_WATCH_PLAYBACK_CONTEXT,
        {
          ...identity,
          mediaId,
          discoverySource: discovery.source,
          provenance: discovery.provenance,
        },
        EVIDENCE_DEADLINE_MS,
      )
      return data.issueWatchPlaybackContext
    },
    sendFacts: async (variables) => {
      const data = await mutateWithDeadline(
        RECORD_RECOMMENDATION_PLAYBACK,
        variables,
        EVIDENCE_DEADLINE_MS,
      )
      return data.recordSemanticRecommendationPlayback
    },
    holdPlayback: () => getRecommendationViewerStore().holdPlayback(),
    isForeground: isAppForeground,
  })
}
