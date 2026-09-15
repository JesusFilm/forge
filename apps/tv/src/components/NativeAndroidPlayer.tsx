import { useEffect, useMemo, useRef, useState } from "react"
import { AccessibilityInfo, AppState, Platform, StyleSheet } from "react-native"

import type {
  NativeAndroidPlayerMoment,
  NativeAndroidPlayerOption,
  NativeAndroidPlayerViewProps,
} from "../../modules/native-android-player"
import { useWatchSession } from "../contexts/WatchSessionProvider"
import type { UpNextTarget } from "../contexts/VideoPlayerContext"
import { useBibleVerses } from "../hooks/useBibleVerses"
import { getApolloClient } from "../lib/apolloClient"
import { datadogLog, reportDatadogError } from "../lib/datadog"
import {
  findActiveMoment,
  type MomentsClassification,
} from "../lib/moments/momentsModel"
import { loadVideoMoments } from "../lib/moments/momentsSource"
import { parseBibleReferences } from "../lib/moments/parseBibleReference"
import { extractMuxPlaybackId } from "../lib/muxUrl"
import { createVideoQoeSession } from "../lib/videoQoe"
import { validateStreamingUrl } from "../lib/validateUrl"
import {
  evaluateMeaningfulPlayback,
  initialMeaningfulState,
  type PlaybackSnapshot,
} from "../lib/watchEvents/watchEvents"
import { formatCitationReference } from "./watch/detailsAdapters"
import { deriveSubtitlePanelState } from "./watch/panelState"
import { nativeAndroidSessionOwnsPlayback } from "./watch/nativeAndroidSession"

type NativeViewComponent = React.ComponentType<NativeAndroidPlayerViewProps>

let NativePlayerView: NativeViewComponent | null = null
if (Platform.OS === "android") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NativePlayerView = require("../../modules/native-android-player")
    .NativeAndroidPlayerView as NativeViewComponent
}

type NativeAndroidPlayerProps = {
  streamingUrl: string
  videoId?: string | null
  title?: string
  subtitle?: string
  startAtSeconds?: number | null
  meaningfulResetKey?: string | null
  onDismiss: () => void
  onMeaningfulPlayback?: (snapshot: PlaybackSnapshot) => void
  onPlaybackPosition?: (snapshot: PlaybackSnapshot) => void
  upNextTarget?: UpNextTarget | null
  onPlayNext?: (slug: string) => void
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}

