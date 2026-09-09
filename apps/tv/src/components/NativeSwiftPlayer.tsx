import { useEffect, useMemo, useRef, useState } from "react"
import { Platform, StyleSheet } from "react-native"

import { useWatchSession } from "../contexts/WatchSessionProvider"
import { getApolloClient } from "../lib/apolloClient"
import {
  evaluateMeaningfulPlayback,
  initialMeaningfulState,
  type PlaybackSnapshot,
} from "../lib/watchEvents/watchEvents"
import { loadVideoMoments } from "../lib/moments/momentsSource"
import type { TimedMoment } from "../lib/moments/momentsModel"
import { validateStreamingUrl } from "../lib/validateUrl"
import { reportDatadogError } from "../lib/datadog"
import { extractMuxPlaybackId } from "../lib/muxUrl"
import { buildMuxStoryboardUrl } from "../lib/tvScrubPreview"
import type { UpNextTarget } from "../contexts/VideoPlayerContext"
import { inPlayerMenuVisible } from "./watch/playerSwitch"
import type {
  NativePlayerMoment,
  NativePlayerOption,
  NativeSwiftPlayerViewProps,
} from "../../modules/native-swift-player"

type NativeViewComponent = React.ComponentType<NativeSwiftPlayerViewProps>

let NativePlayerView: NativeViewComponent | null = null
if (Platform.OS === "ios") {
  // Kept behind the platform branch so Android never resolves an Apple-only
  // native view manager. The existing player remains Android's only path.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NativePlayerView = require("../../modules/native-swift-player")
    .NativeSwiftPlayerView as NativeViewComponent
}

