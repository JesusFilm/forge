/**
 * The root playback host (U6, KTD17). It owns the app's ONE player and its ONE
 * video view, mounted above the stack and absolutely positioned at the rect the
 * current surface measured for it — or, once no surface owns it, at the
 * floating window's corner (U7).
 *
 * The chrome rides in this layer too, not in the route. The host paints above
 * the stack by construction (KTD1), and the screens behind it are opaque
 * (`layout.screenContainer` in `src/styles/shared.ts`, plus the Stack's own
 * `contentStyle`), so a video view under the stack would be hidden and a video
 * view over it would cover the controls. One frame holding both preserves the
 * exact layering the component had before the hoist.
 *
 * The video view keeps ONE position in this tree in every state (KTD17): the
 * full view and the window differ only in the frame's geometry and in which
 * chrome renders beside it. Moving it would remount the surface, which is the
 * black flash R1 forbids.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  Animated,
  AppState,
  BackHandler,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { useRouter, useSegments } from "expo-router"
import { VideoView, type VideoPlayerStatus } from "expo-video"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import {
  useManagedVideoPlayer,
  type SwapPositionClaim,
} from "../../hooks/useManagedVideoPlayer"
import { getAuthSession } from "../../lib/authSession"
import { BLACK } from "../../lib/color"
import { datadogLog } from "../../lib/datadog"
import { OFFLINE_ROOT } from "../../lib/offlineFileSystem"
import {
  isDubSwap,
  isOfflineContainerSwap,
  offlineSwapClaim,
} from "../../lib/playerSource"
import { validateLocalMediaUrl } from "../../lib/validateLocalMediaUrl"
import { TAB_BAR_OCCUPIED_HEIGHT } from "../../lib/tabBar"
import { isTabletLayout } from "../../hooks/useIsTabletLayout"
import {
  getReaderMovementBand,
  readerMovementBandHeight,
  subscribeReaderMovementBand,
} from "../../lib/bible/reader/chrome"
import {
  DEFAULT_CORNER,
  defaultCornerFrame,
  frameGeometry,
  dismissMode,
  miniPlayerCornerFrame,
  readerCornerPolicy,
  type MiniPlayerCorner,
  type MiniPlayerFrame,
  type MiniPlayerLayoutConfig,
} from "../../lib/miniPlayer/layout"
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_QUALITY_TIER,
  effectivePlayerSettings,
  getPlayerSettingsStore,
} from "../../lib/miniPlayer/playerSettings"
import {
  getPlaybackRequestStore,
  sameStreamSource,
  sourceForRequest,
  type LoadedSource,
  type PlaybackRect,
  type PlaybackRequest,
  type PlaybackRequestSnapshot,
} from "../../lib/miniPlayer/playbackRequest"
import { pictureInPictureViewProps } from "../../lib/miniPlayer/pictureInPicture"
import {
  expandAction,
  isReaderCovering,
  miniPlayerPresentation,
  readerRouteKind,
  type ExpandAction,
} from "../../lib/miniPlayer/presentation"
import {
  getMiniPlayerStore,
  sameSessionContent,
  type MiniPlayerEndedCause,
  type MiniPlayerSession,
} from "../../lib/miniPlayer/store"
import {
  getNonRouteSheetCounter,
  routePattern,
} from "../../lib/miniPlayer/suppression"
import { isSameMuxAsset } from "../../lib/muxThumbnail"
import { BACK_BUTTON_PROPS } from "../../lib/playerLayout"
import {
  applyQualityConstraint,
  sameQualityConstraint,
  type QualityTier,
} from "../../lib/streamQuality"
import type { ProgressIdentity } from "../../lib/watchProgress/recorder"
import { resumePositionSeconds } from "../../lib/watchProgress/thresholds"
import { FloatingBackButton } from "../ui/FloatingBackButton"
import { MiniPlayerWindow } from "./MiniPlayerWindow"
import { VideoPlayer } from "./VideoPlayer"

/** KTD17's shrink: fixed duration, started when the pop commits. Distinct from
 *  every other duration here (and from ENDED_FADE_DURATION_MS, 320) so a timing
 *  stays attributable by duration. */
export const SHRINK_DURATION_MS = 400

/** KTD17 in reverse: the expanded surface grows out of its corner back into
 *  the player rect — the same interpolation as the shrink, never a jump. */
export const EXPAND_DURATION_MS = 300

/** An expand tap pins the window's corner frame while the push re-derives the
 *  chrome; a hold this old is a failed navigation and re-follows live chrome. */
export const EXPAND_HOLD_TIMEOUT_MS = 2000

/** A chrome change while the window rests (a push hides the tab bar, a pop
 *  restores it) glides the window to its re-derived corner — never a teleport.
 *  Distinct from every other duration for test attribution. */
export const REPOSITION_DURATION_MS = 260

/** R6's downward exit. */
export const EXIT_DURATION_MS = 220

/** Past the bottom edge, so the last frame of the exit is off screen. */
const EXIT_CLEARANCE = 24

/** The chrome gate's unconditional release — an interrupted shrink must never
 *  leave a window with no controls and no way out. */
const CHROME_RELEASE_SLACK_MS = 250

/** The exit's unconditional release — a dismissed window must clear its session
 *  even when the animation never reports back. */
const EXIT_RELEASE_SLACK_MS = 250

/** Why the resume latch was armed. Only a quality swap has a tier to revert. */
type ResumeReason = "quality" | "offline" | "dub"

/** Each cause keeps its own release event: a shared name would mix two
 *  causes while every existing count assertion still passed. */
const NON_QUALITY_RELEASE_EVENT: Record<
  Exclude<ResumeReason, "quality">,
  string
> = {
  offline: "player.offline_swap_resume_released",
  dub: "player.dub_swap_resume_released",
}

/** A tier-change swap that neither loads nor errors within this budget
 *  releases its pending resume and reverts the tier (R8's failure path). */
export const QUALITY_SWAP_TIMEOUT_MS = 8000

/** Chrome heights the window may not cover (R7). Both exclude the safe-area
 *  inset, which the corner geometry already subtracts. The bottom reservation
 *  applies on every route so the window keeps one height across pushes. */
export const TAB_BAR_CONTENT_HEIGHT = TAB_BAR_OCCUPIED_HEIGHT
const NATIVE_HEADER_HEIGHT = Platform.select({
  ios: 44,
  android: 56,
  default: 44,
})

/** The two routes `app/_layout.tsx` gives a native header. */
const HEADER_ROUTE_PATTERNS: ReadonlySet<string> = new Set([
  "video/[sectionKey]",
  "collection/[sectionKey]",
])

/**
 * Whether the one video view mounts, decided at RENDER time. `endedCause` is a
 * term of its own because the window hides its thumbnail imperatively in a
 * child effect the moment a replay clears the cause — a parent-effect re-arm
 * alone leaves a black frame between the two (R21/R27).
 */
export function shouldDrawSurface(input: {
  pipHeld: boolean
  hasSurfaceVideo: boolean
  hasRect: boolean
  endedCause: MiniPlayerEndedCause | null
  surfaceReleased: boolean
}): boolean {
  // Never gated away under the hold: unregistering the view mid-OS-window
  // fires expo-video's unguarded native path (R24).
  if (input.pipHeld) return true
  if (!input.hasSurfaceVideo) return false
  return input.hasRect || input.endedCause == null || !input.surfaceReleased
}

/** The identity the host trusts: the published one, unless it names this same
 *  video by a weaker key (none, or a slug over a known id) or drops a known dub. */
export function holdProgressIdentity(
  published: ProgressIdentity | null,
  known: ProgressIdentity | null,
): ProgressIdentity | null {
  if (known == null) return published
  if (published == null) return known
  if (published.videoId == null && known.videoId != null) return known
  if (
    published.videoId === known.videoId &&
    published.languageSlug == null &&
    known.languageSlug != null
  )
    return known
  return published
}

/** One box, so one motion's path is exactly the reverse of the other's. */
function sameRect(a: PlaybackRect, b: PlaybackRect): boolean {
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  )
}

/** One frame transition. A shrink into a corner other than the base frame's
 *  starts from its rect minus the drag; `departed` keeps the rect itself. */
type FrameMotion = {
  from: PlaybackRect
  to: PlaybackRect
  anchor: "from" | "to"
  departed?: PlaybackRect
}

function offsetRect(r: PlaybackRect, by: { x: number; y: number }) {
  return { x: r.x + by.x, y: r.y + by.y, width: r.width, height: r.height }
}

/** R4's tap pins the pre-push frames until the grow consumes them: the pushed
 *  route re-derives the corner chrome before the rect arrives. */
type ExpandHold = {
  windowFrame: MiniPlayerFrame
  cornerFrame: MiniPlayerFrame
  at: number
}

/** One freshness rule for the render and the effect: a hold is live only for a
 *  floating session inside the push window. */