export function NativeAndroidPlayer({
  streamingUrl,
  videoId,
  title,
  subtitle,
  startAtSeconds,
  meaningfulResetKey,
  onDismiss,
  onMeaningfulPlayback,
  onPlaybackPosition,
  upNextTarget,
  onPlayNext,
}: NativeAndroidPlayerProps) {
  const session = useWatchSession()
  const baselineRef = useRef(startAtSeconds ?? 0)
  const lastPositionRef = useRef<PlaybackSnapshot | null>(null)
  const meaningfulStateRef = useRef(initialMeaningfulState)
  const onMeaningfulPlaybackRef = useRef(onMeaningfulPlayback)
  const onPlaybackPositionRef = useRef(onPlaybackPosition)
  onMeaningfulPlaybackRef.current = onMeaningfulPlayback
  onPlaybackPositionRef.current = onPlaybackPosition
  const [qoe] = useState(() =>
    createVideoQoeSession({
      contentId: extractMuxPlaybackId(streamingUrl),
    }),
  )
  const endedRef = useRef(false)
  useEffect(
    () => () => {
      if (lastPositionRef.current)
        onPlaybackPositionRef.current?.(lastPositionRef.current)
      const summary = qoe.finalize(endedRef.current ? "ended" : "abandoned")
      if (summary)
        datadogLog.info("video_playback.summary", {
          ...summary,
          player: "native_android",
        })
    },
    [qoe],
  )

  useEffect(() => {
    baselineRef.current =
      lastPositionRef.current?.positionSeconds ?? startAtSeconds ?? 0
    meaningfulStateRef.current = initialMeaningfulState
  }, [meaningfulResetKey, startAtSeconds])

  const [screenReaderEnabled, setScreenReaderEnabled] = useState(false)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  )
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isScreenReaderEnabled().then((value) => {
      if (active) setScreenReaderEnabled(value)
    })
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value)
    })
    const screenReader = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setScreenReaderEnabled,
    )
    const motion = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    )
    const app = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    )
    return () => {
      active = false
      screenReader.remove()
      motion.remove()
      app.remove()
    }
  }, [])

  const sessionOwnsPlayback = nativeAndroidSessionOwnsPlayback({
    videoId,
    sessionVideo: session.video,
    activeVariantHls: session.activeVariant?.hls,
    currentUrl: streamingUrl,
  })
  const desiredSource =
    sessionOwnsPlayback && validateStreamingUrl(session.activeVariant?.hls)
      ? session.activeVariant!.hls!
      : streamingUrl
  const playbackId =
    (sessionOwnsPlayback ? session.activeVariant?.muxPlaybackId : null) ??
    extractMuxPlaybackId(desiredSource)
  const storyboardUrl =
    playbackId && /^[A-Za-z0-9_-]+$/.test(playbackId)
      ? `https://image.mux.com/${playbackId}/storyboard.json?format=jpg`
      : undefined

  const audioOptions = useMemo<NativeAndroidPlayerOption[]>(
    () =>
      sessionOwnsPlayback
        ? (session.video?.variants.map((variant) => ({
            id: variant.documentId,
            label:
              variant.languageName ??
              variant.languageSlug ??
              "Unknown language",
            detail: variant.languageNameNative ?? "",
            url: validateStreamingUrl(variant.hls) ? variant.hls! : "",
            disabled: !validateStreamingUrl(variant.hls),
            searchText: `${variant.languageSlug ?? ""} ${variant.languageBcp47 ?? ""}`,
          })) ?? [])
        : [],
    [sessionOwnsPlayback, session.video?.variants],
  )
  const subtitleState = deriveSubtitlePanelState(
    session.activeVariantMediaState,
  )
  const subtitleOptions = useMemo<NativeAndroidPlayerOption[]>(
    () =>
      sessionOwnsPlayback
        ? (session.activeVariantMedia?.subtitles.map((track) => ({
            id: track.languageSlug,
            label: track.languageName || track.languageSlug,
            detail: track.languageNameNative ?? "",
            url: track.vttSrc,
            searchText: `${track.languageSlug} ${track.languageBcp47}`,
          })) ?? [])
        : [],
    [sessionOwnsPlayback, session.activeVariantMedia?.subtitles],
  )
  const subtitleStatus =
    subtitleState.kind === "loading"
      ? "Loading…"
      : subtitleState.kind === "error"
        ? "Couldn’t load subtitles"
        : subtitleOptions.length === 0
          ? "No subtitles available"
          : undefined
  const activeSubtitle =
    sessionOwnsPlayback && session.subtitleEnabled
      ? session.activeVariantMedia?.subtitles.find(
          (track) => track.languageSlug === session.activeSubtitleSlug,
        )
      : undefined

  const [menuSection, setMenuSection] = useState<string | null>(null)
  const [playhead, setPlayhead] = useState(startAtSeconds ?? 0)
  const [momentsData, setMomentsData] = useState<{
    slug: string | null
    loading: boolean
    classification: MomentsClassification
  }>({ slug: null, loading: true, classification: { kind: "empty" } })
  const slug = sessionOwnsPlayback ? (session.video?.slug ?? null) : null
  useEffect(() => {
    if (menuSection !== "moments" || !slug) return
    let cancelled = false
    setMomentsData({ slug, loading: true, classification: { kind: "empty" } })
    void loadVideoMoments({ client: getApolloClient(), slug }).then(
      (result) => {
        if (!cancelled)
          setMomentsData({
            slug,
            loading: false,
            classification: result.ok
              ? result.classification
              : { kind: "empty" },
          })
      },
      () => {
        if (!cancelled)
          setMomentsData({
            slug,
            loading: false,
            classification: { kind: "empty" },
          })
      },
    )
    return () => {
      cancelled = true
    }
  }, [menuSection, slug])
  const classification =
    momentsData.slug === slug
      ? momentsData.classification
      : { kind: "empty" as const }
  const timeline =
    classification.kind === "timed" ? classification.timeline : []
  const activeMoment =
    menuSection === "moments" ? findActiveMoment(timeline, playhead) : undefined
  const citations = useMemo(
    () => parseBibleReferences(activeMoment?.bibleVerses ?? []),
    [activeMoment],
  )
  const verseTexts = useBibleVerses(citations)
  const currentMomentText =
    activeMoment == null
      ? undefined
      : [
          `This moment · ${formatClock(activeMoment.startSeconds)}`,
          activeMoment.summary,
          ...citations.map((citation) =>
            [formatCitationReference(citation), verseTexts[citation.documentId]]
              .filter(Boolean)
              .join("\n"),
          ),
        ]
          .filter(Boolean)
          .join("\n\n")
  const nativeMoments = useMemo<NativeAndroidPlayerMoment[]>(
    () =>
      (classification.kind === "timed" ? classification.timeline : []).map(
        (moment, index) => ({
          id: `${moment.startSeconds}-${index}`,
          label: moment.summary ?? formatClock(moment.startSeconds),
          detail: formatClock(moment.startSeconds),
          startSeconds: moment.startSeconds,
        }),
      ),
    [classification],
  )
  const summaries =
    classification.kind === "untimed"
      ? classification.list.map((moment) =>
          [moment.summary, ...moment.bibleVerses].filter(Boolean).join("\n"),
        )
      : []
  const questions = sessionOwnsPlayback
    ? (session.video?.studyQuestions.map((question) => question.value) ?? [])
    : []
  const exploreStatus =
    momentsData.slug !== slug || momentsData.loading
      ? "Loading…"
      : nativeMoments.length === 0 &&
          summaries.length === 0 &&
          questions.length === 0
        ? "Nothing to explore for this video yet"
        : undefined

  if (NativePlayerView == null || !validateStreamingUrl(desiredSource))
    return null
  return (
    <NativePlayerView
      style={styles.player}
      sourceUrl={desiredSource}
      storyboardUrl={storyboardUrl}
      title={title}
      subtitle={subtitle}
      startAtSeconds={startAtSeconds ?? undefined}
      foreground={foreground}
      screenReaderEnabled={screenReaderEnabled}
      reduceMotion={reduceMotion}
      menuAvailable={sessionOwnsPlayback}
      audioOptions={audioOptions}
      selectedAudioId={session.activeVariant?.documentId}
      subtitleOptions={subtitleOptions}
      subtitleStatus={subtitleStatus}
      selectedSubtitleId={activeSubtitle?.languageSlug}
      selectedSubtitleUrl={activeSubtitle?.vttSrc}
      moments={nativeMoments}
      currentMomentText={currentMomentText}
      summaries={summaries}
      questions={questions}
      exploreStatus={exploreStatus}
      upNextSlug={onPlayNext ? upNextTarget?.slug : undefined}
      upNextTitle={upNextTarget?.title ?? undefined}
      onDismiss={onDismiss}
      onEnded={() => {
        endedRef.current = true
        onDismiss()
      }}
      onPlayNext={(event) => {
        endedRef.current = true
        onPlayNext?.(event.nativeEvent.slug)
      }}
      onMenuChange={(event) => {
        setPlayhead(lastPositionRef.current?.positionSeconds ?? 0)
        setMenuSection(event.nativeEvent.section)
      }}
      onFirstFrame={() => {
        const ttff = qoe.onFirstPlaying()
        if (ttff != null)
          datadogLog.info("video_playback.first_frame", {
            ttff_ms: ttff,
            player: "native_android",
          })
      }}
      onRebuffer={() => qoe.onRebuffer()}
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
        } else {
          session.setActiveSubtitleSlug(id)
          session.setSubtitleEnabled(true)
        }
      }}
      onPlaybackPosition={(event) => {
        const snapshot = event.nativeEvent
        const duration =
          snapshot.durationSeconds > 0 ? snapshot.durationSeconds : null
        const normalized = {
          positionSeconds: snapshot.positionSeconds,
          durationSeconds: duration,
        }
        lastPositionRef.current = normalized
        onPlaybackPositionRef.current?.(normalized)
        qoe.onTimeUpdate(snapshot.positionSeconds)
        if (menuSection === "moments") setPlayhead(snapshot.positionSeconds)
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
        qoe.onError(event.nativeEvent.message)
        reportDatadogError(new Error(event.nativeEvent.message), {
          surface: "native_android_player",
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
