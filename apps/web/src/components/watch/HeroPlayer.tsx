"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react"
import { flushSync } from "react-dom"
import Image, { type ImageLoaderProps } from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { Share2 } from "lucide-react"
import type {
  MuxVideo as MuxVideoType,
  MuxPlayerRef,
  MuxVideoRef,
} from "@forge/video-player"

const MuxVideo = dynamic(() => import("@forge/video-player/mux-video"), {
  ssr: false,
}) as typeof MuxVideoType

import { env } from "@/env"
import type { WatchHeroPlayerBlock } from "@/lib/content"
import {
  CONTENT_WIDTH_ALIGN_CLASSES,
  WATCH_PAGE_LEFT_RAIL_CLASSES,
  WATCH_PAGE_RIGHT_EDGE_CLASSES,
} from "@/lib/content-width"
import { languageCodeFor } from "@/lib/language-code"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"
import { getViewerId } from "@/lib/viewer-id"
import {
  ensureWatchProgressAuth,
  getWatchProgress,
  getWatchProgressRatio,
  useWatchProgressRecorder,
} from "@/lib/watch-progress-client"
import { videoLabelMessageKey } from "@/lib/video-labels"
import {
  tryAsContentSlug,
  tryAsLocaleSlug,
  watchEpisodePath,
} from "@/lib/routes"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"
import { WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND } from "@/lib/watch-production-overlays"
import { resolveMuxHeroPosterUrl } from "@/lib/url"
import { WatchPlayerLoadingIndicator } from "@/components/watch/WatchPlayerLoadingIndicator"
import { HeroPlayerControls } from "./HeroPlayerControls"
import { SubtitleOverlay } from "./SubtitleOverlay"
import type { WatchChapterOptimisticVisual } from "./chapter-navigation"
import { MutedSpeakerIcon, PlayIcon } from "./chrome-icons"
import { FORGE_SUBTITLE_TRACK_LABEL } from "./subtitle-track"
import { WATCH_SECTION_EYEBROW_CLASS } from "./watch-section-styles"

type PillState = "play-with-sound" | "tap-to-unmute"

function subscribeViewerId(_onStoreChange: () => void): () => void {
  return () => {}
}

// "" matches SSR HTML; useSyncExternalStore swaps in the real UUID on the
// client. Mux Data treats "" as "no viewer attribution".
function getViewerIdServerSnapshot(): string {
  return ""
}

// Full-width 16:9 frame, capped to the visible viewport height. This keeps
// the sound-on player as tall as the browser can show without exceeding the
// video aspect ratio's needed height.
const HERO_FRAME_HEIGHT_CLASS = "h-[min(100svh,56.25vw)]"
const HERO_FRAME_TRANSITION_CLASS =
  "transition-[height,margin-bottom,top] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
const MOBILE_PORTRAIT_PREVIEW_WRAPPER_CLASS =
  "[@media(max-width:767px)_and_(orientation:portrait)]:h-[100vw]"
const MOBILE_PORTRAIT_PREVIEW_FRAME_CLASS =
  "[@media(max-width:767px)_and_(orientation:portrait)]:overflow-hidden"
const MOBILE_PORTRAIT_PREVIEW_PLAYER_CLASS =
  "[@media(max-width:767px)_and_(orientation:portrait)]:scale-y-100"

// Pulls the body/episode rail over the muted preview only when the rail would
// not otherwise fit below the 16:9 hero. This preserves the full muted preview
// on smaller/taller viewports while still keeping the episode rail in the
// first viewport on squat windows.
const HERO_PREVIEW_PANEL_BOTTOM_PADDING_PX = 32
const HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX = 50
const HERO_PREVIEW_BODY_OVERLAP_MIN_PX = 160
const HERO_PREVIEW_BODY_OVERLAP_MAX_PX = 288

function canScrollWindowTo(windowRef: Window): boolean {
  if (typeof windowRef.scrollTo !== "function") return false
  const scrollTo = windowRef.scrollTo as typeof windowRef.scrollTo & {
    _isMockFunction?: boolean
    mock?: unknown
  }
  if (
    windowRef.navigator.userAgent.toLowerCase().includes("jsdom") &&
    scrollTo._isMockFunction !== true &&
    scrollTo.mock == null
  ) {
    return false
  }
  return true
}

// `<MuxVideo>` is a bare `<video>` + HLS.js wrapper — no shadow DOM, no
// media-chrome, no Mux CSS Custom Properties. Object-fit must be set on the
// element directly.
const PRE_REVEAL_VIDEO_OBJECT_FIT_STYLE: CSSProperties = {
  objectFit: "cover",
}
const REVEALED_VIDEO_OBJECT_FIT_STYLE: CSSProperties = {
  objectFit: "contain",
}

const HERO_HLS_CONFIG = {
  maxBufferLength: 10,
  maxBufferSize: 5_000_000,
  backBufferLength: 5,
  // Mux assets can include generated WebVTT subtitle renditions. Forge owns
  // subtitle selection through the injected track below, so keep HLS.js from
  // creating/auto-selecting Mux's generated caption tracks.
  enableWebVTT: false,
}
const HERO_PLAYER_ID = "watch-hero-player"
const HERO_PLAYER_MEDIA_ID = "watch-hero-player-media"
const HERO_POSTER_TIME_SECONDS = 2
const HERO_POSTER_MAX_WIDTH = 1280
const WATCH_NOW_LINK_CLASS =
  "inline-flex cursor-pointer items-center gap-3 rounded-full px-5 py-2.5 text-base font-medium shadow-lg transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/90 focus-visible:ring-2 focus-visible:ring-brand-red/70 md:py-3 md:text-lg"
const WATCH_NEXT_WINDOW_SECONDS = 5

function isResumableProgress(videoId: string): boolean {
  const savedProgress = getWatchProgress(videoId)
  const ratio = getWatchProgressRatio(savedProgress)
  return ratio > 0 && ratio < 1
}

function buildHeroPosterUrl(
  playbackId: string | undefined,
): string | undefined {
  return resolveMuxHeroPosterUrl(playbackId) ?? undefined
}

function isMuxImageUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).hostname === "image.mux.com"
  } catch {
    return false
  }
}

export function getHeroPosterBlurDataURL({
  heroPosterUrl,
  muxHeroPosterBlurDataUrl,
  shouldOptimizeMuxPoster,
  visualHeroPosterUrl,
}: {
  heroPosterUrl: string | undefined
  muxHeroPosterBlurDataUrl: string | null | undefined
  shouldOptimizeMuxPoster: boolean
  visualHeroPosterUrl: string | undefined
}): string | null {
  return visualHeroPosterUrl === heroPosterUrl && shouldOptimizeMuxPoster
    ? (muxHeroPosterBlurDataUrl ?? null)
    : null
}

function muxHeroPosterLoader({ src, width }: ImageLoaderProps): string {
  const url = new URL(src)
  url.searchParams.set("width", String(Math.min(width, HERO_POSTER_MAX_WIDTH)))
  url.searchParams.set("time", String(HERO_POSTER_TIME_SECONDS))
  return url.toString()
}

// Keep automatic muted-preview activation out of the critical first-load
// window. The poster is already the intentional LCP surface, and user intent
// still activates the player synchronously through the click/pointer handlers.
const IDLE_PREVIEW_FALLBACK_DELAY_MS = 8000
const MOBILE_VISIBLE_PREVIEW_DELAY_MS = 700
const MOBILE_PREVIEW_MAX_WIDTH_PX = 767
const IDLE_PREVIEW_VIEWPORT_MARGIN_PX = 200

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

function isHeroNearViewport(wrapper: HTMLElement, windowRef: Window): boolean {
  const rect = wrapper.getBoundingClientRect()
  const viewportHeight = windowRef.innerHeight
  return (
    rect.bottom >= -IDLE_PREVIEW_VIEWPORT_MARGIN_PX &&
    rect.top <= viewportHeight + IDLE_PREVIEW_VIEWPORT_MARGIN_PX
  )
}