function liveExpandHold(
  hold: ExpandHold | null,
  hasSession: boolean,
  now: number,
): ExpandHold | null {
  if (hold == null || !hasSession) return null
  return now - hold.at <= EXPAND_HOLD_TIMEOUT_MS ? hold : null
}

/**
 * The router bridge. Everything below it is router-free so the window's target
 * and its back answer are injected rather than imported (KTD11, KTD4).
 */
export function PlaybackHost() {
  const segments = useSegments()
  const router = useRouter()

  const canGoBack = useCallback(() => {
    try {
      return router.canGoBack()
    } catch {
      return false
    }
  }, [router])

  const onExpand = useCallback(
    (session: MiniPlayerSession, action: ExpandAction) => {
      // feat-551 AE14: the watch screen is already under the reader, so going
      // back to it keeps one watch screen in the stack.
      if (action === "pop") {
        router.back()
        return
      }
      router.push(`/watch/${encodeURIComponent(session.videoSlug)}` as never)
    },
    [router],
  )

  return (
    <PlaybackHostView
      segments={segments}
      canGoBack={canGoBack}
      onExpand={onExpand}
    />
  )
}

export type PlaybackHostViewProps = {
  segments: readonly string[]
  canGoBack: () => boolean
  onExpand: (session: MiniPlayerSession, action: ExpandAction) => void
}

export function PlaybackHostView({
  segments,
  canGoBack,
  onExpand,
}: PlaybackHostViewProps) {
  const store = getPlaybackRequestStore()
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const sessionStore = getMiniPlayerStore()
  const pipHeld = useSyncExternalStore(
    sessionStore.subscribe,
    () => sessionStore.getSnapshot().pipHold,
  )
  // feat-551 KTD11: the reader's own corner, kept here because the active host
  // unmounts between videos and AE18 wants the next reader visit to start at
  // it. Null means the device's start corner; the app corner stays separate.
  const [readerCorner, setReaderCorner] = useState<MiniPlayerCorner | null>(
    null,
  )

  // R25/KTD15, wired here rather than inside the player: this component is
  // mounted for the app's whole life, so the subject watch outlives every
  // session it has to end. attachAuthSession returns its own detach.
  useEffect(() => getMiniPlayerStore().attachAuthSession(getAuthSession()), [])

  // R24: an ending that is not a dismissal (a subject change, an adapter safety
  // net) drops the request while the OS window is still up, and unmounting the
  // view there fires expo-video's unguarded native path. Held, not adopted —
  // and only ACROSS a hold: the SDUI screens feed the same latch, so a request
  // that died unheld must not come back as a phantom on their PiP entry.
  const lastRequestRef = useRef<PlaybackRequest | null>(null)
  if (snapshot.request != null) lastRequestRef.current = snapshot.request
  else if (!pipHeld) lastRequestRef.current = null
  const request = snapshot.request ?? (pipHeld ? lastRequestRef.current : null)

  // No request, no player: the app carries no native player (and no cold-launch
  // cost) until a surface asks for one, and releasing it is how a dismissed
  // session gives the decoder back.
  if (request == null) return null
  return (
    <ActivePlaybackHost
      snapshot={snapshot}
      request={request}
      segments={segments}
      canGoBack={canGoBack}
      onExpand={onExpand}
      readerCorner={readerCorner}
      onReaderCornerChange={setReaderCorner}
    />
  )
}

