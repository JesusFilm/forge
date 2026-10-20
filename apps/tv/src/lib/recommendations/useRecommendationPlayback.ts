import { useCallback, useEffect, useRef, useState } from "react"
import { AppState } from "react-native"
import * as Crypto from "expo-crypto"
import {
  createPlaybackRecorder,
  type PlaybackObservation,
  type PlaybackFact,
} from "./playbackRecorder"
import { createEvidenceQueue } from "./evidenceQueue"
import {
  claimPlayback,
  recommendationIdentity,
  recommendationsEnabled,
  sendPlayback,
  subscribeRecommendations,
  getRecommendationGeneration,
  type Attribution,
  RecommendationRequestError,
} from "./client"

export function useRecommendationPlayback(input: {
  visible: boolean
  mediaId: string | null
  sourceGeneration: number
  attribution?: Attribution
  source?: "direct" | "search" | "editorial"
  automatic?: boolean
}) {
  const recorder = useRef<ReturnType<typeof createPlaybackRecorder> | null>(
    null,
  )
  const generation = useRef(input.sourceGeneration)
  generation.current = input.sourceGeneration
  const [revision, setRevision] = useState(getRecommendationGeneration)
  useEffect(
    () =>
      subscribeRecommendations(() =>
        setRevision(getRecommendationGeneration()),
      ),
    [],
  )
  const attribution =
    input.attribution?.privacyGeneration === revision
      ? input.attribution
      : undefined
  useEffect(() => {
    if (!recommendationsEnabled() || !input.visible || !input.mediaId) return
    const claim = claimPlayback(
      input.mediaId,
      input.source ?? "direct",
      attribution,
    )
    const queue = createEvidenceQueue<PlaybackFact>({
      send: async (events) => sendPlayback(await claim, events),
      retryable: (error) =>
        error instanceof RecommendationRequestError && error.retryable,
      now: () => performance.now(),
    })
    let exited = false
    let held = false
    void recommendationIdentity
      .get()
      .then(() => {
        if (!exited) {
          recommendationIdentity.beginPlayback()
          held = true
        }
      })
      .catch(() => {})
    const local = createPlaybackRecorder({
      generation: generation.current,
      now: () => performance.now(),
      timestamp: () => new Date().toISOString(),
      id: Crypto.randomUUID,
      automatic: input.automatic,
      emit: queue.push,
    })
    recorder.current = local
    local.visibility(AppState.currentState === "active")
    void claim.catch(() => {
      queue.retire()
      if (recorder.current === local) recorder.current = null
    })
    const appState = AppState.addEventListener("change", (state) =>
      local.visibility(state === "active"),
    )
    const unsubscribe = subscribeRecommendations(() => {
      queue.retire()
      if (recorder.current === local) recorder.current = null
    })
    return () => {
      local.stop("route_exit")
      exited = true
      if (recorder.current === local) recorder.current = null
      appState.remove()
      unsubscribe()
      if (held) void recommendationIdentity.endPlayback().catch(() => {})
    }
  }, [
    input.visible,
    input.mediaId,
    input.source,
    attribution,
    input.automatic,
    revision,
  ])
  useEffect(() => {
    recorder.current?.changeSource(input.sourceGeneration)
  }, [input.sourceGeneration])
  return useCallback(
    (observation: PlaybackObservation) =>
      recorder.current?.observe(observation),
    [],
  )
}