function shouldUseFastMobilePreview(windowRef: Window): boolean {
  return windowRef.innerWidth <= MOBILE_PREVIEW_MAX_WIDTH_PX
}

// Fraction of the visible video that must be obscured by the body section
// before the scroll listener pauses the player. 0.6 = 60% obscured — past
// this point the player is no longer the main element on screen.
const OBSCURED_PAUSE_THRESHOLD = 0.6

// `<MuxVideo>` (bare `<video>`) emits a generic error and the autoplay refusal
// surfaces as a Promise rejection from `play()` with
// `DOMException("NotAllowedError")`.
function isAutoplayBlockedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const named = err as { name?: unknown }
  return named.name === "NotAllowedError" || named.name === "AutoplayNotAllowed"
}

// Minimum number of playable language variants before the language-switch
// globe button appears. With only one variant there's nothing to switch to.
const MIN_VARIANTS_FOR_LANGUAGE_SWITCH = 2

export function HeroPlayer({
  block,
  onPlayerReady,
  onPlayerActivated,
  onLanguageClick,
  onShareClick,
  languageSlug,
  playableLanguageCount,
  darkenOverlay = false,
  overlay,
  subtitleVttSrc,
  optimisticVisual,
  coverBlackoutKey,
  coverBlackoutPhase,
}: {
  block: WatchHeroPlayerBlock
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onPlayerActivated?: () => void
  onLanguageClick?: () => void
  onShareClick?: () => void
  languageSlug?: string | null
  playableLanguageCount?: number
  darkenOverlay?: boolean
  overlay?: ReactNode
  subtitleVttSrc?: string | null
  optimisticVisual?: WatchChapterOptimisticVisual | null
  coverBlackoutKey?: string | null
  coverBlackoutPhase?: "covering" | "revealing" | null
}) {
  const t = useTranslations("HeroPlayer")
  const tBibleQuotes = useTranslations("BibleQuotes")
  const videoLabels = useTranslations("VideoLabels")
  const { video, variant } = block
  const playbackId = variant.muxVideo?.playbackId ?? undefined
  const hlsSrc = variant.hls ?? undefined
  const heroPosterUrl = buildHeroPosterUrl(playbackId)
  const searchParams = useSearchParams()
  const router = useRouter()
  const tParam = searchParams?.get("t")
  const autoplayParam = searchParams?.get("autoplay")
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<MuxPlayerRef | null>(null)
  const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
  const [nextPlaybackState, setNextPlaybackState] = useState({
    currentTime: 0,
    duration: 0,
    paused: true,
    ended: false,
  })
  const nextNavigationStartedRef = useRef(false)
  const setPlayerRef = useCallback(
    (next: MuxPlayerRef | null) => {
      playerRef.current = next
      setPlayer((current) => (current === next ? current : next))
      onPlayerReady?.(next)
    },
    [onPlayerReady],
  )

  useEffect(() => {
    if (subtitleVttSrc === undefined) return

    const el = playerRef.current as HTMLMediaElement | null
    if (!el || !el.textTracks) return

    const tracks = el.textTracks

    const disableBuiltInSubtitles = () => {
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i]!
        if (
          (t.kind === "subtitles" || t.kind === "captions") &&
          t.label !== FORGE_SUBTITLE_TRACK_LABEL
        ) {
          t.mode = "disabled"
        }
      }
    }

    disableBuiltInSubtitles()

    const onAddTrack = () => {
      disableBuiltInSubtitles()
      if (subtitleVttSrc && forgeTrack) {
        forgeTrack.mode = "showing"
      }
    }
    tracks.addEventListener("addtrack", onAddTrack)

    let forgeTrack: TextTrack | null = null

    if (subtitleVttSrc) {
      const video = (() => {
        const muxVideo = (
          el as unknown as HTMLElement
        ).shadowRoot?.querySelector("mux-video") as HTMLElement | null
        return (
          muxVideo?.shadowRoot?.querySelector("video") ??
          (el as unknown as HTMLElement).shadowRoot?.querySelector("video") ??
          // <MuxVideo> path: el IS the underlying <video> element (no
          // shadow root). Without this fallback the custom-track injection
          // silently no-ops under the hero MuxVideo flag.
          (el instanceof HTMLVideoElement ? el : null)
        )
      })()

      if (video) {
        const existing = video.querySelector("track[data-subtitle-track]")
        if (existing) existing.remove()

        const trackEl = document.createElement("track")
        trackEl.kind = "subtitles"
        trackEl.label = FORGE_SUBTITLE_TRACK_LABEL
        trackEl.src = subtitleVttSrc
        trackEl.default = true
        trackEl.setAttribute("data-subtitle-track", "true")
        video.appendChild(trackEl)
        trackEl.track.mode = "showing"
        forgeTrack = trackEl.track

        return () => {
          tracks.removeEventListener("addtrack", onAddTrack)
          trackEl.track.mode = "disabled"
          trackEl.remove()
        }
      }
    }

    return () => {
      tracks.removeEventListener("addtrack", onAddTrack)
    }
  }, [subtitleVttSrc, player])

  const [chromeRevealed, setChromeRevealed] = useState(false)
  const [pillState, setPillState] = useState<PillState>("play-with-sound")
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [playerActivated, setPlayerActivated] = useState(
    () => autoplayParam === "1" || heroPosterUrl == null,
  )
  const pendingSoundIntentRef = useRef<PillState | null>(null)
  const pointerDownHandledSoundIntentRef = useRef(false)

  const publishChromeVisibility = useCallback(
    (detail: WatchPlayerChromeVisibilityDetail) => {
      if (typeof window === "undefined") return
      window.dispatchEvent(
        new CustomEvent<WatchPlayerChromeVisibilityDetail>(
          WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
          { detail },
        ),
      )
    },
    [],
  )

  const handleControlsVisibilityChange = useCallback(
    (detail: WatchPlayerChromeVisibilityDetail) => {
      publishChromeVisibility(detail)
    },
    [publishChromeVisibility],
  )

  useEffect(() => {
    if (!chromeRevealed) {
      publishChromeVisibility({ visible: true, opacity: 1 })
    }
    return () => {
      publishChromeVisibility({ visible: true, opacity: 1 })
    }
  }, [chromeRevealed, publishChromeVisibility])

  useEffect(() => {
    if (!chromeRevealed) return
    onPlayerActivated?.()
  }, [chromeRevealed, onPlayerActivated])

  useEffect(() => {
    if (typeof window === "undefined") return
    const currentPlayer = playerRef.current
    window.dispatchEvent(
      new CustomEvent<WatchPlayerPlaybackStateDetail>(
        WATCH_PLAYER_PLAYBACK_STATE_EVENT,
        {
          detail: {
            playing: currentPlayer ? !currentPlayer.paused : false,
            muted: chromeRevealed ? !!currentPlayer?.muted : true,
            preview: !chromeRevealed,
          },
        },
      ),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent<WatchPlayerPlaybackStateDetail>(
          WATCH_PLAYER_PLAYBACK_STATE_EVENT,
          { detail: { playing: false, muted: true, preview: false } },
        ),
      )
    }
  }, [chromeRevealed])

  // Tracks the first paint where Mux Player has buffered enough to render the
  // muted-loop preview. Without this, the wrapper sits at the player's initial
  // min-height (~200px) during the buffer phase and the title overflows the
  // hero — the viewport/aspect-ratio height class below pins the layout, this
  // hides the empty box behind a spinner until there's something to show.
  const [videoReady, setVideoReady] = useState(false)
  const [playbackBuffering, setPlaybackBuffering] = useState(false)
  const [playerFrameRevealed, setPlayerFrameRevealed] = useState(false)
  const [watchNextModeState, setWatchNextModeState] = useState<{
    videoId: string
    mode: "armed" | "manual"
  } | null>(null)
  const watchNextModeRef = useRef<typeof watchNextModeState>(null)
  const previousNextPlaybackRef = useRef<{
    currentTime: number
    duration: number
    remainingSeconds: number
    paused: boolean
  } | null>(null)
  const seekInProgressRef = useRef(false)
  const suppressNextThresholdRef = useRef(false)
  const handleCanPlay = useCallback(() => {
    setVideoReady(true)
    setPlaybackBuffering(false)
  }, [])
  const handlePlaying = useCallback(() => {
    setPlayerFrameRevealed(true)
    setPlaybackBuffering(false)
  }, [])
  const handlePlaybackBuffering = useCallback(() => {
    setPlaybackBuffering(true)
  }, [])
  const handlePlaybackReady = useCallback(() => {
    setPlaybackBuffering(false)
  }, [])

  const nextWatchHref = useMemo(() => {
    const nextWatchItem = block.nextWatchItem
    const parentSlug =
      nextWatchItem != null ? tryAsContentSlug(nextWatchItem.parentSlug) : null
    const slug =
      nextWatchItem != null ? tryAsContentSlug(nextWatchItem.slug) : null
    const lang = languageSlug != null ? tryAsLocaleSlug(languageSlug) : null
    if (!nextWatchItem || !parentSlug || !slug || !lang) return null
    return watchEpisodePath(parentSlug, slug, lang, { autoplay: true })
  }, [block.nextWatchItem, languageSlug])

  const navigateToNextWatchItem = useCallback(() => {
    if (nextWatchHref == null || nextNavigationStartedRef.current) return
    nextNavigationStartedRef.current = true
    router.push(nextWatchHref)
  }, [nextWatchHref, router])

  useEffect(() => {
    nextNavigationStartedRef.current = false
  }, [video.documentId])

  const watchNextMode =
    watchNextModeState?.videoId === video.documentId
      ? watchNextModeState.mode
      : null
  const watchNextManual = watchNextMode === "manual"
  const watchNextAutoArmed = watchNextMode === "armed"

  useEffect(() => {
    watchNextModeRef.current = watchNextModeState
  }, [watchNextModeState])

  useEffect(() => {
    if (!player || typeof player.addEventListener !== "function") {
      return
    }

    previousNextPlaybackRef.current = null
    seekInProgressRef.current = false
    suppressNextThresholdRef.current = false

    const sync = (eventName: string) => {
      const duration = Number.isFinite(player.duration) ? player.duration : 0
      const currentTime = Number.isFinite(player.currentTime)
        ? player.currentTime
        : 0
      const remainingSeconds =
        duration > 0 ? duration - currentTime : Number.POSITIVE_INFINITY
      const previous = previousNextPlaybackRef.current
      const currentMode = watchNextModeRef.current
      const currentModeApplies = currentMode?.videoId === video.documentId
      const crossingCountdownThreshold =
        eventName === "timeupdate" &&
        previous != null &&
        previous.duration > 0 &&
        previous.remainingSeconds > WATCH_NEXT_WINDOW_SECONDS &&
        remainingSeconds >= 0 &&
        remainingSeconds <= WATCH_NEXT_WINDOW_SECONDS &&
        currentTime >= previous.currentTime &&
        !player.paused &&
        !seekInProgressRef.current &&
        !suppressNextThresholdRef.current
      const seekedIntoCountdownWindow =
        (eventName === "seeked" ||
          seekInProgressRef.current ||
          suppressNextThresholdRef.current) &&
        remainingSeconds >= 0 &&
        remainingSeconds <= WATCH_NEXT_WINDOW_SECONDS
      const outsideCountdownWindow =
        remainingSeconds < 0 || remainingSeconds > WATCH_NEXT_WINDOW_SECONDS

      if (currentModeApplies && outsideCountdownWindow) {
        watchNextModeRef.current = null
        setWatchNextModeState(null)
      } else if (
        seekedIntoCountdownWindow &&
        nextWatchHref != null &&
        (!currentModeApplies || currentMode.mode !== "manual")
      ) {
        const nextMode = { videoId: video.documentId, mode: "manual" } as const
        watchNextModeRef.current = nextMode
        setWatchNextModeState(nextMode)
      } else if (
        crossingCountdownThreshold &&
        nextWatchHref != null &&
        (!currentModeApplies || currentMode.mode !== "manual")
      ) {
        const nextMode = { videoId: video.documentId, mode: "armed" } as const
        watchNextModeRef.current = nextMode
        setWatchNextModeState(nextMode)
      }

      if (eventName === "timeupdate" && suppressNextThresholdRef.current) {
        suppressNextThresholdRef.current = false
      }

      previousNextPlaybackRef.current = {
        currentTime,
        duration,
        remainingSeconds,
        paused: player.paused,
      }
      setNextPlaybackState((current) => {
        if (
          current.currentTime === currentTime &&
          current.duration === duration &&
          current.paused === player.paused &&
          current.ended === player.ended
        ) {
          return current
        }
        return {
          currentTime,
          duration,
          paused: player.paused,
          ended: player.ended,
        }
      })
    }
    const handleEnded = () => {
      sync("ended")
      if (
        watchNextModeRef.current?.videoId === video.documentId &&
        watchNextModeRef.current.mode === "armed"
      ) {
        navigateToNextWatchItem()
      }
    }
    const handleSeeking = () => {
      seekInProgressRef.current = true
      sync("seeking")
    }
    const handleSeeked = () => {
      sync("seeked")
      seekInProgressRef.current = false
      const duration = Number.isFinite(player.duration) ? player.duration : 0
      const currentTime = Number.isFinite(player.currentTime)
        ? player.currentTime
        : 0
      const remainingSeconds =
        duration > 0 ? duration - currentTime : Number.POSITIVE_INFINITY
      suppressNextThresholdRef.current =
        remainingSeconds >= 0 && remainingSeconds <= WATCH_NEXT_WINDOW_SECONDS
    }
    const handleTimeUpdate = () => sync("timeupdate")
    const handleDurationChange = () => sync("durationchange")
    const handleLoadedMetadata = () => sync("loadedmetadata")
    const handlePlay = () => sync("play")
    const handlePause = () => sync("pause")
    const events = [
      ["timeupdate", handleTimeUpdate],
      ["durationchange", handleDurationChange],
      ["loadedmetadata", handleLoadedMetadata],
      ["play", handlePlay],
      ["pause", handlePause],
    ] as const

    sync("init")
    events.forEach(([event, listener]) =>
      player.addEventListener(event, listener),
    )
    player.addEventListener("seeking", handleSeeking)
    player.addEventListener("seeked", handleSeeked)
    player.addEventListener("ended", handleEnded)
    return () => {
      events.forEach(([event, listener]) =>
        player.removeEventListener(event, listener),
      )
      player.removeEventListener("seeking", handleSeeking)
      player.removeEventListener("seeked", handleSeeked)
      player.removeEventListener("ended", handleEnded)
    }
  }, [navigateToNextWatchItem, nextWatchHref, player, video.documentId])

  useEffect(() => {
    if (playerActivated || autoplayParam === "1" || heroPosterUrl == null) {
      return
    }
    if (typeof window === "undefined") return

    let cancelled = false
    let loadListenerInstalled = false
    let idleHandle: number | null = null
    let timeoutHandle: number | null = null
    const idleWindow = window as IdleWindow

    const clearScheduledWork = () => {
      if (idleHandle != null && idleWindow.cancelIdleCallback) {
        idleWindow.cancelIdleCallback(idleHandle)
      }
      idleHandle = null
      if (timeoutHandle != null) {
        window.clearTimeout(timeoutHandle)
      }
      timeoutHandle = null
    }

    const canActivatePreview = () => {
      if (document.visibilityState === "hidden") return false
      const wrapper = wrapperRef.current
      return wrapper ? isHeroNearViewport(wrapper, window) : true
    }

    const tryActivatePreview = () => {
      clearScheduledWork()
      if (cancelled) return
      if (!canActivatePreview()) return
      setPlayerActivated(true)
    }

    const scheduleConservativeActivation = () => {
      if (cancelled || idleHandle != null || timeoutHandle != null) return
      timeoutHandle = window.setTimeout(() => {
        timeoutHandle = null
        if (cancelled) return
        if (idleWindow.requestIdleCallback) {
          idleHandle = idleWindow.requestIdleCallback(tryActivatePreview, {
            timeout: 1000,
          })
          return
        }
        tryActivatePreview()
      }, IDLE_PREVIEW_FALLBACK_DELAY_MS)
    }

    const scheduleFastMobileActivation = () => {
      if (cancelled || idleHandle != null || timeoutHandle != null) return
      timeoutHandle = window.setTimeout(() => {
        timeoutHandle = null
        tryActivatePreview()
      }, MOBILE_VISIBLE_PREVIEW_DELAY_MS)
    }

    const handleLoad = () => {
      loadListenerInstalled = false
      scheduleActivation()
    }

    const scheduleActivation = () => {
      if (document.readyState === "complete") {
        if (shouldUseFastMobilePreview(window)) {
          scheduleFastMobileActivation()
          return
        }
        scheduleConservativeActivation()
        return
      }
      if (loadListenerInstalled) return
      loadListenerInstalled = true
      window.addEventListener("load", handleLoad, { once: true })
    }

    const retryIfEligible = () => {
      scheduleActivation()
    }

    scheduleActivation()
    document.addEventListener("visibilitychange", retryIfEligible)
    window.addEventListener("scroll", retryIfEligible, { passive: true })
    window.addEventListener("resize", retryIfEligible, { passive: true })

    return () => {
      cancelled = true
      clearScheduledWork()
      if (loadListenerInstalled) {
        window.removeEventListener("load", handleLoad)
      }
      document.removeEventListener("visibilitychange", retryIfEligible)
      window.removeEventListener("scroll", retryIfEligible)
      window.removeEventListener("resize", retryIfEligible)
    }
  }, [autoplayParam, heroPosterUrl, playerActivated])

  // Anchor for the title/pill overlay AND the chrome control bar — both live
  // in this zero-height div right after the sticky hero so they ride on the
  // body section's top edge instead of being trapped at the pinned hero's
  // bottom (which the body slides over).
  const [overlayAnchor, setOverlayAnchor] = useState<HTMLDivElement | null>(
    null,
  )
  const [previewBodyOverlapPx, setPreviewBodyOverlapPx] = useState(0)

  // Measured rendered height drives the sticky `top` so the player pins
  // exactly when its bottom reaches the viewport bottom.
  const [heroHeight, setHeroHeight] = useState<number | null>(null)
  // useLayoutEffect: the viewport/aspect-ratio height class on the wrapper
  // means we have a real measurable height before paint, so we can install
  // the ResizeObserver (and seed heroHeight) without flashing the fallback
  // `top: 0px` for a frame.
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const apply = (h: number) => {
      if (h > 0) setHeroHeight(h)
    }
    apply(el.getBoundingClientRect().height)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) apply(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (chromeRevealed || heroHeight == null) return
    const wrapper = wrapperRef.current
    if (!wrapper) return

    let rafHandle = 0
    const calculateMaxOverlap = () =>
      Math.min(
        HERO_PREVIEW_BODY_OVERLAP_MAX_PX,
        Math.max(HERO_PREVIEW_BODY_OVERLAP_MIN_PX, window.innerHeight * 0.24),
      ) + HERO_PREVIEW_BODY_OVERLAP_EXTRA_PX

    const sync = () => {
      rafHandle = 0
      const bodyZone = document.querySelector(
        '[data-testid="watch-body-zone"]',
      ) as HTMLElement | null
      const siblingRail = document.querySelector(
        '[data-block-type="SiblingCarousel"]',
      ) as HTMLElement | null
      if (!bodyZone || !siblingRail) {
        setPreviewBodyOverlapPx(0)
        return
      }

      const bodyRect = bodyZone.getBoundingClientRect()
      const railRect = siblingRail.getBoundingClientRect()
      const railOffsetFromBody = Math.max(0, railRect.top - bodyRect.top)
      const panelHeightNeeded =
        railOffsetFromBody +
        railRect.height +
        HERO_PREVIEW_PANEL_BOTTOM_PADDING_PX
      const spaceBelowHero = Math.max(0, window.innerHeight - heroHeight)
      const neededOverlap = Math.ceil(panelHeightNeeded - spaceBelowHero)
      const nextOverlap = Math.max(
        0,
        Math.min(neededOverlap, calculateMaxOverlap()),
      )
      setPreviewBodyOverlapPx(nextOverlap)
    }

    const scheduleSync = () => {
      if (rafHandle !== 0) return
      rafHandle = window.requestAnimationFrame(sync)
    }

    scheduleSync()
    window.addEventListener("resize", scheduleSync, { passive: true })
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleSync)
    observer?.observe(wrapper)
    const bodyZone = document.querySelector(
      '[data-testid="watch-body-zone"]',
    ) as HTMLElement | null
    const siblingRail = document.querySelector(
      '[data-block-type="SiblingCarousel"]',
    ) as HTMLElement | null
    if (bodyZone) observer?.observe(bodyZone)
    if (siblingRail) observer?.observe(siblingRail)
    return () => {
      window.removeEventListener("resize", scheduleSync)
      observer?.disconnect()
      if (rafHandle !== 0) window.cancelAnimationFrame(rafHandle)
    }
  }, [chromeRevealed, heroHeight])

  // Tracks whether the current paused state was caused by THIS scroll
  // listener, so the auto-resume on scroll-back only fires when WE
  // paused. If the user paused manually (chrome button, keyboard) and
  // then scrolled away, scrolling back must not override their intent.
  const pausedByScrollRef = useRef(false)

  useEffect(() => {
    if (!chromeRevealed) return
    if (typeof window === "undefined") return
    if (window.scrollY <= 0) return
    if (!canScrollWindowTo(window)) return

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [chromeRevealed])

  // Pause the player when the user has scrolled enough that the body
  // section covers >=60% of the visible video, resume when scrolling
  // back drops below that. The hero wrapper is sticky and its bounding
  // rect never leaves the viewport — the body section slides UP over
  // the hero, covering it visually. We measure how much of the visible
  // video has been covered by the body and pause once it crosses the
  // threshold. IntersectionObserver doesn't work here because a sticky
  // element keeps reporting "in viewport" even when painted over.
  //
  // Applies symmetrically in BOTH states: the pre-reveal muted-loop
  // preview AND post-reveal committed playback after "Watch now" / "Tap to Unmute".
  //
  // Depends on `player` (not just `playerRef`) so the effect re-runs
  // once the media ref attaches — without this, a deep-link past
  // the hero would never re-evaluate after mount and the muted preview
  // would keep autoplaying painted-over.
  useEffect(() => {
    if (heroHeight == null) return
    // Reset the scroll-pause provenance flag on every effect mount.
    // Otherwise a heroHeight change while the player was scroll-paused
    // would carry the flag into the new geometry regime and could
    // auto-resume on a resize-driven covered-to-uncovered transition.
    pausedByScrollRef.current = false
    let ticking = false
    let rafHandle = 0
    let prevCovered: boolean | null = null
    const evaluate = () => {
      ticking = false
      rafHandle = 0
      const player = playerRef.current
      if (!player) return
      // Visible video area in the viewport. When the hero is taller than
      // the viewport (typical wide-screen 16:9 layout), the sticky pin
      // keeps the wrapper filling the viewport, so visible = viewport.
      // Otherwise visible = the wrapper's own height.
      const viewportHeight = window.innerHeight
      const visibleVideoHeight = Math.min(heroHeight, viewportHeight)
      // Body covers everything BELOW its viewport top; the unobscured
      // part of the visible video is from the wrapper's visible top down
      // to that line. Prefer the real body position so layout wrappers
      // around the hero chrome/backdrop cannot drift this calculation.
      const wrapper = wrapperRef.current
      const computedMarginBottom = wrapper
        ? Number.parseFloat(window.getComputedStyle(wrapper).marginBottom)
        : 0
      const bodyOverlap = Number.isFinite(computedMarginBottom)
        ? Math.max(0, -computedMarginBottom)
        : 0
      const bodyZone = document.querySelector(
        '[data-testid="watch-body-zone"]',
      ) as HTMLElement | null
      const measuredBodyTop = bodyZone?.getBoundingClientRect().top
      const bodyTopInViewport =
        typeof measuredBodyTop === "number" && Number.isFinite(measuredBodyTop)
          ? measuredBodyTop
          : heroHeight - bodyOverlap - window.scrollY
      const unobscuredHeight = Math.max(
        0,
        Math.min(visibleVideoHeight, bodyTopInViewport),
      )
      const obscuredFraction =
        visibleVideoHeight > 0 ? 1 - unobscuredHeight / visibleVideoHeight : 1
      const covered = obscuredFraction >= OBSCURED_PAUSE_THRESHOLD
      if (covered === prevCovered) return
      prevCovered = covered
      if (covered) {
        // If the player is already paused (user clicked pause before
        // scrolling), leave it alone — and don't claim the scroll-pause
        // flag, so the next scroll-back doesn't override their intent.
        if (player.paused) return
        pausedByScrollRef.current = true
        player.pause()
        return
      }
      // Scroll-back: only auto-resume if WE paused via this listener.
      if (!pausedByScrollRef.current) return
      pausedByScrollRef.current = false
      if (!player.paused) return
      const result = player.play()
      if (result && typeof result.then === "function") {
        // Autoplay may still be blocked on resume (e.g. mobile Safari
        // after a long background tab). Swallow rejection — the user
        // can tap the pill to start playback explicitly.
        result.catch(() => undefined)
      }
    }
    const handleScroll = () => {
      if (ticking) return
      ticking = true
      rafHandle = requestAnimationFrame(evaluate)
    }
    evaluate()
    window.addEventListener("scroll", handleScroll, { passive: true })
    // Viewport resize changes visibleVideoHeight, so the obscured
    // fraction can cross the threshold without any scroll event.
    window.addEventListener("resize", handleScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleScroll)
      // Cancel any pending rAF so a stale closure can't fire after
      // cleanup with the previous heroHeight (and trigger a wrong
      // pause/play on the player).
      if (rafHandle !== 0) cancelAnimationFrame(rafHandle)
    }
  }, [chromeRevealed, heroHeight, player])

  const viewerUserId = useSyncExternalStore(
    subscribeViewerId,
    getViewerId,
    getViewerIdServerSnapshot,
  )
  const [resumeFromSavedProgress, setResumeFromSavedProgress] = useState(false)

  useEffect(() => {
    let cancelled = false
    ensureWatchProgressAuth().then((authenticated) => {
      if (cancelled) return
      if (!authenticated || tParam != null || autoplayParam === "1") return
      if (!isResumableProgress(video.documentId)) return
      setResumeFromSavedProgress(true)
      setPlayerActivated(true)
      setChromeRevealed(true)
    })
    return () => {
      cancelled = true
    }
  }, [autoplayParam, tParam, video.documentId])

  useWatchProgressRecorder({
    player: player as HTMLMediaElement | null,
    videoId: video.documentId,
    languageSlug,
    enabled: chromeRevealed,
  })

  const handleLoadedMetadata = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    const savedProgress =
      tParam == null && isResumableProgress(video.documentId)
        ? getWatchProgress(video.documentId)
        : null
    const parsed =
      tParam != null
        ? Number.parseFloat(tParam)
        : (savedProgress?.positionSeconds ?? Number.NaN)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const duration = Number.isFinite(player.duration) ? player.duration : 0
    const safeDuration = duration > 1 ? duration - 1 : duration
    player.currentTime =
      safeDuration > 0 ? Math.min(parsed, safeDuration) : parsed
  }, [tParam, video.documentId])

  // One-shot autoplay-with-sound when the URL carries `?autoplay=1`.
  // LanguagePickerModal appends this signal so the new page knows the
  // navigation came from a deliberate user gesture (Apply click). The
  // browser's autoplay-with-sound permission is granted via MEI on
  // engaged sites, so the attempt usually succeeds for returning users;
  // for new users the catch falls back to the existing muted-pill flow.
  // The signal is stripped from the URL after the attempt so a page
  // refresh (no gesture) doesn't re-trigger the unmuted play.
  const autoplayAttemptedRef = useRef(false)
  useEffect(() => {
    if (!videoReady) return
    // Read through the ref instead of the state-captured `player` so
    // React Compiler doesn't flag `.muted = false` as state mutation
    // (refs are mutable; useState-returned values are not, per the
    // compiler's analysis). The state value is still in deps below so
    // the effect re-runs when the player attaches.
    const livePlayer = playerRef.current
    if (!livePlayer) return
    if (autoplayAttemptedRef.current) return
    if (autoplayParam !== "1") return
    autoplayAttemptedRef.current = true

    // Strip ?autoplay=1 from the URL up front. Use replaceState (not
    // router.replace) to avoid triggering a Next.js navigation/re-render
    // mid-playback. Stripping before play() settles is intentional: this
    // is a one-shot signal — no retry on rejection, so leaving the param
    // in place would only enable a refresh-induced re-trigger (refresh
    // has no user gesture; the play attempt would be blocked anyway).
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.delete("autoplay")
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      )
    }

    // Normalise to a Promise so the React Compiler treats the setState
    // calls as occurring in an async continuation (not a render-phase
    // cascade). Modern media elements return a Promise from play(); on legacy
    // shims that return undefined, the Promise.resolve() wrap is a no-op
    // success path that still routes through the same `.then` resolution.
    Promise.resolve(livePlayer.play())
      .then(() => {
        // Only commit unmute AFTER play() resolves so the player can't
        // sit unmuted-but-paused (silent surprise) on a media shim
        // that returns a resolved promise without actually playing.
        const settledPlayer = playerRef.current
        if (settledPlayer) settledPlayer.muted = false
        setChromeRevealed(true)
        setAutoplayBlocked(false)
      })
      .catch(() => {
        // Browser blocked unmuted play (no MEI grant). Player is still
        // muted (we never set it false), so the existing muted-preview
        // + "Watch now" pill flow takes over — the user can still
        // commit playback manually.
        //
        // Some browser/media shims reject with a generic Error rather
        // than a named NotAllowedError. Either way, restore the explicit
        // user-action fallback so the page is never left with hidden chrome.
        setAutoplayBlocked(true)
      })
    // Intentionally omits chromeRevealed and setChromeRevealed: the ref
    // guard above is the idempotency lock; chromeRevealed in deps would
    // re-run the effect after a successful attempt commits.
  }, [player, videoReady, autoplayParam, playerRef])

  const runSoundIntent = useCallback(
    (player: MuxPlayerRef, intent: PillState) => {
      if (intent === "tap-to-unmute") {
        // Autoplay was blocked — this gesture both unmutes AND starts playback
        // since the user is now committed. Without play() the user just
        // unmuted a still-paused video.
        player.muted = false
        const tapResult = player.play()
        if (tapResult && typeof tapResult.then === "function") {
          tapResult.catch((err: unknown) => {
            console.warn("[HeroPlayer] tap-to-unmute play() rejected", err)
          })
        }
        setChromeRevealed(true)
        return
      }

      const savedProgress =
        tParam == null ? getWatchProgress(video.documentId) : null
      player.currentTime = savedProgress?.positionSeconds ?? 0
      player.muted = false
      const result = player.play()
      setChromeRevealed(true)
      setAutoplayBlocked(false)
      if (result && typeof result.then === "function") {
        result
          .then(() => {
            setAutoplayBlocked(false)
          })
          .catch((err: unknown) => {
            setPillState("tap-to-unmute")
            setChromeRevealed(false)
            if (isAutoplayBlockedError(err)) {
              setAutoplayBlocked(true)
            }
          })
      }
    },
    [tParam, video.documentId],
  )

  useEffect(() => {
    const player = playerRef.current
    const pendingIntent = pendingSoundIntentRef.current
    if (!player || !pendingIntent) return
    pendingSoundIntentRef.current = null
    runSoundIntent(player, pendingIntent)
  }, [player, runSoundIntent])

  const activatePlayerForIntent = useCallback(() => {
    if (playerActivated) return
    flushSync(() => {
      setPlayerActivated(true)
    })
  }, [playerActivated])

  // iOS user-activation gate: NO `await` between click and play(), or
  // play() will be rejected as not-from-user-gesture. When the poster-first
  // path has not mounted Mux yet, flush the activation synchronously so the
  // ref is available in the same click task whenever the dynamic chunk is
  // already loaded; otherwise keep the user's intent queued for attach.
  const handleUnmuteClick = useCallback(() => {
    if (pointerDownHandledSoundIntentRef.current) {
      pointerDownHandledSoundIntentRef.current = false
      return
    }

    let player = playerRef.current
    if (!playerActivated) {
      activatePlayerForIntent()
      player = playerRef.current
      if (!player) {
        pendingSoundIntentRef.current = pillState
      }
    }
    if (!player) return

    pendingSoundIntentRef.current = null
    runSoundIntent(player, pillState)
  }, [activatePlayerForIntent, pillState, playerActivated, runSoundIntent])

  const handleWatchNowPointerDown = useCallback(() => {
    if (playerActivated) return

    activatePlayerForIntent()
    const player = playerRef.current
    if (!player) {
      pendingSoundIntentRef.current = pillState
      return
    }

    pendingSoundIntentRef.current = null
    pointerDownHandledSoundIntentRef.current = true
    runSoundIntent(player, pillState)
  }, [activatePlayerForIntent, pillState, playerActivated, runSoundIntent])

  const handleWatchNowClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault()
      handleUnmuteClick()
    },
    [handleUnmuteClick],
  )

  const handleWatchNowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === " ") {
        event.preventDefault()
        handleUnmuteClick()
        return
      }
      if (event.key === "Enter") {
        activatePlayerForIntent()
      }
    },
    [activatePlayerForIntent, handleUnmuteClick],
  )

  const handlePlayerError = useCallback((event: Event) => {
    // MuxVideo emits a plain Event — autoplay rejection arrives via the
    // play() promise catch handlers above, not here. This branch tolerates
    // legacy/custom shapes; the optional chain narrows safely to `undefined`
    // for bare <video> errors.
    const code = (
      (event as CustomEvent)?.detail as { code?: string } | undefined
    )?.code
    if (code === "autoplay-blocked") {
      setAutoplayBlocked(true)
      return
    }
    // Any non-autoplay-blocked error (network, decode, manifest 404…) means
    // we will never fire onCanPlay, so videoReady would otherwise stay false
    // forever and the spinner would sit on a black box. Reveal the player
    // element so the underlying media element can render its native error UI.
    setVideoReady(true)
    setPlayerFrameRevealed(true)
    setPlaybackBuffering(false)
  }, [])

  // Reset the buffered/ready spinner when the playable identity changes
  // (variant switch via the language picker, or new playback id), otherwise
  // the spinner stays hidden during the next variant's pre-canplay buffer.
  // The "adjust state during render" pattern (last-rendered key + render-phase
  // setState) avoids the cascading-render warning the React Compiler raises
  // on a useEffect-driven reset, since the new state is queued before commit.
  const [prevVariantKey, setPrevVariantKey] = useState(variant.documentId)
  if (autoplayParam === "1" && !playerActivated) {
    setPlayerActivated(true)
  }
  if (prevVariantKey !== variant.documentId) {
    setPrevVariantKey(variant.documentId)
    setVideoReady(false)
    setPlaybackBuffering(false)
    setPlayerFrameRevealed(false)
    setPlayerActivated(autoplayParam === "1" || heroPosterUrl == null)
  }
  // Variant-scope the autoplay one-shot — without this, a same-component
  // re-render with a new variant id (e.g. soft variant swap) would carry
  // the previous true and skip the new variant's autoplay attempt. Done in
  // an effect rather than the render-phase block above because React
  // Compiler rejects render-phase ref writes (refs aren't reactive).
  useEffect(() => {
    autoplayAttemptedRef.current = false
  }, [variant.documentId])

  const loop = !chromeRevealed
  const muted = !chromeRevealed
  const shouldAutoplay = !resumeFromSavedProgress
  const canUseOptimisticVisual = !chromeRevealed
  const visualHeroPosterUrl = canUseOptimisticVisual
    ? (optimisticVisual?.posterUrl ?? heroPosterUrl)
    : heroPosterUrl
  const visualTitle = canUseOptimisticVisual
    ? (optimisticVisual?.title ?? video.title)
    : video.title
  const visualLabel = canUseOptimisticVisual
    ? (optimisticVisual?.label ?? video.label)
    : video.label
  const showOptimisticPoster =
    canUseOptimisticVisual && optimisticVisual?.posterUrl != null
  const showPendingPosterTransition =
    showOptimisticPoster && optimisticVisual?.loading === true
  const posterIdentity = visualHeroPosterUrl ?? "none"
  const shouldOptimizeMuxPoster = isMuxImageUrl(visualHeroPosterUrl)
  const optimisticPosterBlurDataURL = showOptimisticPoster
    ? (optimisticVisual?.posterBlurDataUrl ?? null)
    : null
  const heroPosterBlurDataURL =
    optimisticPosterBlurDataURL ??
    getHeroPosterBlurDataURL({
      heroPosterUrl,
      muxHeroPosterBlurDataUrl: variant.muxHeroPosterBlurDataUrl,
      shouldOptimizeMuxPoster,
      visualHeroPosterUrl,
    })
  const coverLoading =
    showPendingPosterTransition || (playerActivated && !videoReady)
  const showPosterBlackBridge = false
  const posterLayerKey = posterIdentity
  const posterOpacityClass =
    playerFrameRevealed && !showOptimisticPoster ? "opacity-0" : "opacity-100"
  const posterTransitionClass = showOptimisticPoster
    ? ""
    : "transition-opacity duration-[1000ms]"
  const posterImageMotionClass = ""
  const coverBlackoutMotionClass =
    coverBlackoutPhase === "revealing"
      ? "watch-hero-cover-black-bridge"
      : "watch-hero-cover-to-black"

  // Hide the language-switch globe while the player is in fullscreen so it
  // doesn't sit on top of the playing video chrome. Restores when the user
  // exits fullscreen. Listen for both the standard event and the webkit
  // prefix so Safari is covered.
  // Shared hook — same source of truth as HeroPlayerControls, prevents the
  // dual-listener desync where the late-mounted controls could miss the
  // initial fullscreenchange event.
  const isFullscreen = useIsFullscreen()

  // Both globe surfaces (top-right floating + in-chrome) share this gate:
  // a wired callback AND enough variants to warrant a switcher. The
  // top-right surface adds `!isFullscreen` because it overlaps the
  // browser's fullscreen chrome; the in-chrome surface intentionally
  // stays visible in fullscreen so the user can still reach the picker.
  const hasLanguageSwitcher =
    typeof onLanguageClick === "function" &&
    (playableLanguageCount ?? 0) >= MIN_VARIANTS_FOR_LANGUAGE_SWITCH
  const showLanguageSwitch = hasLanguageSwitcher && !isFullscreen
  const showTopLanguageSwitch = showLanguageSwitch
  const languageCode = languageCodeFor({
    bcp47: variant.language?.bcp47,
    iso3: variant.language?.iso3,
    slug: variant.language?.slug ?? languageSlug,
  })
  const suppressPreRevealOverlay = autoplayParam === "1" && !autoplayBlocked
  const preRevealActionLabel =
    pillState === "tap-to-unmute" ? t("tapToUnmute") : t("playWithSound")
  const playbackFrameActive =
    chromeRevealed || (autoplayParam === "1" && !autoplayBlocked)
  const effectivePreviewBodyOverlapPx = playbackFrameActive
    ? 0
    : previewBodyOverlapPx
  const mobilePortraitPreviewEnabled = !playbackFrameActive && overlay == null
  const mediaFrameClassName = `relative h-full w-full ${
    mobilePortraitPreviewEnabled ? MOBILE_PORTRAIT_PREVIEW_FRAME_CLASS : ""
  }`
  const playerClassName = `watch-hero-player-video block h-full w-full origin-top ${
    playbackFrameActive
      ? ""
      : `scale-y-110 ${
          mobilePortraitPreviewEnabled
            ? MOBILE_PORTRAIT_PREVIEW_PLAYER_CLASS
            : ""
        }`
  }`
  const remainingSeconds =
    nextPlaybackState.duration > 0
      ? nextPlaybackState.duration - nextPlaybackState.currentTime
      : Number.POSITIVE_INFINITY
  const watchNextWindowActive =
    remainingSeconds >= 0 && remainingSeconds <= WATCH_NEXT_WINDOW_SECONDS
  const watchNextProgressPct = watchNextWindowActive
    ? Math.min(
        100,
        Math.max(
          0,
          ((WATCH_NEXT_WINDOW_SECONDS - remainingSeconds) /
            WATCH_NEXT_WINDOW_SECONDS) *
            100,
        ),
      )
    : 0
  const showWatchNextButton =
    chromeRevealed && nextWatchHref != null && watchNextWindowActive
  const cancelWatchNextAutoAdvance = useCallback(() => {
    if (watchNextWindowActive) {
      const nextMode = { videoId: video.documentId, mode: "manual" } as const
      watchNextModeRef.current = nextMode
      setWatchNextModeState(nextMode)
    }
  }, [video.documentId, watchNextWindowActive])

  const handleWatchNextSurfaceInteract = useCallback(
    (event: PointerEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => {
      const target = event.target
      if (
        target instanceof Element &&
        target.closest('[data-testid="hero-player-watch-next"]')
      ) {
        return
      }

      cancelWatchNextAutoAdvance()
    },
    [cancelWatchNextAutoAdvance],
  )

  useEffect(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
        WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
        {
          detail: {
            visible: showTopLanguageSwitch,
            onClick: showTopLanguageSwitch ? (onLanguageClick ?? null) : null,
            languageCode: showTopLanguageSwitch ? languageCode : null,
          },
        },
      ),
    )
  }, [languageCode, onLanguageClick, showTopLanguageSwitch])

  useEffect(() => {
    if (typeof window === "undefined") return
    return () => {
      window.dispatchEvent(
        new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
          WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
          { detail: { visible: false, onClick: null, languageCode: null } },
        ),
      )
    }
  }, [])

  return (
    <>
      <div
        id={HERO_PLAYER_ID}
        ref={wrapperRef}
        data-block-type="HeroPlayer"
        data-testid="hero-player-wrapper"
        data-chrome-revealed={chromeRevealed ? "true" : "false"}
        data-preview-overlap={
          effectivePreviewBodyOverlapPx > 0 ? "true" : "false"
        }
        data-preview-overlap-px={effectivePreviewBodyOverlapPx}
        data-autoplay-blocked={autoplayBlocked ? "true" : "false"}
        data-mobile-portrait-preview={
          mobilePortraitPreviewEnabled ? "true" : "false"
        }
        onPointerDownCapture={handleWatchNextSurfaceInteract}
        onKeyDownCapture={handleWatchNextSurfaceInteract}
        className={`sticky relative w-full ${HERO_FRAME_HEIGHT_CLASS} bg-black ${HERO_FRAME_TRANSITION_CLASS} ${
          playbackFrameActive
            ? "overflow-hidden"
            : `overflow-x-clip ${
                mobilePortraitPreviewEnabled
                  ? MOBILE_PORTRAIT_PREVIEW_WRAPPER_CLASS
                  : ""
              }`
        }`}
        style={{
          // 100svh tracks the *small* viewport on iOS Safari (visible area
          // when the URL bar is showing). Plain 100vh is the *large*
          // viewport, so calc(100vh - heroHeight) goes positive while the
          // URL bar is up and `min()` clamps `top` to 0 — defeating the
          // pin-when-bottom-hits-viewport-bottom contract on mobile.
          top:
            heroHeight != null
              ? `min(0px, calc(100svh - ${heroHeight}px))`
              : "0px",
          marginBottom:
            effectivePreviewBodyOverlapPx <= 0
              ? "0px"
              : `${-effectivePreviewBodyOverlapPx}px`,
        }}
      >
        <div
          id={HERO_PLAYER_MEDIA_ID}
          data-testid="hero-player-media-frame"
          className={mediaFrameClassName}
        >
          <style>{`
            .watch-hero-player-video::cue {
              color: transparent;
              background: transparent;
              text-shadow: none;
              visibility: hidden;
            }
          `}</style>
          {playerActivated ? (
            <MuxVideo
              ref={setPlayerRef as React.Ref<MuxVideoRef>}
              playbackId={playbackId}
              src={playbackId ? undefined : hlsSrc}
              // Native <video> takes boolean `autoPlay` + separate `muted`.
              autoPlay={shouldAutoplay}
              muted={muted}
              loop={loop}
              preload="metadata"
              // Light-DOM poster: the <video poster=...> attribute renders as
              // a regular IMG before the first frame paints, so the existing
              // <link rel="preload"> in page.tsx is reused and the LCP element
              // is discoverable in the initial HTML scan.
              poster={heroPosterUrl}
              envKey={env.NEXT_PUBLIC_MUX_DATA_ENV_KEY}
              disableCookies={true}
              // Override the wrapper's default — the hero is the one MuxVideo
              // consumer that *needs* Mux Data attribution (player_name +
              // video_id), unlike the inline/carousel video sections.
              disableTracking={false}
              metadata={{
                player_name: "forge-web-watch",
                video_title: video.title ?? undefined,
                video_id: video.documentId,
                viewer_user_id: viewerUserId,
              }}
              _hlsConfig={HERO_HLS_CONFIG}
              style={
                playbackFrameActive
                  ? REVEALED_VIDEO_OBJECT_FIT_STYLE
                  : PRE_REVEAL_VIDEO_OBJECT_FIT_STYLE
              }
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={handleCanPlay}
              onPlaying={handlePlaying}
              onWaiting={handlePlaybackBuffering}
              onStalled={handlePlaybackBuffering}
              onSeeking={handlePlaybackBuffering}
              onSeeked={handlePlaybackReady}
              // React's SyntheticEvent<HTMLVideoElement> is structurally
              // narrower than the native Event the handler consumes at
              // runtime; cast bridges the type-system difference.
              onError={(event) => handlePlayerError(event as unknown as Event)}
              className={playerClassName}
            />
          ) : null}

          {visualHeroPosterUrl ? (
            <div
              key={posterLayerKey}
              data-testid="hero-player-poster-layer"
              data-cover-loading={coverLoading ? "true" : "false"}
              data-cover-transition={
                showPosterBlackBridge ? "black-bridge" : "none"
              }
              className={`pointer-events-none absolute inset-0 z-1 ${posterTransitionClass} ${posterOpacityClass}`}
            >
              <Image
                data-testid="hero-player-poster"
                src={visualHeroPosterUrl}
                loader={
                  shouldOptimizeMuxPoster ? muxHeroPosterLoader : undefined
                }
                alt=""
                aria-hidden="true"
                fill
                unoptimized={!shouldOptimizeMuxPoster}
                loading="eager"
                fetchPriority="high"
                preload={shouldOptimizeMuxPoster}
                sizes="100vw"
                {...(heroPosterBlurDataURL
                  ? {
                      placeholder: "blur" as const,
                      blurDataURL: heroPosterBlurDataURL,
                    }
                  : {})}
                className={`object-cover ${posterImageMotionClass}`}
              />
              {!chromeRevealed ? (
                <div
                  aria-hidden="true"
                  data-testid="hero-player-poster-muted-backdrop"
                  className="pointer-events-none absolute inset-0 [background:var(--watch-player-muted-backdrop)]"
                  style={
                    {
                      "--watch-player-muted-backdrop":
                        WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND,
                    } as CSSProperties
                  }
                />
              ) : null}
              {darkenOverlay ? (
                <div
                  aria-hidden="true"
                  data-testid="hero-player-poster-darken-overlay"
                  className="pointer-events-none absolute inset-0 bg-black/50"
                />
              ) : null}
              {showPosterBlackBridge ? (
                <div
                  data-testid="hero-player-cover-black-bridge"
                  aria-hidden="true"
                  className="watch-hero-cover-black-bridge pointer-events-none absolute inset-0 bg-black"
                />
              ) : null}
            </div>
          ) : null}

          {coverBlackoutKey != null && coverBlackoutPhase != null ? (
            <div
              key={`${coverBlackoutKey}:${coverBlackoutPhase}`}
              data-testid="hero-player-cover-blackout"
              aria-hidden="true"
              className={`${coverBlackoutMotionClass} pointer-events-none absolute inset-0 z-2 bg-black`}
            />
          ) : null}

          {!chromeRevealed && overlay == null ? (
            <button
              type="button"
              data-testid="hero-player-pre-reveal-click-surface"
              aria-hidden="true"
              tabIndex={-1}
              onPointerDown={activatePlayerForIntent}
              onClick={handleUnmuteClick}
              className="absolute inset-0 z-1 cursor-pointer bg-transparent focus:outline-none"
            />
          ) : null}

          {playbackFrameActive &&
          playerActivated &&
          (!videoReady || playbackBuffering) ? (
            <div
              data-testid="hero-player-loading"
              className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center"
            >
              <WatchPlayerLoadingIndicator />
            </div>
          ) : null}

          {!chromeRevealed ? (
            <div
              aria-hidden="true"
              data-testid="hero-player-muted-backdrop"
              className="pointer-events-none absolute inset-0 [background:var(--watch-player-muted-backdrop)]"
              style={
                {
                  "--watch-player-muted-backdrop":
                    WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND,
                } as CSSProperties
              }
            />
          ) : null}

          {darkenOverlay ? (
            <div
              aria-hidden="true"
              data-testid="hero-player-darken-overlay"
              className="pointer-events-none absolute inset-0 bg-black/50"
            />
          ) : null}
        </div>

        {chromeRevealed ? (
          <HeroPlayerControls
            player={player}
            playerRef={playerRef}
            wrapperRef={wrapperRef}
            overlayAnchor={overlayAnchor}
            playbackId={playbackId}
            onLanguageClick={onLanguageClick}
            languageCode={languageCode}
            // In-chrome globe intentionally stays visible in fullscreen
            // (the top-right one is hidden by isFullscreen).
            showLanguageButton={hasLanguageSwitcher}
            onVisibilityChange={handleControlsVisibilityChange}
            onWatchNextInteraction={cancelWatchNextAutoAdvance}
          />
        ) : null}
        <SubtitleOverlay
          playerRef={playerRef}
          wrapperRef={wrapperRef}
          player={player}
        />
        {showWatchNextButton ? (
          <button
            type="button"
            data-testid="hero-player-watch-next"
            data-kind={block.nextWatchItem?.kind ?? "chapter"}
            data-manual={watchNextManual ? "true" : "false"}
            data-auto-armed={watchNextAutoArmed ? "true" : "false"}
            aria-label="Next Episode"
            onClick={navigateToNextWatchItem}
            className={`animate-overlay-fade-in absolute bottom-24 z-30 isolate flex min-w-40 cursor-pointer items-center gap-3 overflow-hidden rounded-full px-5 py-3 text-left shadow-2xl shadow-black/40 ring-1 backdrop-blur-md transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white md:bottom-28 ${WATCH_PAGE_RIGHT_EDGE_CLASSES} ${
              watchNextManual
                ? "bg-white text-black ring-white hover:bg-white"
                : "bg-black/70 text-white ring-white/20 hover:bg-black/80"
            }`}
          >
            {!watchNextManual ? (
              <span
                aria-hidden="true"
                data-testid="hero-player-watch-next-progress"
                className="absolute inset-y-0 left-0 -z-10 bg-brand-red transition-[width] duration-200 ease-linear"
                style={{ width: `${watchNextProgressPct}%` }}
              />
            ) : null}
            <PlayIcon />
            <span className="relative text-base font-bold leading-none">
              Next Episode
            </span>
          </button>
        ) : null}
      </div>

      {/*
        Zero-height anchor right after the sticky hero. The title/label/pill
        (pre-reveal) and the chrome control bar (post-reveal, portaled in
        from <HeroPlayerControls>) both attach to this anchor's bottom edge.
        The anchor lives in normal flow and so scrolls with the document —
        which means everything attached here rides up on the body section's
        top edge instead of being trapped at the sticky hero's pinned bottom
        (which the body slides over).
      */}
      <div
        ref={setOverlayAnchor}
        data-testid="hero-player-overlay-anchor"
        className={`relative z-10 h-0 ${CONTENT_WIDTH_ALIGN_CLASSES}`}
      >
        {!chromeRevealed && !suppressPreRevealOverlay
          ? (overlay ?? (
              <div
                data-testid="hero-player-overlay"
                className={`absolute right-6 bottom-0 ${WATCH_PAGE_LEFT_RAIL_CLASSES} flex flex-col items-start gap-3 pb-12 md:right-auto`}
              >
                {visualLabel ? (
                  <span
                    data-testid="hero-player-overlay-label"
                    className={WATCH_SECTION_EYEBROW_CLASS}
                  >
                    {videoLabels(videoLabelMessageKey(visualLabel))}
                  </span>
                ) : null}
                {visualTitle ? (
                  <h1
                    data-testid="hero-player-overlay-title"
                    className="max-w-[calc(100vw-5rem)] text-2xl leading-[1.08] font-bold text-balance break-words text-white drop-shadow-lg sm:text-4xl md:max-w-[18ch] md:text-6xl xl:max-w-[20ch] xl:text-7xl"
                  >
                    {visualTitle}
                  </h1>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <button
                    type="button"
                    data-testid="hero-player-unmute-pill"
                    data-state={pillState}
                    aria-label={preRevealActionLabel}
                    aria-controls={HERO_PLAYER_MEDIA_ID}
                    onPointerDown={handleWatchNowPointerDown}
                    onKeyDown={handleWatchNowKeyDown}
                    onClick={handleWatchNowClick}
                    className={
                      pillState === "tap-to-unmute"
                        ? `${WATCH_NOW_LINK_CLASS} bg-amber-500 text-stone-950 ring-2 ring-amber-300/60 hover:bg-amber-400`
                        : `${WATCH_NOW_LINK_CLASS} bg-brand-red text-white hover:bg-brand-red`
                    }
                  >
                    {pillState === "tap-to-unmute" ? (
                      <MutedSpeakerIcon />
                    ) : (
                      <PlayIcon />
                    )}
                    <span>{preRevealActionLabel}</span>
                  </button>
                  {onShareClick ? (
                    <button
                      type="button"
                      data-testid="hero-player-share-button"
                      aria-label={tBibleQuotes("share")}
                      onClick={onShareClick}
                      className={`${WATCH_NOW_LINK_CLASS} border border-transparent bg-transparent text-white hover:border-white/50 hover:bg-white/12`}
                    >
                      <Share2 className="h-5 w-5 shrink-0" aria-hidden />
                      {tBibleQuotes("share")}
                    </button>
                  ) : null}
                </div>
              </div>
            ))
          : null}
      </div>
    </>
  )
}