function ActivePlaybackHost({
  snapshot,
  request,
  segments,
  canGoBack,
  onExpand,
  readerCorner,
  onReaderCornerChange,
}: {
  snapshot: PlaybackRequestSnapshot
  request: PlaybackRequest
  segments: readonly string[]
  canGoBack: () => boolean
  onExpand: (session: MiniPlayerSession, action: ExpandAction) => void
  readerCorner: MiniPlayerCorner | null
  onReaderCornerChange: (corner: MiniPlayerCorner) => void
}) {
  const store = getPlaybackRequestStore()
  const sessionStore = getMiniPlayerStore()
  const sheetCounter = getNonRouteSheetCounter()
  const publishedIdentity = useMemo<ProgressIdentity | null>(() => {
    if (request.progressVideoId != null)
      return {
        videoId: request.progressVideoId,
        languageSlug: request.progressLanguageSlug,
      }
    if (request.progressVideoSlug != null)
      return {
        videoSlug: request.progressVideoSlug,
        languageSlug: request.progressLanguageSlug,
      }
    return null
  }, [
    request.progressVideoId,
    request.progressVideoSlug,
    request.progressLanguageSlug,
  ])

  const sessionSnapshot = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
  )

  // R4: what the player already holds, so a screen remounting onto the video it
  // is playing adopts it rather than reloading it from zero.
  // Status mirrored from the listener below so the published play flag can
  // tell a rebuffer from a pause; the latch separates a rebuffer from an
  // initial load, which never played.
  const [playerStatus, setPlayerStatus] = useState<VideoPlayerStatus | null>(
    null,
  )
  const hasPlayedRef = useRef(false)

  const loadedSourceRef = useRef<LoadedSource | null>(null)
  const requestLanguage =
    request.session?.languageSlug ?? request.progressLanguageSlug ?? null
  const adoptable =
    sessionSnapshot.session != null &&
    request.session != null &&
    sameSessionContent(request.session, sessionSnapshot.session)
  // A download that completes (or is deleted) under an adopted session is the
  // same video in a new container. The pin exists for a remount's OTHER url of
  // one stream, so a local/remote flip must reach the player through it.
  const isLocal = (url: string) => validateLocalMediaUrl(url, OFFLINE_ROOT)
  const loadedUrl = loadedSourceRef.current?.url ?? null
  const containerChanged =
    loadedUrl != null &&
    request.streamingUrl != null &&
    isLocal(loadedUrl) !== isLocal(request.streamingUrl)
  // A remount's first render publishes a download before its dub settles, so
  // a container flip with no language is not a swap yet: adoption holds until
  // the request names a dub, which a real completion or deletion always does.
  const settledContainerChange = containerChanged && requestLanguage != null
  const sourceUrl = sourceForRequest({
    requested: request.streamingUrl,
    loaded: loadedSourceRef.current,
    language: requestLanguage,
    adoptable: adoptable && !settledContainerChange,
  })
  if (sourceUrl != null && sourceUrl === request.streamingUrl) {
    // Handed to the player, so it becomes what the player holds. A known dub is
    // never downgraded to null by a remount that has not resolved one yet.
    loadedSourceRef.current = {
      url: sourceUrl,
      languageSlug:
        requestLanguage ?? loadedSourceRef.current?.languageSlug ?? null,
    }
  }

  // Keyed on the SLUG, which is required on the descriptor and stable across
  // the record load — the seed path flips videoId null -> documentId
  // MID-playback. Shared by the settings seam and the started/ended latch.
  const videoKey = request.session
    ? request.session.videoSlug
    : (request.streamingUrl ?? "")

  // A remounting screen resolves its record a commit after it publishes, so a
  // known identity (and its dub) is never downgraded to null by a remount that
  // has not resolved one yet — loadedSourceRef's rule, on the same slug key.
  const knownIdentityRef = useRef<{
    videoKey: string
    identity: ProgressIdentity
  } | null>(null)
  const knownIdentity =
    knownIdentityRef.current?.videoKey === videoKey
      ? knownIdentityRef.current.identity
      : null
  const progressIdentity = holdProgressIdentity(
    publishedIdentity,
    knownIdentity,
  )
  if (
    progressIdentity != null &&
    progressIdentity !== knownIdentity &&
    videoKey !== ""
  )
    knownIdentityRef.current = { videoKey, identity: progressIdentity }

  const settingsStore = getPlayerSettingsStore()
  const settingsSnapshot = useSyncExternalStore(
    settingsStore.subscribe,
    settingsStore.getSnapshot,
  )
  const effectiveSettings = effectivePlayerSettings(settingsSnapshot, videoKey)
  // KTD1: the ONE constraint seam. Host bookkeeping above stays on RAW urls;
  // only the adapter sees the constrained one, so every swap (dub change
  // included) inherits the active tier.
  const constrainedSourceUrl = useMemo(
    () =>
      sourceUrl == null
        ? null
        : applyQualityConstraint(sourceUrl, effectiveSettings.qualityTier),
    [sourceUrl, effectiveSettings.qualityTier],
  )

  // R13's takeover reset and the key's activation in ONE call: an equal key
  // preserves the settings (minimize/restore, remount — AE6); a different one
  // clears them (AE5). An empty key (a sourceless gap) names nothing: skip it.
  useEffect(() => {
    if (videoKey !== "") settingsStore.resetFor(videoKey)
  }, [settingsStore, videoKey])

  // What the player verifiably HOLDS (applied, not merely requested): the
  // admission fallback below may only trust `player.playing` for this source.
  const appliedSourceUrlRef = useRef<string | null>(null)
  // The one swap the arming block below classified as position-preserving,
  // recorded as the exact URL pair so the adapter can recognise the same swap
  // and stand its own resume down. Declared here because the adapter options
  // close over it.
  const positionPreservingSwapRef = useRef<{
    from: string | null
    to: string | null
    claim: Exclude<SwapPositionClaim, false>
  } | null>(null)
  // Cast is the SLOT's, not the player's: a retained or PiP-held request from a
  // departed screen carries a session that screen's unmount already ended.
  const slotOwned = snapshot.slotId != null
  const castActive = slotOwned && request.castActive
  // Read at sourceLoad time, not effect-capture time: a cast session can
  // start inside the swap window the resume latch spans (KTD4).
  const castActiveRef = useRef(castActive)
  castActiveRef.current = castActive
  const { player, isPlaying, progressFeed, getHealthyPosition } =
    useManagedVideoPlayer(
      constrainedSourceUrl,
      (p) => {
        // Favor a fast first frame over deep prebuffer — JFP audience skews to
        // low-bandwidth networks. (Android-only fields are ignored on iOS.)
        p.bufferOptions = {
          minBufferForPlayback: 1,
          preferredForwardBufferDuration: 8,
          prioritizeTimeOverSizeThreshold: true,
        }
      },
      {
        progress: progressIdentity,
        ownsSession: true,
        // The recommendation recorder's discovery key (feat-516): a search
        // result marks its slug before navigating; the id alone never matches.
        mediaSlug: request.session?.videoSlug ?? request.progressVideoSlug,
        castActive,
        // Only this surface arms automatic entry into the operating system's
        // window, so only here may the background pause be undone when it opens.
        armsPictureInPicture: true,
        onSourceApplied: (url) => {
          appliedSourceUrlRef.current = url
        },
        // Reads the decision the arming block ALREADY made, rather than
        // recomputing it: render runs before effects, so by the time this
        // fires the host has advanced its own videoKey and could no longer
        // tell. One computation, so the seek and the suppression cannot
        // disagree about the same swap.
        preservesPosition: (previousUrl, nextUrl) => {
          const armed = positionPreservingSwapRef.current
          if (armed == null) return false
          if (armed.from !== previousUrl || armed.to !== nextUrl) return false
          return armed.claim
        },
      },
    )

  // The screen's cast recorder reads the root adapter's facade. Render-time,
  // like the chrome's own mirror before the hoist; the feed is identity-stable,
  // so repeated assignment is idempotent.
  if (slotOwned && request.progressFeedRef != null)
    request.progressFeedRef.current = progressFeed

  // R8's one-shot resume latch, armed only by a tier change and consumed by
  // the next sourceLoad. `revertTier` is the pre-pick tier a failed swap
  // writes back; null on the revert leg, so a failing revert cannot oscillate.
  const pendingQualityResumeRef = useRef<{
    positionSeconds: number
    durationSeconds: number
    wasPlaying: boolean
    revertTier: QualityTier | null
    /** Why it was armed. The consumer is identical for all; the RELEASE is
     *  not — only a quality swap has a tier to write back. */
    reason: ResumeReason
  } | null>(null)
  // Capture BEFORE the swap applies (R8): render runs ahead of the adapter's
  // swap effect, while the player still reports the outgoing item's clock.
  const snapshotApplied = () => ({
    url: constrainedSourceUrl,
    tier: effectiveSettings.qualityTier,
    videoKey,
    languageSlug: loadedSourceRef.current?.languageSlug ?? null,
  })
  const appliedConstraintRef = useRef(snapshotApplied())
  {
    const previous = appliedConstraintRef.current
    if (
      previous.url !== constrainedSourceUrl ||
      previous.tier !== effectiveSettings.qualityTier
    ) {
      // Capturing reads the LIVE clock, never the progress store: that store
      // is signed-in only and flushes every 2s, so it would resume seconds
      // behind, or at zero for a signed-out viewer.
      const capture = (
        revertTier: QualityTier | null,
        reason: ResumeReason,
      ) => {
        let positionSeconds = 0
        let durationSeconds = 0
        let wasPlaying = false
        try {
          positionSeconds = player.currentTime
          durationSeconds = player.duration
          wasPlaying = player.playing
        } catch {
          // Released mid-read; the resume then lands at zero, not never.
        }
        pendingQualityResumeRef.current = {
          positionSeconds,
          durationSeconds,
          wasPlaying,
          revertTier,
          reason,
        }
      }
      // A download holds one dub: a container swap that also names another
      // language is new audio (place kept, QoE re-keyed). The outgoing language
      // is the applied snapshot's; `loadedSourceRef` already names the NEW one.
      const containerClaim = offlineSwapClaim({
        previousLanguageSlug: previous.languageSlug,
        nextLanguageSlug: requestLanguage,
      })
      // One write for both axes: the release reads `reason`, the adapter reads
      // `claim`, and a branch that set one without the other would split them.
      const armPreservingSwap = (reason: Exclude<ResumeReason, "quality">) => {
        // A tier pick still in flight keeps its revert leg through this capture.
        capture(pendingQualityResumeRef.current?.revertTier ?? null, reason)
        positionPreservingSwapRef.current = {
          from: previous.url,
          to: constrainedSourceUrl,
          claim: reason === "offline" ? containerClaim : "new-content",
        }
      }
      // An empty key names nothing — two sourceless slots would both carry
      // "" and read as the same video.
      const sameVideo = videoKey !== "" && previous.videoKey === videoKey
      const sameAsset = isSameMuxAsset(previous.url, constrainedSourceUrl)
      // A completed download replacing the stream (or being deleted from under
      // it) is the SAME video in a new container, so it keeps the viewer's
      // place. It has to be tested BEFORE the cross-asset clear below: a local
      // file has no Mux id, so that clear would treat it as a new video.
      const offlineSwap = isOfflineContainerSwap({
        previousUrl: previous.url,
        nextUrl: constrainedSourceUrl,
        sameVideo,
        isLocal,
      })
      if (offlineSwap) {
        // No tier to revert: a tier write cannot change a file:// URL, so the
        // quality revert leg would strand a re-armed latch with no timer.
        armPreservingSwap("offline")
      } else if (
        isDubSwap({
          previousUrl: previous.url,
          nextUrl: constrainedSourceUrl,
          sameVideo,
          sameAsset,
          isLocal,
        })
      ) {
        // Another audio track of the same video keeps the viewer's place. The
        // capture reads the live clock, so it supersedes a pending tier one.
        armPreservingSwap("dub")
      } else if (!sameAsset) {
        // A different video: a pending quality resume is stale and must not
        // seek the arriving stream.
        pendingQualityResumeRef.current = null
      } else if (
        previous.tier !== effectiveSettings.qualityTier &&
        previous.url != null &&
        constrainedSourceUrl != null &&
        !sameQualityConstraint(previous.url, constrainedSourceUrl) &&
        pendingQualityResumeRef.current?.reason !== "quality"
      ) {
        // A re-pick mid-swap keeps the first capture: nothing played in
        // between, and the superseded swap may already report zero. A dub
        // latch does not count: the tier pick needs its own revert leg.
        capture(previous.tier, "quality")
      }
      appliedConstraintRef.current = snapshotApplied()
    } else {
      // A download's dub settles a commit AFTER its file starts, under the
      // same url: keep the snapshot's language current so the next swap
      // compares against it. A known language is never downgraded to null.
      const held = loadedSourceRef.current?.languageSlug ?? null
      if (held != null && held !== previous.languageSlug) {
        appliedConstraintRef.current = { ...previous, languageSlug: held }
      }
    }
  }

  // The failure/timeout release: a tier swap that errors or hangs must not
  // strand the viewer. Clear the latch, swap the URL seam back, say so once.
  const releaseQualityResume = useCallback(
    (releaseReason: "load_error" | "timeout") => {
      const pending = pendingQualityResumeRef.current
      if (pending == null) return
      pendingQualityResumeRef.current = null
      // The event follows the cause; the revert leg follows `revertTier`, so a
      // tier pick that overlapped a dub change still writes its tier back.
      if (pending.reason === "quality") {
        datadogLog.warn("player_settings.quality_swap_released", {
          release_reason: releaseReason,
          reverted_tier: pending.revertTier,
        })
      } else {
        datadogLog.warn(NON_QUALITY_RELEASE_EVENT[pending.reason], {
          release_reason: releaseReason,
        })
      }
      if (pending.revertTier == null) return
      // A viewer already re-picked the revert tier: the write would no-op, no
      // swap re-keys the timer, and a re-armed latch would go stale. Stay clear.
      if (
        getPlayerSettingsStore().getSnapshot().qualityTier ===
        pending.revertTier
      )
        return
      // Re-arm for the revert swap so the old stream resumes in place. The
      // null revertTier bounds this to one revert per pick.
      pendingQualityResumeRef.current = { ...pending, revertTier: null }
      getPlayerSettingsStore().setQualityTier(pending.revertTier)
    },
    [],
  )

  // The bounded wait: a swap that never reports back (no sourceLoad, no
  // error) still releases. Identity-checked, so a timer from a superseded
  // pick cannot cut a live swap's budget short.
  useEffect(() => {
    const pending = pendingQualityResumeRef.current
    if (pending == null) return
    const timer = setTimeout(() => {
      if (pendingQualityResumeRef.current !== pending) return
      releaseQualityResume("timeout")
    }, QUALITY_SWAP_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [constrainedSourceUrl, releaseQualityResume])

  useEffect(() => {
    const sub = player.addListener(
      "statusChange",
      ({ status }: { status: VideoPlayerStatus }) => {
        if (status === "error") releaseQualityResume("load_error")
      },
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [player, releaseQualityResume])

  // KTD3: the rate rides EVERY load (dub and constraint swaps alike); the
  // seek latch is one-shot. Seek before play — the replaceAsync promise
  // resolves before the item applies, so a seek there is silently dropped.
  const effectiveSpeedRef = useRef(effectiveSettings.speed)
  effectiveSpeedRef.current = effectiveSettings.speed
  const constrainedSourceUrlRef = useRef(constrainedSourceUrl)
  constrainedSourceUrlRef.current = constrainedSourceUrl
  useEffect(() => {
    const sub = player.addListener("sourceLoad", (payload?: unknown) => {
      // Queued swaps load per item: a superseded item's load must not spend
      // the one-shot latch, or the final item lands at 0:00. Same fail-open
      // payload rule as recoverPlayback: an unidentifiable load counts as ours.
      const loaded =
        typeof payload === "object" && payload !== null
          ? (payload as { videoSource?: unknown }).videoSource
          : undefined
      const isCurrentSource =
        typeof loaded !== "string" || loaded === constrainedSourceUrlRef.current
      const pending = isCurrentSource ? pendingQualityResumeRef.current : null
      if (isCurrentSource) pendingQualityResumeRef.current = null
      try {
        if (pending != null) {
          const durationSeconds =
            player.duration > 0 ? player.duration : pending.durationSeconds
          // An unknown duration skips the end guard: clamping against zero
          // would send the resume to 0:00, R8's forbidden outcome.
          player.currentTime =
            durationSeconds > 0
              ? resumePositionSeconds(pending.positionSeconds, durationSeconds)
              : Math.max(0, pending.positionSeconds)
        }
        player.playbackRate = effectiveSpeedRef.current
        // The latch's resume takes the same vetoes as every local resume path:
        // never over an active cast session (KTD4), never audio the viewer
        // cannot see — the adapter's 'active' handler re-resumes on return.
        if (
          pending?.wasPlaying &&
          !castActiveRef.current &&
          AppState.currentState === "active"
        )
          player.play()
      } catch {
        // Native player already released
      }
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [player])

  // R5: a speed pick lands on the live rate at once — no pause, no seek, no
  // source change — and on mount, so an adopted player picks up the session
  // rate. Deliberately not cast-gated: the local player is paused while casting.
  useEffect(() => {
    try {
      player.playbackRate = effectiveSettings.speed
    } catch {
      // Native player already released
    }
  }, [player, effectiveSettings.speed])

  const openSheetCount = useSyncExternalStore(
    sheetCounter.subscribe,
    sheetCounter.count,
  )
  const presentation = miniPlayerPresentation(
    sessionSnapshot,
    segments,
    openSheetCount,
  )
  const session = sessionSnapshot.session
  const hasSession = session != null
  const pipHeld = sessionSnapshot.pipHold

  // ── The reader cover (feat-551 KTD10) ─────────────────────────────────────

  // The store's answer for the CURRENT slot is the one predicate every layer
  // reads: this frame, the slot's poster, and the screen's back button. An
  // admitted cover floats the video; the kept rect waits for the return.
  const cover = snapshot.cover ?? null
  const coverFloats = cover === "admitted" && hasSession
  // Refused, or admitted and then closed: the frame hides but stays at the
  // kept rect, so the chrome (a Replay poster, a cast state) stays mounted.
  const coverHides = cover != null && !coverFloats
  const rect = coverFloats ? null : snapshot.rect
  const coverFloatsRef = useRef(coverFloats)
  coverFloatsRef.current = coverFloats

  // A refused cover turns autostart off for this video, so no veil arms and
  // no audio starts under the reader (AE13). Per video: another one starts
  // fresh.
  const [autostartOffKey, setAutostartOffKey] = useState<string | null>(null)
  const autostartOff = autostartOffKey != null && autostartOffKey === videoKey
  const videoKeyRef = useRef(videoKey)
  videoKeyRef.current = videoKey
  // The video the reader floated. Its chrome remounts on the return, and only
  // that mount takes the "started" start value below.
  const coverStartKeyRef = useRef<string | null>(null)
  if (coverFloats) coverStartKeyRef.current = videoKey
  useEffect(() => {
    if (cover == null && snapshot.rect != null) coverStartKeyRef.current = null
  }, [cover, snapshot.rect])

  // The latch is fed by this view's own callbacks, so a teardown that takes the
  // view with it would strand the latch set — and a stuck hold exempts EVERY
  // adapter from the background pause (R13's decision reads one store field).
  useEffect(() => () => getMiniPlayerStore().setPipHold(false), [])

  // Admission's first half (R1): has THIS video played at all. Reset per video,
  // because a window for a video that never started is AE10's regression.
  const startedRef = useRef(false)
  // Admission's other half (R1): has THIS video already finished. Reset with
  // the same key, and cleared whenever playback runs again — a viewer who seeks
  // back from the end and plays on is watching, not finished.
  const endedRef = useRef(false)
  // Keyed on the slug-stable videoKey above: a reset on the seed path's
  // videoId flip would wipe the started fact with no playing-change edge left
  // to re-latch it — play, pause, back then owes no window.
  useEffect(() => {
    startedRef.current = false
    endedRef.current = false
  }, [videoKey])
  useEffect(() => {
    if (!isPlaying) return
    startedRef.current = true
    endedRef.current = false
  }, [isPlaying])

  const requestRef = useRef(request)
  requestRef.current = request

  useEffect(() => {
    store.setPlaybackFactsSource({
      // The live player, not the latch alone: a swap that keeps `playing` true
      // throughout emits no playing-change edge, and a latch that only an edge
      // sets would deny the arriving video its window for good. Gated on the
      // APPLIED source: mid-swap the state still describes the outgoing video,
      // and vouching with it admits a never-played video (AE10).
      hasPlaybackStarted: () => {
        if (startedRef.current) return true
        const requested = requestRef.current.streamingUrl
        const applied = appliedSourceUrlRef.current
        if (requested == null || applied == null) return false
        if (!sameStreamSource(applied, requested)) return false
        try {
          return player.playing
        } catch {
          return false // Native player already released
        }
      },
      hasReachedEnd: () => endedRef.current,
      readPosition: () => {
        try {
          return player.currentTime
        } catch {
          return 0 // Native player already released
        }
      },
      readDuration: () => {
        try {
          return player.duration
        } catch {
          return 0
        }
      },
    })
    return () => store.setPlaybackFactsSource(null)
  }, [store, player])

  // KTD10: one layout effect per covered slot. It runs admission through the
  // store (the same step a detach takes), and its cleanup is the return. A new
  // slot under the reader (a deep link) is a new cover and a new decision.
  const coverSlotId = isReaderCovering(segments) ? snapshot.slotId : null
  useLayoutEffect(() => {
    if (coverSlotId == null) return
    const admitted = store.coverSlot(coverSlotId)
    if (admitted === false) {
      // Refused: the video waits on the watch screen. A cast keeps playing on
      // the receiver, so only local playback pauses.
      if (!castActiveRef.current) {
        try {
          player.pause()
        } catch {
          // Native player already released
        }
      }
      setAutostartOffKey(videoKeyRef.current)
    }
    return () => store.uncoverSlot(coverSlotId)
  }, [store, player, coverSlotId])

  // R25 stops playback on a subject change, R6 on a dismissal — neither is
  // covered by the teardown (an expanded screen keeps this host mounted). Every
  // real ending also resets the playback-session settings (R13).
  useEffect(() => {
    return getMiniPlayerStore().onEnd((event) => {
      if (
        event.reason !== "abandoned" &&
        event.reason !== "dismissed" &&
        event.reason !== "replaced"
      )
        return
      // A replacement's player is being taken over — pausing it would stall
      // the arriving video's start.
      if (event.reason !== "replaced") {
        try {
          player.pause()
        } catch {
          // Native player already released
        }
      }
      // R13: the session is over. Key first, so the reset is ONE effective
      // transition; the next video's resetFor re-keys.
      const settings = getPlayerSettingsStore()
      settings.setContentKey(null)
      settings.setSpeed(DEFAULT_PLAYBACK_SPEED)
      settings.setQualityTier(DEFAULT_QUALITY_TIER)
    })
  }, [player])

  // Disable Mux's HLS subtitle tracks (SubtitleOverlay renders admin VTT
  // instead). Lives here, not in the chrome: R26 keeps the floating window
  // caption-free, and the track must stay null with no chrome mounted.
  useEffect(() => {
    const disable = () => {
      try {
        if (player.subtitleTrack != null) player.subtitleTrack = null
      } catch {
        // Player already released
      }
    }
    const subs = [
      player.addListener("availableSubtitleTracksChange", disable),
      player.addListener("subtitleTrackChange", disable),
      player.addListener("sourceLoad", disable),
    ]
    disable()
    return () => subs.forEach((s) => s.remove())
  }, [player])

  // Subscribed once per PLAYER, not per source: resubscribing on a streamingUrl
  // change rebuilds mid-replaceAsync across the seed -> canonical swap, which
  // attributes a pre-swap error to the new source.
  useEffect(() => {
    const sub = player.addListener(
      "statusChange",
      ({ status }: { status: VideoPlayerStatus }) => {
        store.setLoadFailed(status === "error")
        setPlayerStatus(status)
      },
    )
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [store, player])

  // New source: clear the stop condition. Seeding from the CURRENT status
  // rather than a bare false covers a source that already failed before this
  // effect ran, which a listener alone never sees.
  useEffect(() => {
    let current: VideoPlayerStatus | null = null
    try {
      current = player.status
    } catch {
      // Player already released
    }
    store.setLoadFailed(current === "error")
    setPlayerStatus(current)
    // A new source has not played yet, so its "loading" is an initial load and
    // must not read as playback.
    hasPlayedRef.current = false
  }, [store, player, request.streamingUrl])

  // ── The floating window (U7) ──────────────────────────────────────────────

  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const pattern = routePattern(segments)
  const underHeader = HEADER_ROUTE_PATTERNS.has(pattern)

  // KTD5: the drag writes the frame node and never takes the native driver;
  // the shrink (motion node inside it) and the exit (wrapper above it) do.
  const drag = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current
  const shrink = useRef(new Animated.Value(1)).current
  const exitY = useRef(new Animated.Value(0)).current
  // A top-corner window fades instead of sliding; both ride the exit wrapper
  // and both are native-driven, so they share one driver (KTD5).
  const exitOpacity = useRef(new Animated.Value(1)).current

  // The app's corner. Reader routes keep their own (KTD11, below).
  const [corner, setCorner] = useState<MiniPlayerCorner>(DEFAULT_CORNER)
  // The one in-flight frame transition (KTD17). The frame ANCHORS at one end
  // while the transform carries the visual between `from` and `to`: the native
  // driver attaches transforms after a commit paints, so the untransformed
  // first frame renders AT the anchor — anchoring at the end the viewer is
  // already looking at is what makes the start of a transition flash-proof.
  // The shrink and the reposition glide anchor at `from`; the expand at `to`.
  const [motion, setMotion] = useState<FrameMotion | null>(null)

  // ── The reader corners (feat-551 KTD11) ───────────────────────────────────

  // A covered slot means the pushed reader, whatever the route says during the
  // one commit before the cover starts or ends. A sheet sits over whichever
  // reader opened it, so it keeps the last reader's layout.
  const routeReader = readerRouteKind(segments)
  const lastReaderRef = useRef<"tab" | "pushed">("pushed")
  if (routeReader === "tab" || routeReader === "pushed")
    lastReaderRef.current = routeReader
  const readerHost: "tab" | "pushed" | null =
    cover != null
      ? "pushed"
      : routeReader === "sheet"
        ? lastReaderRef.current
        : routeReader
  const tablet = isTabletLayout(screenWidth, screenHeight)
  const publishedBand = useSyncExternalStore(
    subscribeReaderMovementBand,
    getReaderMovementBand,
  )
  // Held while a transition runs: a band that changes mid-shrink would cut the
  // shrink short. The next render after the settle applies it.
  const movementBandRef = useRef<number | null>(publishedBand)
  if (motion == null) movementBandRef.current = publishedBand
  const movementBand =
    movementBandRef.current ??
    readerMovementBandHeight({ arrows: tablet, hint: false })
  const readerPolicy =
    readerHost == null
      ? null
      : readerCornerPolicy({
          layout: tablet ? "tablet" : "phone",
          host: readerHost,
          movementBand,
          tabBar: TAB_BAR_CONTENT_HEIGHT,
        })
  const chromeTop =
    readerPolicy?.chrome.top ?? (underHeader ? NATIVE_HEADER_HEIGHT : 0)
  // ALWAYS reserved off the reader, tab bar or not (owner decision 2026-08-19):
  // one constant height, so a push never moves the window.
  const chromeBottom = readerPolicy?.chrome.bottom ?? TAB_BAR_CONTENT_HEIGHT
  const effectiveCorner =
    readerPolicy != null ? (readerCorner ?? readerPolicy.startCorner) : corner
  const effectiveCornerRef = useRef(effectiveCorner)
  effectiveCornerRef.current = effectiveCorner
  const onReaderRouteRef = useRef(readerPolicy != null)
  onReaderRouteRef.current = readerPolicy != null

  const layoutConfig = useMemo<MiniPlayerLayoutConfig>(
    () => ({
      screen: { width: screenWidth, height: screenHeight },
      insets: {
        top: insets.top,
        right: insets.right,
        bottom: insets.bottom,
        left: insets.left,
      },
      chrome: { top: chromeTop, bottom: chromeBottom },
    }),
    [
      screenWidth,
      screenHeight,
      insets.top,
      insets.right,
      insets.bottom,
      insets.left,
      chromeTop,
      chromeBottom,
    ],
  )
  const windowFrame = useMemo(
    () => defaultCornerFrame(layoutConfig),
    [layoutConfig],
  )
  const layoutConfigRef = useRef(layoutConfig)
  layoutConfigRef.current = layoutConfig

  const [chromeReady, setChromeReady] = useState(true)
  const [surfaceReleased, setSurfaceReleased] = useState(false)
  const lastRectRef = useRef<PlaybackRect | null>(null)
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shrinkAnimRef = useRef<Animated.CompositeAnimation | null>(null)
  // The ramp value a settled motion still owes the node. Parked only AFTER the
  // commit that moves the frame, because identity means "fill this frame" and
  // the frame is the corner only once that commit lands.
  const pendingParkRef = useRef<0 | 1 | null>(null)
  // The in-flight motion, readable by the run that supersedes it. The `motion`
  // STATE cannot serve: it is not in this effect's deps, and adding it would
  // re-run the effect on every transition the effect itself starts.
  const motionRef = useRef<FrameMotion | null>(null)
  // R4's tap precedes the rect by a route push: the tab bar leaves the segments
  // at once and the corner re-derives lower. The pin must ride the COMMITTED
  // geometry — an Animated catch-up lands after the commit paints (Fabric).
  const expandHoldRef = useRef<ExpandHold | null>(null)
  // The frame the window last settled into, and the drag offset that rest
  // assumes. A header route lifts a top corner while the default one stays,
  // so the glide follows the occupied corner's own frame.
  const restingTargetRef = useRef<MiniPlayerFrame | null>(null)
  const restingDragRef = useRef<{ x: number; y: number } | null>(null)
  // Whether the last run of the effect below saw the window float over the
  // reader. Only that window grows back without a session (KTD10).
  const floatedOverReaderRef = useRef(false)
  // Whether that run saw the window rest on a reader route. Only then does a
  // grow start at the last rest; other routes grow from the live corner.
  const restedOnReaderRef = useRef(false)

  useEffect(() => {
    return () => {
      if (chromeTimerRef.current != null) clearTimeout(chromeTimerRef.current)
    }
  }, [])

  // One effect owns the drag node's resting offset, so a rotation, a handover
  // and a transition can never race each other over the same value.
  //
  // A LAYOUT effect so the transform is set before this commit paints. It does
  // NOT make `motion` land in the commit that dropped the rect — a setState
  // here schedules a further commit, which is why `departingRect` exists.
  useLayoutEffect(() => {
    // Whatever this run decides, an earlier transition may not keep animating
    // into it: an uncancelled one paints a stale transform under the new
    // state, and its completion callback fires out of turn.
    // Read before the stop: this run decides AGAINST the motion it interrupts,
    // and only a settle clears the ref.
    const inFlight = motionRef.current
    shrinkAnimRef.current?.stop()
    shrinkAnimRef.current = null
    const floatedOverReader = floatedOverReaderRef.current
    floatedOverReaderRef.current = coverFloats
    const restedOnReader = restedOnReaderRef.current
    restedOnReaderRef.current = rect == null && onReaderRouteRef.current
    const clearMotion = () => {
      if (chromeTimerRef.current != null) {
        clearTimeout(chromeTimerRef.current)
        chromeTimerRef.current = null
      }
      // Same deferral as settle for whatever motion this interrupts.
      if (inFlight != null) {
        pendingParkRef.current = inFlight.anchor === "from" ? 0 : 1
      }
      motionRef.current = null
      setMotion(null)
      setChromeReady(true)
    }
    // The ramp, direction included. A reversal re-runs it with `toValue: 0`:
    // a native timing starts from the node's LIVE value, which is the one
    // thing JS cannot read back off a native-driven node.
    const runRamp = (
      toValue: 0 | 1,
      anchor: "from" | "to",
      durationMs: number,
    ) => {
      // A new ramp now owns the node, so a park the superseded motion queued is
      // stale — applying it later would stop this ramp mid-flight.
      pendingParkRef.current = null
      let settled = false
      const settle = () => {
        if (settled) return
        settled = true
        if (chromeTimerRef.current != null) {
          clearTimeout(chromeTimerRef.current)
          chromeTimerRef.current = null
        }
        // DEFERRED: identity on a frame still anchored at `from` means "fill the
        // full rect", which flashed the video full size. The effect below parks
        // it once the frame IS the corner.
        pendingParkRef.current = anchor === "from" ? 0 : 1
        motionRef.current = null
        setMotion(null)
        setChromeReady(true)
      }
      const animation = Animated.timing(shrink, {
        toValue,
        duration: durationMs,
        useNativeDriver: true,
      })
      shrinkAnimRef.current = animation
      animation.start(({ finished }) => {
        if (shrinkAnimRef.current === animation) shrinkAnimRef.current = null
        // A stop is a supersession: the run that stopped it owns the state.
        if (!finished) return
        settle()
      })
      if (chromeTimerRef.current != null) clearTimeout(chromeTimerRef.current)
      chromeTimerRef.current = setTimeout(() => {
        // The unconditional release: a driver that never reports back would
        // strand a mid-transition scale — and an invisible window — forever.
        settle()
      }, durationMs + CHROME_RELEASE_SLACK_MS)
    }
    const runMotion = (
      from: PlaybackRect,
      to: PlaybackRect,
      anchor: "from" | "to",
      durationMs: number,
      departed?: PlaybackRect,
    ) => {
      const next: FrameMotion = { from, to, anchor, departed }
      motionRef.current = next
      setMotion(next)
      shrink.setValue(0)
      runRamp(1, anchor, durationMs)
    }
    if (rect != null) {
      // A rect arriving over a live session is the expand (R4): the surface
      // grows from the corner it occupied back into the player rect — the
      // shrink in reverse, never a blink into place.
      const restingFrame = restingTargetRef.current
      // The reader's return clears its session in this same commit, so a
      // window that floated over the reader counts too (KTD10).
      const grow =
        lastRectRef.current == null &&
        !coverHides &&
        (hasSession || floatedOverReader)
      lastRectRef.current = rect
      drag.setValue({ x: 0, y: 0 })
      if (grow) {
        // The grow starts where the window is RENDERED, which the tap's hold
        // may have pinned above the live corner frame (see handleExpand).
        const hold = liveExpandHold(
          expandHoldRef.current,
          hasSession,
          Date.now(),
        )
        expandHoldRef.current = null
        // A shrink still on the ramp is this grow's own path, backwards: turn
        // the live node around rather than restart from an anchor JS cannot
        // verify it reached. Same anchor, same geometry, same settle.
        if (
          inFlight?.anchor === "from" &&
          sameRect(inFlight.departed ?? inFlight.from, rect)
        ) {
          runRamp(0, "from", EXPAND_DURATION_MS)
        } else {
          runMotion(
            hold?.cornerFrame ??
              (restedOnReader ? restingFrame : null) ??
              miniPlayerCornerFrame(layoutConfig, effectiveCornerRef.current),
            rect,
            "to",
            EXPAND_DURATION_MS,
          )
        }
      } else {
        expandHoldRef.current = null
        clearMotion()
      }
      restingTargetRef.current = null
      restingDragRef.current = null
      return
    }
    const from = lastRectRef.current
    lastRectRef.current = null
    if (from == null || !hasSession) {
      // Mid-expand the destination's chrome is already live, so the corner
      // frame sits below the window the viewer is watching. The drag stays
      // relative to whichever base frame the render pinned.
      const hold = liveExpandHold(expandHoldRef.current, hasSession, Date.now())
      expandHoldRef.current = hold
      const target =
        hold?.cornerFrame ??
        miniPlayerCornerFrame(layoutConfig, effectiveCornerRef.current)
      const base = hold?.windowFrame ?? windowFrame
      const dragTarget = { x: target.x - base.x, y: target.y - base.y }
      const previousTarget = restingTargetRef.current
      const previousDrag = restingDragRef.current
      restingTargetRef.current = hasSession ? target : null
      restingDragRef.current = hasSession ? dragTarget : null
      // Animated's public types omit __getValue; the drag node is JS-driven, so
      // its live value is the authoritative answer to "where is the window".
      const liveDrag = (
        drag as unknown as { __getValue(): { x: number; y: number } }
      ).__getValue()
      drag.setValue(dragTarget)
      // The glide moves the window from its last rest to its new one. That rest
      // may be another corner: KTD11 switches the corner in and out of the
      // reader. Only a node really AT that rest may glide from it.
      const glideFrom =
        hold == null &&
        hasSession &&
        previousTarget != null &&
        previousDrag != null &&
        liveDrag.x === previousDrag.x &&
        liveDrag.y === previousDrag.y &&
        (previousTarget.x !== target.x || previousTarget.y !== target.y)
          ? {
              x: previousTarget.x - dragTarget.x,
              y: previousTarget.y - dragTarget.y,
              width: previousTarget.width,
              height: previousTarget.height,
            }
          : null
      if (glideFrom != null) {
        // The chrome is a SIBLING of the ramp and cannot ride it: hide it for
        // the glide so settle pops it in at the new corner, as the shrink does.
        setChromeReady(false)
        runMotion(glideFrom, base, "from", REPOSITION_DURATION_MS)
      } else {
        clearMotion()
      }
      return
    }
    // A new window opens in the app's default corner, or on a reader route in
    // the reader's corner (KTD11). The frame stays anchored at the player rect
    // for the whole shrink: the untransformed first frame IS the previous one.
    const onReader = onReaderRouteRef.current
    const startCorner = onReader ? effectiveCornerRef.current : DEFAULT_CORNER
    if (!onReader) setCorner(DEFAULT_CORNER)
    const target = miniPlayerCornerFrame(layoutConfig, startCorner)
    // A corner other than the base frame's rides the drag offset, so the
    // motion starts at the rect MINUS that offset: the same visual start.
    const dragTarget = {
      x: target.x - windowFrame.x,
      y: target.y - windowFrame.y,
    }
    drag.setValue(dragTarget)
    setChromeReady(false)
    // The same turn-around the other way: a grow still on the ramp departs
    // from the very corner this shrink is heading for.
    if (
      inFlight?.anchor === "to" &&
      sameRect(inFlight.to, from) &&
      sameRect(inFlight.from, windowFrame) &&
      dragTarget.x === 0 &&
      dragTarget.y === 0
    ) {
      runRamp(0, "to", SHRINK_DURATION_MS)
    } else {
      runMotion(
        offsetRect(from, { x: -dragTarget.x, y: -dragTarget.y }),
        windowFrame,
        "from",
        SHRINK_DURATION_MS,
        from,
      )
    }
    // The rest this settle leaves behind: later chrome changes glide from it.
    restingTargetRef.current = target
    restingDragRef.current = dragTarget
  }, [
    rect,
    hasSession,
    coverFloats,
    coverHides,
    layoutConfig,
    windowFrame,
    drag,
    shrink,
  ])

  // Runs on the commit that DROPS the motion, so identity means "fill the
  // corner" — the settled state. Parking earlier flashed the video full size;
  // never parking left the corner-target value stuck on the view (black box).
  useLayoutEffect(() => {
    // The ref, not just the state: the effect above runs FIRST in this commit
    // and may have armed a replacement motion the render cannot see yet.
    // Parking over it would stop that ramp and skip the transition outright.
    if (motion != null || motionRef.current != null) return
    const parked = pendingParkRef.current
    if (parked == null) return
    pendingParkRef.current = null
    shrink.setValue(parked)
  }, [motion, shrink])

  useEffect(() => {
    if (presentation !== "exiting") {
      // The nodes outlive the dismissal that moved them: a session-less slot
      // (the series trailer) keeps this host mounted, so an unreset exit would
      // draw every later video off screen — or invisible.
      exitY.setValue(0)
      exitOpacity.setValue(1)
      return
    }
    // From the corner the window OCCUPIES: the exit translates the dragged
    // frame, so a top-corner dismissal measured from the default bottom corner
    // stops mid-screen and blinks out.
    const occupied = miniPlayerCornerFrame(
      layoutConfig,
      effectiveCornerRef.current,
    )
    const distance = screenHeight - occupied.y + EXIT_CLEARANCE
    // Reset the node this dismissal will NOT drive, so a fade cannot inherit a
    // slide's offset (or the reverse) from the dismissal before it.
    const fading = dismissMode(effectiveCornerRef.current) === "fade"
    if (fading) exitY.setValue(0)
    else exitOpacity.setValue(1)
    const animation = fading
      ? Animated.timing(exitOpacity, {
          toValue: 0,
          duration: EXIT_DURATION_MS,
          useNativeDriver: true,
        })
      : Animated.timing(exitY, {
          toValue: distance,
          duration: EXIT_DURATION_MS,
          useNativeDriver: true,
        })
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const complete = () => {
      if (cancelled) return
      if (timer != null) clearTimeout(timer)
      timer = null
      getMiniPlayerStore().reportExitComplete()
    }
    // The gate's unconditional release: a driver that never calls back would
    // strand a dismissed window off screen with its session still live.
    timer = setTimeout(complete, EXIT_DURATION_MS + EXIT_RELEASE_SLACK_MS)
    animation.start(complete)
    return () => {
      cancelled = true
      animation.stop()
      if (timer != null) clearTimeout(timer)
    }
  }, [presentation, exitY, exitOpacity, screenHeight, layoutConfig])

  // R21/R22 re-arm: a replay puts the surface back before anything else reads it.
  const endedCause = session?.endedCause ?? null
  useEffect(() => {
    if (endedCause == null) setSurfaceReleased(false)
  }, [endedCause])

  // Read through a ref: these listeners are keyed on the player, and
  // re-subscribing per navigation would rebuild them mid-swap.
  const floatingRef = useRef(false)
  floatingRef.current = rect == null && hasSession

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      // One fact for both surfaces (R1): the video finished, wherever it
      // played. Cleared by a replay's playing edge, and read by admission.
      endedRef.current = true
      if (floatingRef.current) {
        getMiniPlayerStore().markEnded("playToEnd")
        return
      }
      // A session that survived an expand must end WITH the video, or the pop
      // re-serves it phase-'playing', paused on the final frame, with every
      // hero still yielded to it — instead of R21's ended window.
      const session = getMiniPlayerStore().getSnapshot().session
      const descriptor = requestRef.current.session
      if (
        session != null &&
        descriptor != null &&
        sameSessionContent(descriptor, session)
      ) {
        getMiniPlayerStore().markEnded("playToEnd")
      }
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // Player already released
      }
    }
  }, [player])

  useEffect(() => {
    if (!snapshot.loadFailed || rect != null || !hasSession) return
    getMiniPlayerStore().markEnded("failure")
  }, [snapshot.loadFailed, rect, hasSession])

  // R23, KTD4's single deliberate exception. Armed only while a session is
  // active, and claims the press only when the navigator cannot go back.
  const canGoBackRef = useRef(canGoBack)
  canGoBackRef.current = canGoBack
  useEffect(() => {
    if (!hasSession) return
    // Registered on both platforms: iOS has no hardware back and RN's handler
    // is inert there, so the arming rule stays in one place.
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (canGoBackRef.current()) return false
        getMiniPlayerStore().requestDismiss()
        return true
      },
    )
    return () => subscription.remove()
  }, [hasSession])

  const handlePlayPause = useCallback(() => {
    try {
      if (player.playing) player.pause()
      else player.play()
    } catch {
      // Native player already released
    }
  }, [player])

  const handleReplay = useCallback(() => {
    try {
      player.currentTime = 0
      player.play()
      // Inside the try: a window that says "playing" over a player that refused
      // the call offers no replay control to try again with (R27).
      getMiniPlayerStore().markPlaying()
    } catch {
      // Native player already released
    }
  }, [player])

  const handleDismiss = useCallback(() => {
    // KTD10: a window closed over the reader stops the video and ends its
    // session with no report, so the quality session, the recommendation
    // episode and the settings survive for the return (AE14).
    if (coverFloatsRef.current) {
      try {
        player.pause()
      } catch {
        // Native player already released
      }
      getMiniPlayerStore().dismissWithoutReport()
      return
    }
    getMiniPlayerStore().requestDismiss()
  }, [player])

  const segmentsRef = useRef(segments)
  segmentsRef.current = segments
  const handleExpand = useCallback(() => {
    const current = getMiniPlayerStore().getSnapshot().session
    if (current == null) return
    const now = Date.now()
    // On a reader route, one tap per expand: a second one would pop or push a
    // second route (KTD10). Other routes keep their behavior from before.
    if (
      onReaderRouteRef.current &&
      liveExpandHold(expandHoldRef.current, true, now) != null
    )
      return
    // Pin the on-screen frames, so the grow starts from what the viewer sees
    // even when the navigation re-derives the corner layout first.
    expandHoldRef.current = {
      windowFrame: defaultCornerFrame(layoutConfigRef.current),
      cornerFrame: miniPlayerCornerFrame(
        layoutConfigRef.current,
        effectiveCornerRef.current,
      ),
      at: now,
    }
    onExpand(
      current,
      expandAction({
        covered: coverFloatsRef.current,
        descriptor: requestRef.current.session,
        session: current,
        segments: segmentsRef.current,
      }),
    )
  }, [onExpand])

  const handleCornerChange = useCallback(
    (next: MiniPlayerCorner) => {
      // A drag supersedes the tap: a held frame would aim the grow at the
      // corner the window just left. The snap carries the drag to `next`, and
      // THAT is the rest a later chrome change glides from.
      expandHoldRef.current = null
      const config = layoutConfigRef.current
      const nextTarget = miniPlayerCornerFrame(config, next)
      const nextBase = defaultCornerFrame(config)
      restingTargetRef.current = nextTarget
      restingDragRef.current = {
        x: nextTarget.x - nextBase.x,
        y: nextTarget.y - nextBase.y,
      }
      // KTD11: a move inside the reader writes the reader's corner only.
      if (onReaderRouteRef.current) onReaderCornerChange(next)
      else setCorner(next)
    },
    [onReaderCornerChange],
  )

  const showWindow =
    hasSession &&
    (presentation === "floating" || presentation === "exiting") &&
    !coverHides
  const suppressed = hasSession && presentation === "hidden"
  // A hidden cover hides the frame the way sheet suppression does: by
  // opacity, with no touches, and with every view still mounted (KTD10).
  const frameHidden = suppressed || coverHides
  const floating = rect == null && hasSession
  // The frame sits at the motion's anchor while one runs (see the motion
  // state), and at the corner the moment a from-anchored one settles. An
  // expand tap pins the COMMITTED base frame through the push: a post-commit
  // Animated catch-up would paint the re-derived corner for a frame first.
  const heldWindowFrame = liveExpandHold(
    expandHoldRef.current,
    hasSession,
    Date.now(),
  )?.windowFrame
  // The rect the shrink is about to depart FROM, on the one render between the
  // slot detaching and the layout effect arming the motion. The ref still holds
  // it here; the effect nulls it immediately after. See frameGeometry.
  const departingRect = rect == null && hasSession ? lastRectRef.current : null
  // That same gap render still carries the SETTLED window's chrome state, since
  // setChromeReady(false) lands a commit later. The frame is the departing rect
  // here, so neither the corner radius nor the mini transport belongs yet.
  const settlingFromRect = departingRect != null
  const geometry = frameGeometry({
    rect,
    motion,
    heldWindowFrame: heldWindowFrame ?? null,
    departingRect,
    windowFrame,
  })

  // A surface can own the player before its stream resolves (an Up Next
  // replace, a seed with no playbackId). The player still holds ANOTHER route's
  // video then, so drawing it into this rect would paint the wrong one.
  const hasSurfaceVideo = request.streamingUrl != null || adoptable
  const drawsSurface = shouldDrawSurface({
    pipHeld,
    hasSurfaceVideo,
    hasRect: rect != null,
    endedCause,
    surfaceReleased,
  })
  // With none of the three inside it, the frame is an opaque black box over the
  // poster the sourceless screen paints beneath it.
  // A session keeps the frame even with no local source: the pin can capture
  // null when a screen mounts into an active one, and the chrome is the only
  // way to stop the receiver from the player area.
  const drawsFrame =
    drawsSurface ||
    (rect != null && castActive) ||
    (showWindow && session != null)

  // Both rects share the video's aspect ratio, so this is translate plus scale
  // only (KTD17) — one ramp carries the shrink and the expand. The transform
  // maps the ANCHOR rect onto the visual's position: a from-anchored motion
  // starts at identity and animates away; a to-anchored one arrives at it.
  const motionStyle = useMemo(() => {
    if (motion == null) return null
    const half = (r: PlaybackRect) => ({
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    })
    const from = half(motion.from)
    const to = half(motion.to)
    const ramp = (a: number, b: number) =>
      shrink.interpolate({ inputRange: [0, 1], outputRange: [a, b] })
    if (motion.anchor === "from") {
      return {
        transform: [
          { translateX: ramp(0, to.x - from.x) },
          { translateY: ramp(0, to.y - from.y) },
          { scale: ramp(1, motion.to.width / motion.from.width) },
        ],
      }
    }
    return {
      transform: [
        { translateX: ramp(from.x - to.x, 0) },
        { translateY: ramp(from.y - to.y, 0) },
        { scale: ramp(motion.from.width / motion.to.width, 1) },
      ],
    }
  }, [shrink, motion])

  // A mid-playback rebuffer drops `isPlaying` on both platforms (Android
  // mirrors ExoPlayer's STATE_BUFFERING, iOS reports waitingToPlayAtSpecified-
  // Rate), so publishing it raw makes every network hiccup read as a pause.
  if (isPlaying) hasPlayedRef.current = true
  const watching =
    isPlaying || (hasPlayedRef.current && playerStatus === "loading")

  // Publish playback for layers the host cannot reach by prop (the route's
  // ambient wash). Mirrors the `setLoadFailed` bridge; the store ignores a
  // repeat value, so this costs nothing on a re-render.
  useEffect(() => {
    store.setPlaying(watching)
  }, [store, watching])

  // A host that unmounts mid-playback would otherwise leave the flag stuck true
  // and the wash faded out on a screen with no player at all.
  useEffect(() => {
    return () => {
      store.setPlaying(false)
    }
  }, [store])

  // feat-551 R10: the reader keeps its verse clear of the resting window. It
  // stays published while a sheet hides the window, so the verse holds still.
  const onReaderRoute = readerPolicy != null
  const restingWindow = useMemo(
    () =>
      onReaderRoute &&
      rect == null &&
      hasSession &&
      (presentation === "floating" || presentation === "hidden")
        ? miniPlayerCornerFrame(layoutConfig, effectiveCorner)
        : null,
    [
      onReaderRoute,
      rect,
      hasSession,
      presentation,
      layoutConfig,
      effectiveCorner,
    ],
  )
  useLayoutEffect(() => {
    store.setWindowFrame(restingWindow)
  }, [store, restingWindow])
  useLayoutEffect(() => () => store.setWindowFrame(null), [store])

  // Armed only while this video actually runs, so pressing Home over a paused
  // video opens no window — and kept armed through the hold, because expo-video
  // re-elects on every params change and only the elected view is re-parented.
  const automaticPip = isPlaying || pipHeld
  const pipViewProps = useMemo(
    () => pictureInPictureViewProps({ automatic: automaticPip }),
    [automaticPip],
  )

  // Detached with no session: the surface that was drawing this video is gone
  // and no window is owed. The player keeps running with no view, which is
  // audio-only rather than a released decoder. The hold is a term because the
  // OS window outlives the session that opened it (R24).
  if (rect == null && !hasSession && !pipHeld) return null

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {drawsFrame && (
        <Animated.View
          testID="playback-exit"
          // R6 rides its own native node ABOVE the frame so the whole window —
          // box, chrome, video — slides out together (KTD5: one driver per
          // node; the frame below keeps the JS-driven drag).
          style={[
            StyleSheet.absoluteFill,
            { opacity: exitOpacity, transform: [{ translateY: exitY }] },
          ]}
          pointerEvents="box-none"
        >
          <Animated.View
            testID="playback-frame"
            style={[
              styles.frame,
              {
                left: geometry.x,
                top: geometry.y,
                width: geometry.width,
                height: geometry.height,
              },
              floating && styles.clipped,
              // The shrink draws the video larger than this box, so it cannot
              // clip until the transition has settled into its target — and the
              // box paints NOTHING of its own mid-flight: an instant black
              // window at the corner would front-run the arriving video.
              motion != null && styles.inMotion,
              floating && chromeReady && !settlingFromRect && styles.rounded,
              frameHidden && styles.suppressed,
              { transform: [{ translateX: drag.x }, { translateY: drag.y }] },
            ]}
            // Invisible over a sheet or the reader: it takes none of their touches.
            pointerEvents={frameHidden ? "none" : "box-none"}
          >
            <Animated.View
              testID="playback-motion"
              style={[StyleSheet.absoluteFill, motionStyle]}
              pointerEvents="box-none"
            >
              {/* R24: the ended fade's completion callback survives the chrome
                  unmounting, so the hold is what keeps it from releasing this
                  surface out from under a live OS window. */}
              {drawsSurface && (
                <VideoView
                  player={player}
                  style={StyleSheet.absoluteFill}
                  nativeControls={false}
                  // iOS 16+ defaults this TRUE, which floats a Live Text "scan"
                  // button over a paused/ended frame that contains text — a system
                  // control we do not own, inside chrome we do.
                  allowsVideoFrameAnalysis={false}
                  contentFit="contain"
                  {...pipViewProps}
                  // textureView composites in the RN view hierarchy on Android so
                  // the controls/captions overlay reliably renders above the video
                  // surface (SurfaceView otherwise punches through). No-op on iOS.
                  surfaceType={
                    Platform.OS === "android" ? "textureView" : undefined
                  }
                />
              )}
            </Animated.View>

            {/* Transport chrome for something unplayable would be a lie:
                nothing to scrub, a play button over a poster that never starts. */}
            {rect != null && (hasSurfaceVideo || castActive) && (
              <VideoPlayer
                player={player}
                isPlaying={isPlaying}
                loadFailed={snapshot.loadFailed}
                streamingUrl={request.streamingUrl}
                getHealthyPosition={getHealthyPosition}
                // What the player verifiably HOLDS. The chrome renders on
                // `adoptable` alone, so the requested url can still be null
                // while a real source is loaded — recovery must use this.
                recoverSourceUrl={
                  request.streamingUrl ?? appliedSourceUrlRef.current
                }
                posterUrl={request.posterUrl}
                subtitleVttSrc={request.subtitleVttSrc}
                fullscreen={request.fullscreen}
                onToggleFullscreen={request.onToggleFullscreen ?? undefined}
                resumeAtSeconds={request.resumeAtSeconds}
                autostart={request.autostart && !autostartOff}
                adopted={adoptable}
                // The chrome remounts on the reader's return; a video that
                // already played arms no veil then (KTD10).
                started={
                  coverStartKeyRef.current === videoKey && startedRef.current
                }
                cast={slotOwned ? (request.cast ?? null) : null}
              />
            )}

            {showWindow && session != null && (
              <MiniPlayerWindow
                frame={windowFrame}
                layout={layoutConfig}
                drag={drag}
                corner={effectiveCorner}
                onCornerChange={handleCornerChange}
                title={session.title}
                posterUrl={session.posterUrl}
                positionSeconds={session.positionSeconds}
                durationSeconds={session.durationSeconds}
                isPlaying={isPlaying}
                endedCause={session.endedCause}
                ready={chromeReady && !settlingFromRect}
                exiting={presentation === "exiting"}
                onPlayPause={handlePlayPause}
                onReplay={handleReplay}
                onDismiss={handleDismiss}
                onExpand={handleExpand}
                onEndedFadeComplete={() => setSurfaceReleased(true)}
              />
            )}
          </Animated.View>
        </Animated.View>
      )}

      {/* The screen's back affordance sits OVER the player, so it moves up with
          the video — outside the frame, so its safe-area maths still resolves
          against the window. Gated on the SAME predicate the screen drops its
          own by (usePlaybackFrameVisible), or the measurement gap draws two.
          A session-bearing surface minimizes on back, so it shows the down
          chevron the screen's own button matches. */}
      {snapshot.slotId != null &&
        rect != null &&
        cover == null &&
        !request.fullscreen && (
          <FloatingBackButton
            {...BACK_BUTTON_PROPS}
            icon={request.session != null ? "chevron-down" : "chevron-back"}
          />
        )}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    position: "absolute",
    backgroundColor: BLACK,
    // Explicit, not defaulted: re-adding a clip here is precisely how the
    // docked scrubber's thumb lost its lower half once already (#1962).
    overflow: "visible",
  },
  // Only the floating window clips, to hold its corner radius. The docked
  // player must NOT: the inline scrubber's flush thumb is centred on a track
  // sitting on the player's bottom edge, so its lower half draws below this box.
  clipped: {
    overflow: "hidden",
  },
  inMotion: {
    overflow: "visible",
    backgroundColor: "transparent",
  },
  rounded: {
    borderRadius: 10,
  },
  suppressed: {
    opacity: 0,
  },
})