type NativeSwiftPlayerProps = {
  streamingUrl: string
  playerVariant: "native-a" | "native-b"
  title?: string
  startAtSeconds?: number | null
  meaningfulResetKey?: string | null
  onDismiss: () => void
  onMeaningfulPlayback?: (snapshot: PlaybackSnapshot) => void
  onPlaybackPosition?: (snapshot: PlaybackSnapshot) => void
  upNextTarget?: UpNextTarget | null
  onPlayNext?: (slug: string) => void
}

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return `${hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}` : minutes}:${String(remainder).padStart(2, "0")}`
}

export function NativeSwiftPlayer({
  streamingUrl,
  playerVariant,
  title,
  startAtSeconds,
  meaningfulResetKey,
  onDismiss,
  onMeaningfulPlayback,
  onPlaybackPosition,
  upNextTarget,
  onPlayNext,
}: NativeSwiftPlayerProps) {
  const session = useWatchSession()
  const baselineRef = useRef(startAtSeconds ?? 0)
  const meaningfulStateRef = useRef(initialMeaningfulState)
  const onMeaningfulPlaybackRef = useRef(onMeaningfulPlayback)
  const onPlaybackPositionRef = useRef(onPlaybackPosition)
  onMeaningfulPlaybackRef.current = onMeaningfulPlayback
  onPlaybackPositionRef.current = onPlaybackPosition

  useEffect(() => {
    baselineRef.current = startAtSeconds ?? 0
    meaningfulStateRef.current = initialMeaningfulState
  }, [meaningfulResetKey, startAtSeconds])

  const rawSessionMatch = inPlayerMenuVisible({
    sessionVideo: session.video,
    activeVariantHls: session.activeVariant?.hls,
    currentUrl: streamingUrl,
  })
  const sessionOwnsPlaybackRef = useRef(false)
  if (rawSessionMatch) sessionOwnsPlaybackRef.current = true
  if (session.video == null) sessionOwnsPlaybackRef.current = false
  const sessionOwnsPlayback =
    session.video != null && sessionOwnsPlaybackRef.current

  const desiredSource =
    sessionOwnsPlayback && validateStreamingUrl(session.activeVariant?.hls)
      ? session.activeVariant?.hls
      : streamingUrl

  const storyboardUrl = buildMuxStoryboardUrl(
    (sessionOwnsPlayback ? session.activeVariant?.muxPlaybackId : null) ??
      extractMuxPlaybackId(desiredSource) ??
      "",
    "jpg",
  )

  const audioOptions = useMemo<NativePlayerOption[]>(
    () =>
      sessionOwnsPlayback
        ? (session.video?.variants.flatMap((variant) =>
            variant.hls && validateStreamingUrl(variant.hls)
              ? [
                  {
                    id: variant.documentId,
                    label:
                      variant.languageName ??
                      variant.languageSlug ??
                      "Unknown language",
                    detail: variant.languageNameNative ?? "",
                    url: variant.hls,
                  },
                ]
              : [],
          ) ?? [])
        : [],
    [sessionOwnsPlayback, session.video?.variants],
  )

  const subtitleOptions = useMemo<NativePlayerOption[]>(
    () =>
      sessionOwnsPlayback
        ? (session.activeVariantMedia?.subtitles.map((subtitle) => ({
            id: subtitle.languageSlug,
            label: subtitle.languageName || subtitle.languageSlug,
            detail: subtitle.languageNameNative ?? "",
            url: subtitle.vttSrc,
          })) ?? [])
        : [],
    [sessionOwnsPlayback, session.activeVariantMedia?.subtitles],
  )

  const activeSubtitle =
    sessionOwnsPlayback && session.subtitleEnabled
      ? session.activeVariantMedia?.subtitles.find(
          (subtitle) => subtitle.languageSlug === session.activeSubtitleSlug,
        )
      : undefined

  const [moments, setMoments] = useState<TimedMoment[]>([])
  useEffect(() => {
    let cancelled = false
    const slug = sessionOwnsPlayback ? session.video?.slug : null
    if (!slug) {
      setMoments([])
      return
    }
    void loadVideoMoments({ client: getApolloClient(), slug }).then(
      (result) => {
        if (cancelled) return
        setMoments(
          result.ok && result.classification.kind === "timed"
            ? result.classification.timeline
            : [],
        )
      },
    )
    return () => {
      cancelled = true
    }
  }, [sessionOwnsPlayback, session.video?.slug])

  const nativeMoments = useMemo<NativePlayerMoment[]>(
    () =>
      moments.map((moment, index) => ({
        id: `${moment.startSeconds}-${index}`,
        label: moment.summary ?? formatClock(moment.startSeconds),
        detail: formatClock(moment.startSeconds),
        startSeconds: moment.startSeconds,
      })),
    [moments],
  )

  if (
    NativePlayerView == null ||
    typeof desiredSource !== "string" ||
    !validateStreamingUrl(desiredSource)
  ) {
    return null
  }

  return (
    <NativePlayerView
      style={styles.player}
      sourceUrl={desiredSource}
      playerVariant={playerVariant}
      storyboardUrl={storyboardUrl ?? undefined}
      title={title}
      startAtSeconds={startAtSeconds ?? undefined}
      audioOptions={audioOptions}
      selectedAudioId={session.activeVariant?.documentId ?? undefined}
      subtitleOptions={subtitleOptions}
      selectedSubtitleId={activeSubtitle?.languageSlug}
      selectedSubtitleUrl={activeSubtitle?.vttSrc}
      moments={nativeMoments}
      questions={
        sessionOwnsPlayback
          ? (session.video?.studyQuestions.map((question) => question.value) ??
            [])
          : []
      }
      upNextSlug={upNextTarget?.slug}
      upNextTitle={upNextTarget?.title ?? undefined}
      onDismiss={onDismiss}
      onEnded={onDismiss}
      onPlayNext={(event) => onPlayNext?.(event.nativeEvent.slug)}
      onAudioChange={(event) => {
        const index = session.video?.variants.findIndex(
          (variant) => variant.documentId === event.nativeEvent.id,
        )
        if (index != null && index >= 0) session.setActiveVariantIndex(index)
      }}
      onSubtitleChange={(event) => {
        const id = event.nativeEvent.id
        if (id == null) {
          session.setSubtitleEnabled(false)
          return
        }
        session.setActiveSubtitleSlug(id)
        session.setSubtitleEnabled(true)
      }}
      onPlaybackPosition={(event) => {
        const snapshot = event.nativeEvent
        const duration =
          snapshot.durationSeconds > 0 ? snapshot.durationSeconds : null
        const normalized = {
          positionSeconds: snapshot.positionSeconds,
          durationSeconds: duration,
        }
        onPlaybackPositionRef.current?.(normalized)
        const result = evaluateMeaningfulPlayback(
          meaningfulStateRef.current,
          snapshot.positionSeconds,
          duration,
          baselineRef.current,
        )
        meaningfulStateRef.current = result.state
        if (result.record) onMeaningfulPlaybackRef.current?.(normalized)
      }}
      onError={(event) => {
        reportDatadogError(new Error(event.nativeEvent.message), {
          surface: "native_swift_player",
        })
      }}
    />
  )
}

const styles = StyleSheet.create({
  player: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
    zIndex: 1000,
  },
})
