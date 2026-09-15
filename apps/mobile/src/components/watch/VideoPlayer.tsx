import { useCallback, useEffect, useRef, useState } from "react"
import {
  Animated,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native"
import { Image } from "expo-image"
import Ionicons from "@expo/vector-icons/Ionicons"
import { LinearGradient } from "expo-linear-gradient"
import { useNetworkState } from "expo-network"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { BLACK, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { datadogLog, reportDatadogAction } from "../../lib/datadog"
import { extractMuxPlaybackId } from "../../lib/muxThumbnail"
import { applySkip } from "../../lib/scrubber"
import {
  DOUBLE_TAP_MS,
  SKIP_SECONDS,
  classifyTap,
  seekDeltaForTap,
  seekSideForTap,
  singleTapAction,
  type SeekSide,
} from "../../lib/tapSeek"
import { useControlsVisibility } from "../../hooks/useControlsVisibility"
import { useEndedPosterFade } from "../../hooks/useEndedPosterFade"
import { useErrorRecovery } from "../../hooks/useErrorRecovery"
import { useNonRouteSheetSuppression } from "../../hooks/useNonRouteSheetSuppression"
import type { CastPlayback } from "../../hooks/useCastPlayback"
import type { CastMedia } from "../../lib/cast/castMediaResolver"
import { isExternalRouteActive } from "../../lib/externalRoute"
import {
  castButtonLabel,
  castIndicatorLabel,
  isRemoteCastPhase,
  selectPlaybackTarget,
  type CastRecovery,
  type PlaybackTarget,
} from "../../lib/playbackTarget"
import {
  PlayerControls,
  RouteButtons,
  fullscreenCaptionOffset,
  type PlayerControlsCastUi,
} from "./PlayerControls"
import { PlayerLoadingVeil } from "./PlayerLoadingVeil"
import { PlayerSettingsSheet } from "./PlayerSettingsSheet"
import { SubtitleOverlay } from "./SubtitleOverlay"

// Caption distance above the bottom edge (px). In fullscreen with the chrome up
// the offset is DERIVED from the seek bar's own geometry
// (`fullscreenCaptionOffset`), so the caption sits as low as it can while still
// clearing the bar's grab area; it drops further when the chrome hides. Inline
// it sits just above the button row.
const SUBTITLE_OFFSET_FS_CHROME_HIDDEN = 12
const SUBTITLE_OFFSET_INLINE = 14

// How long the pre-autostart veil may hold before it gives the chrome back.
const AUTOSTART_VEIL_TIMEOUT_MS = 12000

type VideoPlayerProps = {
  /** The root-owned player (KD2). This component creates none: exactly one
   *  adapter instance exists app-wide, in `PlaybackHost`. */
  player: ExpoVideoPlayer
  isPlaying: boolean
  /** Published by the host from the player's own status (R22), so the full
   *  view and the floating window read one failure state. */
  loadFailed?: boolean
  streamingUrl: string | null
  /** The source the player verifiably holds, which can outlive the requested
   *  one during an adoption. Recovery rebuilds THIS, not the display value. */
  recoverSourceUrl?: string | null
  /** Last position seen while healthy, from the adapter's 1s poll. */
  getHealthyPosition?: () => number
  posterUrl: string | null
  subtitleVttSrc?: string | null
  onPlayingChange?: (isPlaying: boolean) => void
  /** True while the player is expanded to a custom in-tree fullscreen. The
   *  parent route owns the state (it also drives orientation/header/back). */
  fullscreen?: boolean
  /** Toggle fullscreen (fired by the fullscreen control). */
  onToggleFullscreen?: () => void
  /** Resume-eligible position (KTD6). When set, the player seeks here by
   *  itself once the source loads — no Resume button. */
  resumeAtSeconds?: number | null
  /** Start playing once the source is ready, without a tap. Opt-in per call
   *  site: this player also backs the series-detail trailer dock, so an
   *  implicit default would autoplay surfaces that never asked for it. */
  autostart?: boolean
  /** The player already holds this request's content (R4's expand). Only the
   *  host can know it — the adoption is its `sourceForRequest` decision. */
  adopted?: boolean
  /** Cast wiring, owned by the surface that published the playback request and
   *  forwarded by the host. Null once that surface is gone: its unmount already
   *  ended the session (KTD7), so the floating window is local playback only. */
  cast?: VideoPlayerCast | null
}

export type VideoPlayerCast = {
  /** U3 cast session. */
  playback: CastPlayback
  /** Opens the SDK device dialog — screen-owned (KTD4). */
  onCastPress: () => void
  /** Screen-owned remote-only resolver (KTD5), closed over the variant,
   *  video, and seed — the offline source never reaches it. */
  resolveMediaAt: (startPositionSeconds: number | null) => CastMedia | null
  /** Screen-derived recovery instruction after a terminal session state. */
  recovery: CastRecovery | null
}

/**
 * The full-screen player CHROME (U6). It fills the frame the playback host
 * draws its one video view into, and layers over that view exactly as it
 * layered over its own before the hoist: poster, veil, tap target, scrim,
 * captions, controls.
 */
export function VideoPlayer({
  player,
  isPlaying,
  loadFailed = false,
  streamingUrl,
  recoverSourceUrl = null,
  getHealthyPosition,
  posterUrl,
  subtitleVttSrc = null,
  onPlayingChange,
  fullscreen = false,
  onToggleFullscreen,
  resumeAtSeconds = null,
  autostart = false,
  adopted = false,
  cast = null,
}: VideoPlayerProps) {
  const castPlayback = cast?.playback ?? null
  const onCastPress = cast?.onCastPress ?? null
  const resolveCastMediaAt = cast?.resolveMediaAt ?? null
  const castRecovery = cast?.recovery ?? null

  // Seeded from ADOPTION, not transport state: an expand onto an already-loaded
  // source emits no sourceLoad, so a paused one would arm the autostart veil
  // with nothing left to clear it (the live read alone covers only a playing one).
  const [hasStarted, setHasStarted] = useState(() => {
    if (adopted) return true
    try {
      return player.playing
    } catch {
      return false // Native player already released
    }
  })

  // KTD4: the remote phases where the session owns the player area. Mirrored
  // into a ref for the once-per-player listeners below.
  const castPhase = castPlayback?.state.phase ?? "idle"
  const castRemoteActive = castPlayback != null && isRemoteCastPhase(castPhase)
  const castRemoteActiveRef = useRef(castRemoteActive)
  castRemoteActiveRef.current = castRemoteActive
  // Latched for the whole mount: after any session the chrome — not the
  // autostart veil — is the recovery surface (see awaitingAutostart).
  const castTouchedRef = useRef(false)
  if (castRemoteActive) castTouchedRef.current = true
  // Render-time mirror for the recovery log below: applyCastRecovery keys on
  // [player] only, so the raw prop would be a stale closure there.
  const streamingUrlRef = useRef(streamingUrl)
  streamingUrlRef.current = streamingUrl
  const resolvedPoster = resolveImageUrl(posterUrl)

  useEffect(() => {
    if (isPlaying && !hasStarted) setHasStarted(true)
    onPlayingChange?.(isPlaying)
  }, [isPlaying, hasStarted, onPlayingChange])

  // Ended-playback poster (covers the often-black last frame under Replay).
  const { ended, posterFade } = useEndedPosterFade(player, isPlaying)

  // Read once here, not in the transport: PlayerControls renders in a dozen
  // suites, and a native module reached for down there would make every one of
  // them mock it. `isInternetReachable` is null until the first probe answers,
  // so only an explicit false counts as offline.
  const { isInternetReachable } = useNetworkState()
  const isOnline = isInternetReachable !== false

  // Rebuilds a failed source and resumes where the viewer was (todos/024).
  // `recoverSourceUrl` is what the player HOLDS, which outlives the requested
  // url during an adoption; `streamingUrl` stays the display/telemetry value.
  const handleRecover = useErrorRecovery(
    player,
    recoverSourceUrl ?? streamingUrl,
    castRemoteActive,
    getHealthyPosition,
  )

  // Releases the pre-autostart suppression below for a load that neither starts
  // nor errors (the host's `loadFailed` covers one that errors). Without both, a
  // viewer whose playback never starts is stranded on a spinner with no controls.
  const [loadTimedOut, setLoadTimedOut] = useState(false)

  useEffect(() => {
    setLoadTimedOut(false)
  }, [player, streamingUrl])

  // An autostarting player opens on its poster, not on transport chrome: a play
  // button and a 0:00 scrubber for a video about to start itself reads as
  // broken. Suppress chrome until the first frame plays. `hasStarted` never
  // resets, so this covers the initial load only — a later language swap keeps
  // the chrome it already had.
  const awaitingAutostart =
    autostart &&
    !hasStarted &&
    streamingUrl != null &&
    !loadFailed &&
    !loadTimedOut &&
    // A cast session replaces the veil with its own R16/R7 states — the
    // chrome must mount so the held transport and Cast button are reachable.
    !castRemoteActive &&
    // Latched: once a session ended, the chrome and route buttons stay the
    // recovery surface — never a re-engaged 12s dead veil.
    !castTouchedRef.current

  // Backstop for a load that neither starts nor errors. Releasing early only
  // reveals chrome sooner, so a false positive on a slow network is harmless —
  // being stuck with no controls is not.
  useEffect(() => {
    if (!awaitingAutostart) return
    const t = setTimeout(() => setLoadTimedOut(true), AUTOSTART_VEIL_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [awaitingAutostart])

  // AirPlay (iOS): track native external playback. Subscribed once per
  // PLAYER so a source swap on the same player cannot drop an active route.
  const [airPlayActive, setAirPlayActive] = useState(false)
  useEffect(() => {
    const sub = player.addListener(
      "isExternalPlaybackActiveChange",
      ({ isExternalPlaybackActive }: { isExternalPlaybackActive: boolean }) =>
        setAirPlayActive(isExternalPlaybackActive),
    )
    // Seed from the live player — a player handed over already routing
    // never re-fires the change event.
    try {
      setAirPlayActive(player.isExternalPlaybackActive === true)
    } catch {
      // Player already released
    }
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [player])
  // KTD9: one predicate for the indicator and the subtitle gate.
  const externalRouteActive = isExternalRouteActive({
    airPlayActive,
    castActive: castRemoteActive,
  })

  const controls = useControlsVisibility(player)

  // Settings sheet (U4): component state, never a route — a routed form sheet
  // cannot present over the fullscreen player (KTD5). The floating window
  // hides beneath it like every other in-app sheet (R11).
  const [settingsOpen, setSettingsOpen] = useState(false)
  useNonRouteSheetSuppression(settingsOpen, "playerSettings")

  // One expression for both chrome render gates below, so they can't drift.
  const chromeMounted = controls.mounted && !awaitingAutostart

  // Tap disambiguation (U4): single tap toggles chrome (revealed on press-in
  // so it never lags, KTD3); second tap within DOUBLE_TAP_MS seeks the tapped
  // half ±10s with a brief indicator, independent of chrome visibility.
  const tapWidthRef = useRef(0)
  const wasVisibleRef = useRef(true)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [seekFlash, setSeekFlash] = useState<{
    side: SeekSide
    delta: number
  } | null>(null)
  // A monotonically-bumped signal so PlayerControls can reflect a double-tap
  // seek in its time label/scrubber immediately — even while paused, when its
  // own 500ms poll is idle.
  const [seekSignal, setSeekSignal] = useState<{
    time: number
    n: number
  } | null>(null)
  const seekNonceRef = useRef(0)

  // Play and seek latch SEPARATELY: resumeAtSeconds hydrates async and can
  // arrive after the source loads, so one shared latch would forfeit the
  // seek and let playback from 0 overwrite the saved position.
  const autoPlayedRef = useRef(false)
  const resumeSeekedRef = useRef(false)
  // Gates the foreground retry below: retrying before the source has loaded
  // would call play() on an item that is not ready.
  const sourceLoadedRef = useRef(false)
  useEffect(() => {
    autoPlayedRef.current = false
    resumeSeekedRef.current = false
    sourceLoadedRef.current = false
  }, [streamingUrl])
  useEffect(() => {
    if (!autostart) return

    const applySeek = () => {
      // A session owns playback (KTD4); the cast recovery is the resume.
      if (castRemoteActiveRef.current) return
      if (resumeSeekedRef.current || resumeAtSeconds == null) return
      try {
        player.currentTime = resumeAtSeconds
      } catch {
        return // Released mid-seek; leave unlatched so a later pass retries.
      }
      resumeSeekedRef.current = true
      // The scrubber polls at 500ms and is idle until playback reports in,
      // so signal it or the restored position reads 0:00 for a beat.
      seekNonceRef.current += 1
      setSeekSignal({ time: resumeAtSeconds, n: seekNonceRef.current })
    }

    const applyPlay = () => {
      // Never start local audio under an active session (KTD4).
      if (castRemoteActiveRef.current) return
      if (autoPlayedRef.current) return
      // Never start audio the viewer cannot see. The adapter owns AppState
      // resume and has no way to observe or undo a play issued from here
      // while backgrounded.
      if (AppState.currentState !== "active") return
      try {
        player.play()
      } catch {
        return // Released; leave unlatched so a later load can still start.
      }
      autoPlayedRef.current = true
      // Reported only once playback actually started, so the adoption metric
      // cannot count a released player as a successful autostart.
      reportDatadogAction("autostart_applied", {
        resumed: resumeSeekedRef.current,
      })
    }

    const onSourceLoad = () => {
      sourceLoadedRef.current = true
      applySeek()
      applyPlay()
    }
    const sub = player.addListener("sourceLoad", onSourceLoad)
    // applyPlay bails without latching while backgrounded, sourceLoad fires
    // once per source, and the adapter's foreground resume only replays a
    // video that was ALREADY playing — so nothing else retries this. Without
    // the retry, backgrounding through the load window leaves the veil up for
    // good.
    const appSub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || !sourceLoadedRef.current) return
      applySeek()
      applyPlay()
    })
    // A resume position can hydrate after the source already loaded — seek
    // then, rather than losing it. Guarded on having played so this never
    // fires against a previous, still-loaded source mid-swap.
    if (autoPlayedRef.current) applySeek()
    return () => {
      sub.remove()
      appSub.remove()
    }
  }, [player, resumeAtSeconds, streamingUrl, autostart])

  // ---- Cast session (U4, KTD4) ----

  const hasStartedRef = useRef(false)
  useEffect(() => {
    hasStartedRef.current = hasStarted
  }, [hasStarted])
  const resumeAtRef = useRef(resumeAtSeconds)
  resumeAtRef.current = resumeAtSeconds

  // Start position for the receiver (KTD5): the local playhead once one
  // exists, else the pending resume position — never the untouched 0:00.
  const readCastStartPosition = useCallback(() => {
    if (!hasStartedRef.current && !resumeSeekedRef.current) {
      return resumeAtRef.current
    }
    try {
      return player.currentTime
    } catch {
      return null
    }
  }, [player])

  // Live receiver position for mid-session reloads; cleared per session so a
  // previous session's playhead cannot seed the next one's first load.
  const castPositionRef = useRef<number | null>(null)

  // Session start: pause the local player (the screen's source pin keeps it
  // frozen on the pre-session URL).
  const wasPlayingBeforeCastRef = useRef(false)
  useEffect(() => {
    if (!castRemoteActive) return
    castPositionRef.current = null
    // Captured before the pause: a connect that never goes active restores it.
    let wasPlaying = false
    try {
      wasPlaying = player.playing === true
      player.pause()
    } catch {
      // Player already released
    }
    wasPlayingBeforeCastRef.current = wasPlaying
  }, [castRemoteActive, player])

  // A session that leaves Connecting without going Active (dialog cancel,
  // connect failure) hands playback back — the failure recovery carries
  // resume=false (no remote media ever played), so recover here instead.
  const prevCastPhaseRef = useRef(castPhase)
  useEffect(() => {
    const previous = prevCastPhaseRef.current
    prevCastPhaseRef.current = castPhase
    // A live session burns the capture: an in-session reconnect must not
    // consume the ORIGINAL flag and resume at the pre-session position.
    if (castPhase === "active") {
      wasPlayingBeforeCastRef.current = false
    }
    if (previous !== "connecting") return
    if (isRemoteCastPhase(castPhase)) return
    if (wasPlayingBeforeCastRef.current) {
      wasPlayingBeforeCastRef.current = false
      // Mirrors applyPlay: never start audio the viewer cannot see.
      if (AppState.currentState !== "active") return
      try {
        player.play()
      } catch {
        // Player already released
      }
      return
    }
    // The viewer cast under the veil, so the session suppressed the
    // autostart; a dead connect must restore it, under applyPlay's guards.
    if (
      autostart &&
      !autoPlayedRef.current &&
      sourceLoadedRef.current &&
      AppState.currentState === "active"
    ) {
      try {
        player.play()
        autoPlayedRef.current = true
      } catch {
        // Player already released
      }
    }
  }, [castPhase, player, autostart])

  const castPosition = castPlayback?.position ?? null
  useEffect(() => {
    if (castPosition != null) castPositionRef.current = castPosition
  }, [castPosition])

  // KTD9: cast start routes AirPlay back to the phone — allowsExternalPlayback
  // is the only lever expo-video exposes to end an active AirPlay route.
  // Session end restores it.
  useEffect(() => {
    try {
      player.allowsExternalPlayback = !castRemoteActive
    } catch {
      // Player already released
    }
  }, [castRemoteActive, player])

  // KTD9, other direction: AirPlay activation while casting ends the session.
  const castEndRef = useRef<(() => void) | null>(null)
  castEndRef.current = castPlayback?.end ?? null
  useEffect(() => {
    if (airPlayActive && castRemoteActiveRef.current) castEndRef.current?.()
  }, [airPlayActive])

  // Media sync: load on connect, reload on dub switch (R9). Also keyed on the
  // load identity — it changes when the SDK client becomes available, which
  // retries the load a null client swallowed while connecting.
  const castLoad = castPlayback?.load ?? null
  const lastCastLoadRef = useRef<{ load: unknown; url: string } | null>(null)
  useEffect(() => {
    if (!castRemoteActive || castLoad == null || resolveCastMediaAt == null) {
      lastCastLoadRef.current = null
      return
    }
    const media = resolveCastMediaAt(
      castPositionRef.current ?? readCastStartPosition(),
    )
    if (media == null) return
    const previous = lastCastLoadRef.current
    if (
      previous != null &&
      previous.load === castLoad &&
      previous.url === media.contentUrl
    ) {
      return
    }
    lastCastLoadRef.current = { load: castLoad, url: media.contentUrl }
    castLoad(media)
  }, [castRemoteActive, castLoad, resolveCastMediaAt, readCastStartPosition])

  // End recovery (R10/R13): one latch per terminal state. The recovery seek
  // supersedes the autostart resume for this source, so burn those latches.
  const lastCastRecoveryRef = useRef<CastRecovery | null>(null)
  const pendingCastRecoveryRef = useRef<CastRecovery | null>(null)

  const applyCastRecovery = useCallback(() => {
    const pending = pendingCastRecoveryRef.current
    if (pending == null) return
    pendingCastRecoveryRef.current = null
    try {
      if (pending.positionSeconds != null) {
        player.currentTime = pending.positionSeconds
      }
      // R10: the local player keeps the session's play/pause state — but
      // never starts audio into a backgrounded app (mirrors applyPlay).
      if (pending.resume && AppState.currentState === "active") {
        player.play()
      }
    } catch {
      // R16 shape (adapter's swap/foreground): a silent recovery failure is
      // the "came back and it was frozen" bug.
      datadogLog.warn("video.resume_failed", {
        content_id: extractMuxPlaybackId(streamingUrlRef.current),
        surface: "cast_recovery",
      })
      return
    }
    if (pending.positionSeconds != null) {
      seekNonceRef.current += 1
      setSeekSignal({ time: pending.positionSeconds, n: seekNonceRef.current })
    }
  }, [player])

  useEffect(() => {
    if (castRecovery == null || castRecovery === lastCastRecoveryRef.current) {
      return
    }
    lastCastRecoveryRef.current = castRecovery
    pendingCastRecoveryRef.current = castRecovery
    autoPlayedRef.current = true
    resumeSeekedRef.current = true
    // A swapped or still-loading source applies on its sourceLoad instead —
    // a seek set before the item loads is discarded with it.
    if (!castRecovery.sourceSwapped && sourceLoadedRef.current) {
      applyCastRecovery()
    }
  }, [castRecovery, applyCastRecovery])

  // Persistent listener (never resubscribed mid-flight): applies a pending
  // recovery once the released pin's swap finishes loading.
  useEffect(() => {
    const sub = player.addListener("sourceLoad", () => applyCastRecovery())
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [player, applyCastRecovery])

  // KTD4: ONE target for the transport and the double-tap seek; null keeps
  // the live local player.
  let castTarget: PlaybackTarget | null = null
  if (castPlayback != null && castRemoteActive) {
    let fallbackPositionSeconds = 0
    let fallbackDurationSeconds = 0
    try {
      fallbackPositionSeconds = player.currentTime
      fallbackDurationSeconds = player.duration
    } catch {
      // Player already released
    }
    castTarget = selectPlaybackTarget({
      phase: castPhase,
      position: castPlayback.position,
      duration: castPlayback.duration,
      remotePlayerState: castPlayback.remotePlayerState,
      play: castPlayback.play,
      pause: castPlayback.pause,
      seekTo: castPlayback.seekTo,
      fallbackPositionSeconds,
      fallbackDurationSeconds,
    })
  }

  const castUi: PlayerControlsCastUi | null =
    castPlayback != null && onCastPress != null
      ? {
          available: castPlayback.devicesAvailable,
          connected: castRemoteActive,
          label: castButtonLabel(castPhase, castPlayback.deviceName),
          onPress: onCastPress,
        }
      : null

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [])

  const showSeekFlash = useCallback((side: SeekSide, delta: number) => {
    setSeekFlash({ side, delta })
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setSeekFlash(null), 600)
  }, [])

  const doSideSeek = useCallback(
    (locationX: number) => {
      const delta = seekDeltaForTap(
        locationX,
        tapWidthRef.current,
        SKIP_SECONDS,
      )
      if (delta === 0) return
      // KTD4: a session routes the side seek to the cast target; a held
      // transport (R16, connecting) accepts no seeks at all.
      if (castTarget != null) {
        if (castTarget.held) return
        const target = applySkip(
          castTarget.currentTime,
          delta,
          castTarget.duration,
        )
        if (target == null) return
        castTarget.seekTo(target)
        seekNonceRef.current += 1
        setSeekSignal({ time: target, n: seekNonceRef.current })
        const side = seekSideForTap(locationX, tapWidthRef.current)
        if (side) showSeekFlash(side, delta)
        return
      }
      const target = applySkip(player.currentTime, delta, player.duration)
      if (target == null) return
      player.currentTime = target
      seekNonceRef.current += 1
      setSeekSignal({ time: target, n: seekNonceRef.current })
      const side = seekSideForTap(locationX, tapWidthRef.current)
      if (side) showSeekFlash(side, delta)
    },
    [player, showSeekFlash, castTarget],
  )

  const handleTapPressIn = useCallback(() => {
    // Read ground-truth visibility (the ref), NOT controls.controlsVisible —
    // the render state lags by one fade, so mid-auto-hide it still reads true
    // and the pending single-tap would hide the chrome this press just revealed.
    wasVisibleRef.current = controls.isVisibleNow()
    controls.revealIfHidden()
  }, [controls])

  const handleTapPress = useCallback(
    (e: GestureResponderEvent) => {
      const { locationX } = e.nativeEvent
      if (classifyTap(singleTapTimerRef.current != null) === "double") {
        // Second tap within the window → seek. Cancel the pending single-tap
        // FIRST, else the stale timer fires after the seek and hides chrome.
        if (singleTapTimerRef.current != null) {
          clearTimeout(singleTapTimerRef.current)
          singleTapTimerRef.current = null
        }
        doSideSeek(locationX)
        return
      }
      const wasVisible = wasVisibleRef.current
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null
        // Single tap resolved: hide only if chrome was already up; if it was
        // hidden it was just revealed on press-in, so leave it visible (R3).
        // Skipped while the veil is up: the chrome is unmounted, so this would
        // hide something invisible and playback would then start with no
        // controls until the viewer taps again.
        if (awaitingAutostart) return
        if (singleTapAction(wasVisible) === "hide") controls.hide()
      }, DOUBLE_TAP_MS)
    },
    [awaitingAutostart, controls, doSideSeek],
  )

  // Caption offset: inline = fixed on the button row; fullscreen = lifts above
  // the control bar while chrome shows (so a 2-line caption never covers the
  // timeline) and drops back when it hides (animated). Padding clears the icons.
  const insets = useSafeAreaInsets()
  const subtitleBottomOffset = fullscreen
    ? controls.controlsVisible
      ? fullscreenCaptionOffset(insets.bottom)
      : SUBTITLE_OFFSET_FS_CHROME_HIDDEN
    : SUBTITLE_OFFSET_INLINE
  const subtitleHorizontalInset = fullscreen
    ? Math.max(insets.left, insets.right, 56)
    : 56
  const subtitleFontSize = fullscreen ? 22 : 16

  return (
    // absoluteFill, not a sized box: the host's frame owns the geometry (KTD17)
    // and paints the letterbox black behind the video view this chrome covers.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* R7: the phone shows the poster while the TV plays — the paused
          local frame would read as a broken player. Ended reuses the layer so
          the replay state never sits on a black last frame. */}
      {(!hasStarted || castRemoteActive || ended) && resolvedPoster != null && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: posterFade }]}
        >
          <Image
            source={resolvedPoster}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey="watch-poster"
            accessibilityLabel="Video thumbnail"
          />
        </Animated.View>
      )}

      {awaitingAutostart && <PlayerLoadingVeil />}

      {/* R16: distinct connecting state — dim + spinner under the chrome,
          named by the indicator band below. */}
      {castPhase === "connecting" && <PlayerLoadingVeil />}

      {/* Full-bleed tap target behind the chrome (controls layer is box-none,
          subtitle overlay is pointerEvents none, so empty-area taps fall here).
          Tap toggles controls; double tap on a side seeks ±10s. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onLayout={(e: LayoutChangeEvent) => {
          tapWidthRef.current = e.nativeEvent.layout.width
        }}
        onPressIn={handleTapPressIn}
        onPress={handleTapPress}
        accessibilityRole="button"
        accessibilityLabel="Toggle player controls"
      />

      {seekFlash != null && (
        <View
          pointerEvents="none"
          style={[
            styles.seekFlash,
            seekFlash.side === "left"
              ? styles.seekFlashLeft
              : styles.seekFlashRight,
          ]}
        >
          <Ionicons
            name={seekFlash.delta < 0 ? "play-back" : "play-forward"}
            size={22}
            color={TEXT_ON_OVERLAY}
          />
          <Text style={styles.seekFlashText}>{Math.abs(seekFlash.delta)}s</Text>
        </View>
      )}

      {/* R14: the route buttons stay reachable while the veil suppresses the
          chrome — a viewer may cast before local playback ever starts. */}
      {awaitingAutostart && (
        <View style={styles.veilRouteRow} pointerEvents="box-none">
          <RouteButtons
            externalPlaybackActive={airPlayActive}
            castUi={castUi}
          />
        </View>
      )}

      {/* External-route indicator — the phone shows no video while the route
          plays it, so name where playback went. Top band, clear of the
          transport row; pointerEvents none keeps every control usable (R5). */}
      {externalRouteActive && (
        <View pointerEvents="none" style={styles.externalRouteIndicator}>
          <Ionicons name="tv-outline" size={28} color={TEXT_ON_OVERLAY} />
          <Text style={styles.externalRouteText}>
            {castRemoteActive
              ? castIndicatorLabel(castPhase, castPlayback?.deviceName ?? null)
              : "Playing on AirPlay"}
          </Text>
        </View>
      )}

      {/* Chrome scrim — fades with the chrome and sits BELOW the subtitle so it
          never dims the caption. */}
      {chromeMounted && (
        <Animated.View
          pointerEvents="none"
          style={[styles.chromeScrim, { opacity: controls.opacityAnim }]}
        >
          <LinearGradient
            colors={[
              hexToRgba(BLACK, 0),
              hexToRgba(BLACK, 0.2),
              hexToRgba(BLACK, 0.7),
            ]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}

      {/* Captions sit ABOVE the scrim but BELOW the controls so the timeline
          always draws over a tall caption. Outside the fade wrapper so they
          stay visible when the controls auto-hide. Gated on hasStarted: captions
          stay hidden until the first play (a cue covering t=0 would otherwise
          paint over the un-started poster), then persist through pauses. */}
      <SubtitleOverlay
        player={player}
        // No video on the phone during an external route, so no caption (KTD9).
        vttSrc={hasStarted && !externalRouteActive ? subtitleVttSrc : null}
        bottomOffset={subtitleBottomOffset}
        horizontalInset={subtitleHorizontalInset}
        fontSize={subtitleFontSize}
        animate={fullscreen}
      />

      {/* Chrome controls — fade with the chrome and layer OVER the subtitle, so
          the timeline/buttons are always on top of the captions (R: timeline
          must stay visible). */}
      {chromeMounted && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: controls.opacityAnim }]}
          pointerEvents="box-none"
        >
          <PlayerControls
            player={player}
            fullscreen={fullscreen}
            onFullscreen={onToggleFullscreen}
            onInteract={controls.noteInteraction}
            seekSignal={seekSignal}
            externalPlaybackActive={airPlayActive}
            castUi={castUi}
            castTarget={castTarget}
            onOpenSettings={() => setSettingsOpen(true)}
            onRecover={handleRecover}
            isOnline={isOnline}
          />
        </Animated.View>
      )}

      {settingsOpen && (
        <PlayerSettingsSheet
          onClose={() => setSettingsOpen(false)}
          castActive={castRemoteActive}
          streamingUrl={streamingUrl}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  chromeScrim: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  // Mirrors the chrome's top-right route-button placement so the buttons do
  // not jump when the veil hands over to the full chrome.
  veilRouteRow: {
    position: "absolute",
    top: 8,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  // Top band: stays clear of the centered transport row and the bottom bar.
  externalRouteIndicator: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    paddingTop: 20,
    gap: 4,
  },
  externalRouteText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
  },
  seekFlash: {
    position: "absolute",
    top: "50%",
    marginTop: -28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: hexToRgba(BLACK, 0.55),
  },
  seekFlashLeft: {
    left: "14%",
  },
  seekFlashRight: {
    right: "14%",
  },
  seekFlashText: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
})
