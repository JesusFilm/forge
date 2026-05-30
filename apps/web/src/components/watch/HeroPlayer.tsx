"use client"

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react"
import { useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import type {
  MuxPlayer as MuxPlayerType,
  MuxVideo as MuxVideoType,
  MuxPlayerRef,
  MuxVideoRef,
} from "@forge/video-player"
import type { MuxCSSProperties } from "@mux/mux-player-react"

// Both backends are split into separate chunks via subpath imports
// (`@forge/video-player/mux-player` vs `/mux-video`) so Turbopack emits
// one chunk per backend instead of merging them through the package's
// barrel export. `ssr: false` defers each chunk to client-only — only
// the actually-rendered branch invokes its dynamic factory at runtime,
// so the inactive chunk lands in `.next/static/chunks/` but is never
// fetched by the browser. The flag selection itself is a runtime read
// of `env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO` (see JSX below); this
// preserves test-time toggling at the cost of shipping both chunks on
// disk (Railway env vars still control which one activates per build).
const MuxPlayer = dynamic(() => import("@forge/video-player/mux-player"), {
  ssr: false,
}) as typeof MuxPlayerType
const MuxVideo = dynamic(() => import("@forge/video-player/mux-video"), {
  ssr: false,
}) as typeof MuxVideoType

import { env } from "@/env"
import type { WatchHeroPlayerBlock } from "@/lib/content"
import { WATCH_PAGE_LEFT_RAIL_CLASSES } from "@/lib/content-width"
import { useIsFullscreen } from "@/lib/use-is-fullscreen"
import { getViewerId } from "@/lib/viewer-id"
import {
  WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  WATCH_PLAYER_PLAYBACK_STATE_EVENT,
  type WatchHeaderLanguageSwitcherDetail,
  type WatchPlayerChromeVisibilityDetail,
  type WatchPlayerPlaybackStateDetail,
} from "@/lib/watch-player-chrome-events"
import { WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND } from "@/lib/watch-production-overlays"
import { SpinnerIcon } from "@/components/ui/spinner"
import { HeroPlayerControls } from "./HeroPlayerControls"
import { SubtitleOverlay } from "./SubtitleOverlay"
import { MutedSpeakerIcon, UnmutedSpeakerIcon } from "./chrome-icons"
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

// Mux Player's chrome stays hidden at all times — we render our own
// React-based chrome via <HeroPlayerControls />.
// CSS Custom Properties: https://github.com/muxinc/elements/blob/main/packages/mux-player/REFERENCE.md
const CHROME_HIDE_STYLE: MuxCSSProperties = {
  "--controls": "none",
  "--top-controls": "none",
  "--center-controls": "none",
  "--bottom-controls": "none",
}

// Object-fit modes per playback phase:
//   pre-reveal (muted preview) → cover: fills the hero box, may crop;
//   chrome-revealed (sound on) → contain: never crops. The wrapper is
//   sized so the 16:9 frame fits inside both axes — the inner video
//   then exactly fills the wrapper.
const PRE_REVEAL_OBJECT_FIT_STYLE: MuxCSSProperties = {
  "--media-object-fit": "cover",
}
const REVEALED_OBJECT_FIT_STYLE: MuxCSSProperties = {
  "--media-object-fit": "contain",
}

// `<MuxVideo>` is a bare `<video>` + HLS.js wrapper — no shadow DOM, no
// media-chrome, no Mux CSS Custom Properties. Object-fit must be set on the
// element directly. Used by the flag-on branch only.
const PRE_REVEAL_VIDEO_OBJECT_FIT_STYLE: CSSProperties = {
  objectFit: "cover",
}
const REVEALED_VIDEO_OBJECT_FIT_STYLE: CSSProperties = {
  objectFit: "contain",
}

// Fraction of the visible video that must be obscured by the body section
// before the scroll listener pauses the player. 0.6 = 60% obscured — past
// this point the player is no longer the main element on screen.
const OBSCURED_PAUSE_THRESHOLD = 0.6

// `<MuxPlayer>` emits a CustomEvent with `detail.code === "autoplay-blocked"`
// when the browser refuses autoplay. `<MuxVideo>` (bare `<video>`) emits a
// generic error and the autoplay refusal surfaces as a Promise rejection
// from `play()` with `DOMException("NotAllowedError")`. This helper unifies
// the two signals so the surrounding code stays branch-free.
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
  onLanguageClick,
  playableLanguageCount,
  darkenOverlay = false,
  overlay,
  subtitleVttSrc,
}: {
  block: WatchHeroPlayerBlock
  onPlayerReady?: (player: MuxPlayerRef | null) => void
  onLanguageClick?: () => void
  playableLanguageCount?: number
  darkenOverlay?: boolean
  overlay?: ReactNode
  subtitleVttSrc?: string | null
}) {
  const { video, variant } = block
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<MuxPlayerRef | null>(null)
  const [player, setPlayer] = useState<MuxPlayerRef | null>(null)
  const setPlayerRef = useCallback(
    (next: MuxPlayerRef | null) => {
      playerRef.current = next
      setPlayer(next)
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
          t.label !== "__forge_subtitle__"
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
        trackEl.label = "__forge_subtitle__"
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
  const [controlsChromeVisible, setControlsChromeVisible] = useState(true)
  const [pillState, setPillState] = useState<PillState>("play-with-sound")
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)

  const publishChromeVisibility = useCallback((visible: boolean) => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent<WatchPlayerChromeVisibilityDetail>(
        WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
        { detail: { visible } },
      ),
    )
  }, [])

  const handleControlsVisibilityChange = useCallback(
    (visible: boolean) => {
      setControlsChromeVisible(visible)
      publishChromeVisibility(visible)
    },
    [publishChromeVisibility],
  )

  useEffect(() => {
    if (!chromeRevealed) {
      publishChromeVisibility(true)
    }
    return () => {
      publishChromeVisibility(true)
    }
  }, [chromeRevealed, publishChromeVisibility])

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
  // hero — `aspect-video` below pins the layout, this hides the empty box
  // behind a spinner until there's something to show.
  const [videoReady, setVideoReady] = useState(false)
  const handleCanPlay = useCallback(() => {
    setVideoReady(true)
  }, [])

  // Anchor for the title/pill overlay AND the chrome control bar — both live
  // in this zero-height div right after the sticky hero so they ride on the
  // body section's top edge instead of being trapped at the pinned hero's
  // bottom (which the body slides over).
  const [overlayAnchor, setOverlayAnchor] = useState<HTMLDivElement | null>(
    null,
  )

  // Measured rendered height drives the sticky `top` so the player pins
  // exactly when its bottom reaches the viewport bottom. Aspect-ratio is
  // determined by mux-player at runtime, so we measure rather than guess.
  const [heroHeight, setHeroHeight] = useState<number | null>(null)
  // useLayoutEffect: aspect-video on the wrapper means we have a real
  // measurable height before paint, so we can install the ResizeObserver
  // (and seed heroHeight) without flashing the fallback `top: 0px` for a
  // frame.
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

  // Tracks whether the current paused state was caused by THIS scroll
  // listener, so the auto-resume on scroll-back only fires when WE
  // paused. If the user paused manually (chrome button, keyboard) and
  // then scrolled away, scrolling back must not override their intent.
  const pausedByScrollRef = useRef(false)

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
  // preview AND post-reveal committed playback after "Play with Sound"
  // / "Tap to Unmute".
  //
  // Depends on `player` (not just `playerRef`) so the effect re-runs
  // once the MuxPlayer ref attaches — without this, a deep-link past
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
      // The body section sits right after the hero in flow at doc-y =
      // heroHeight; in the viewport its top is heroHeight - scrollY.
      // Body covers everything BELOW that line; the unobscured part of
      // the visible video is from the wrapper's visible top down to
      // that line.
      const bodyTopInViewport = heroHeight - window.scrollY
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
  }, [heroHeight, player])

  const viewerUserId = useSyncExternalStore(
    subscribeViewerId,
    getViewerId,
    getViewerIdServerSnapshot,
  )

  const searchParams = useSearchParams()
  const tParam = searchParams?.get("t")
  const autoplayParam = searchParams?.get("autoplay")
  const handleLoadedMetadata = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    if (tParam == null) return
    const parsed = Number.parseFloat(tParam)
    if (!Number.isFinite(parsed) || parsed < 0) return
    const duration = Number.isFinite(player.duration) ? player.duration : 0
    const safeDuration = duration > 1 ? duration - 1 : duration
    player.currentTime =
      safeDuration > 0 ? Math.min(parsed, safeDuration) : parsed
  }, [tParam])

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
    // cascade). Modern Mux Player returns a Promise from play(); on legacy
    // shims that return undefined, the Promise.resolve() wrap is a no-op
    // success path that still routes through the same `.then` resolution.
    Promise.resolve(livePlayer.play())
      .then(() => {
        // Only commit unmute AFTER play() resolves so the player can't
        // sit unmuted-but-paused (silent surprise) on a Mux Player shim
        // that returns a resolved promise without actually playing.
        const settledPlayer = playerRef.current
        if (settledPlayer) settledPlayer.muted = false
        setChromeRevealed(true)
        setAutoplayBlocked(false)
      })
      .catch((err: unknown) => {
        // Browser blocked unmuted play (no MEI grant). Player is still
        // muted (we never set it false), so the existing muted-preview
        // + "Play with Sound" pill flow takes over — the user can still
        // commit playback manually.
        //
        // Under MuxVideo (bare <video>) the same condition also catches
        // initial autoplay-muted rejections — `NotAllowedError` is the
        // standard signal that replaces MuxPlayer's
        // `event.detail.code === "autoplay-blocked"`.
        if (isAutoplayBlockedError(err)) {
          setAutoplayBlocked(true)
        }
      })
    // Intentionally omits chromeRevealed and setChromeRevealed: the ref
    // guard above is the idempotency lock; chromeRevealed in deps would
    // re-run the effect after a successful attempt commits.
  }, [player, videoReady, autoplayParam, playerRef])

  // iOS user-activation gate: NO `await` between click and play(), or
  // play() will be rejected as not-from-user-gesture.
  const handleUnmuteClick = useCallback(() => {
    const player = playerRef.current
    if (!player) return

    if (pillState === "tap-to-unmute") {
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

    // Initial click commits playback from the beginning, not from wherever the
    // muted preview loop happened to be when the user clicked.
    player.currentTime = 0
    player.muted = false
    const result = player.play()
    if (result && typeof result.then === "function") {
      result
        .then(() => {
          setChromeRevealed(true)
          setAutoplayBlocked(false)
        })
        .catch((err: unknown) => {
          setPillState("tap-to-unmute")
          if (isAutoplayBlockedError(err)) {
            setAutoplayBlocked(true)
          }
        })
    } else {
      setChromeRevealed(true)
    }
  }, [pillState])

  const handlePlayerError = useCallback((event: Event) => {
    // MuxPlayer emits a CustomEvent with `detail.code === "autoplay-blocked"`.
    // MuxVideo emits a plain Event — autoplay rejection arrives via the
    // play() promise catch handlers above, not here. This branch tolerates
    // both shapes; the optional chain narrows safely to `undefined` for
    // bare <video> errors.
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
  }, [])

  const playbackId = variant.muxVideo?.playbackId ?? undefined
  const hlsSrc = variant.hls ?? undefined

  // Reset the buffered/ready spinner when the playable identity changes
  // (variant switch via the language picker, or new playback id), otherwise
  // the spinner stays hidden during the next variant's pre-canplay buffer.
  // The "adjust state during render" pattern (last-rendered key + render-phase
  // setState) avoids the cascading-render warning the React Compiler raises
  // on a useEffect-driven reset, since the new state is queued before commit.
  const [prevVariantKey, setPrevVariantKey] = useState(variant.documentId)
  if (prevVariantKey !== variant.documentId) {
    setPrevVariantKey(variant.documentId)
    setVideoReady(false)
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
  const showTopLanguageSwitch =
    showLanguageSwitch && (!chromeRevealed || controlsChromeVisible)

  useEffect(() => {
    if (typeof window === "undefined") return
    window.dispatchEvent(
      new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
        WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
        {
          detail: {
            visible: showTopLanguageSwitch,
            onClick: showTopLanguageSwitch ? (onLanguageClick ?? null) : null,
          },
        },
      ),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent<WatchHeaderLanguageSwitcherDetail>(
          WATCH_HEADER_LANGUAGE_SWITCHER_EVENT,
          { detail: { visible: false, onClick: null } },
        ),
      )
    }
  }, [onLanguageClick, showTopLanguageSwitch])

  return (
    <>
      <div
        ref={wrapperRef}
        data-block-type="HeroPlayer"
        data-testid="hero-player-wrapper"
        data-chrome-revealed={chromeRevealed ? "true" : "false"}
        data-autoplay-blocked={autoplayBlocked ? "true" : "false"}
        className={`sticky w-full h-[calc(100svh-300px)] min-h-[400px] bg-black ${chromeRevealed ? "overflow-hidden" : "overflow-x-clip"}`}
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
        }}
      >
        {env.NEXT_PUBLIC_FORGE_WATCH_HERO_MUX_VIDEO ? (
          <MuxVideo
            ref={setPlayerRef as React.Ref<MuxVideoRef>}
            playbackId={playbackId}
            src={playbackId ? undefined : hlsSrc}
            // Native <video> takes boolean `autoPlay` + separate `muted`;
            // MuxPlayer's `autoPlay="muted"` string literal is a Mux-
            // specific shorthand the bare element doesn't accept.
            autoPlay
            muted={muted}
            loop={loop}
            preload="metadata"
            // Light-DOM poster: the <video poster=...> attribute renders as
            // a regular IMG before the first frame paints, so the existing
            // <link rel="preload"> in page.tsx is reused and the LCP element
            // is discoverable in the initial HTML scan.
            poster={
              playbackId
                ? `https://image.mux.com/${playbackId}/thumbnail.webp?width=1280`
                : undefined
            }
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
            _hlsConfig={{
              maxBufferLength: 10,
              maxBufferSize: 5_000_000,
              backBufferLength: 5,
            }}
            style={
              chromeRevealed
                ? REVEALED_VIDEO_OBJECT_FIT_STYLE
                : PRE_REVEAL_VIDEO_OBJECT_FIT_STYLE
            }
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            // React's SyntheticEvent<HTMLVideoElement> is structurally
            // narrower than the native Event the MuxPlayer branch passes —
            // the same handler accepts either at runtime; cast bridges the
            // type-system difference.
            onError={(event) => handlePlayerError(event as unknown as Event)}
            className={`block h-full w-full origin-top ${chromeRevealed ? "" : "scale-y-110"}`}
          />
        ) : (
          <MuxPlayer
            ref={setPlayerRef}
            playbackId={playbackId}
            src={playbackId ? undefined : hlsSrc}
            autoPlay="muted"
            muted={muted}
            loop={loop}
            envKey={env.NEXT_PUBLIC_MUX_DATA_ENV_KEY}
            disableCookies={true}
            metadata={{
              player_name: "forge-web-watch",
              video_title: video.title ?? undefined,
              video_id: video.documentId,
              viewer_user_id: viewerUserId,
            }}
            style={{
              ...CHROME_HIDE_STYLE,
              ...(chromeRevealed
                ? REVEALED_OBJECT_FIT_STYLE
                : PRE_REVEAL_OBJECT_FIT_STYLE),
            }}
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            onError={handlePlayerError}
            className={`block h-full w-full origin-top ${chromeRevealed ? "" : "scale-y-110"}`}
          />
        )}

        {!chromeRevealed && overlay == null ? (
          <button
            type="button"
            data-testid="hero-player-pre-reveal-click-surface"
            aria-label={
              pillState === "tap-to-unmute"
                ? "Tap to Unmute"
                : "Play with Sound"
            }
            onClick={handleUnmuteClick}
            className="absolute inset-0 z-1 cursor-pointer bg-transparent focus:outline-none"
          />
        ) : null}

        {!videoReady ? (
          <div
            data-testid="hero-player-loading"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black"
          >
            <SpinnerIcon className="h-12 w-12 animate-spin text-white/80" />
          </div>
        ) : null}

        {chromeRevealed ? (
          <HeroPlayerControls
            player={player}
            playerRef={playerRef}
            wrapperRef={wrapperRef}
            overlayAnchor={overlayAnchor}
            onLanguageClick={onLanguageClick}
            // In-chrome globe intentionally stays visible in fullscreen
            // (the top-right one is hidden by isFullscreen).
            showLanguageButton={hasLanguageSwitcher}
            onVisibilityChange={handleControlsVisibilityChange}
          />
        ) : (
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
        )}
        <SubtitleOverlay
          playerRef={playerRef}
          wrapperRef={wrapperRef}
          player={player}
        />
        {darkenOverlay ? (
          <div
            aria-hidden="true"
            data-testid="hero-player-darken-overlay"
            className="pointer-events-none absolute inset-0 bg-black/50"
          />
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
        className="relative z-10 h-0 w-full"
      >
        {!chromeRevealed
          ? (overlay ?? (
              <div
                data-testid="hero-player-overlay"
                className={`absolute right-6 bottom-0 ${WATCH_PAGE_LEFT_RAIL_CLASSES} flex flex-col items-start gap-4 pb-12 md:right-auto`}
              >
                {video.label ? (
                  <span
                    data-testid="hero-player-overlay-label"
                    className={WATCH_SECTION_EYEBROW_CLASS}
                  >
                    {video.label}
                  </span>
                ) : null}
                {video.title ? (
                  <h1
                    data-testid="hero-player-overlay-title"
                    className="max-w-[calc(100vw-5rem)] text-2xl leading-[1.08] font-bold text-balance break-words text-white drop-shadow-lg sm:text-4xl md:max-w-[18ch] md:text-6xl xl:max-w-[20ch] xl:text-7xl"
                  >
                    {video.title}
                  </h1>
                ) : null}
                <button
                  type="button"
                  data-testid="hero-player-unmute-pill"
                  data-state={pillState}
                  aria-label={
                    pillState === "tap-to-unmute"
                      ? "Tap to Unmute"
                      : "Play with Sound"
                  }
                  onClick={handleUnmuteClick}
                  className={
                    pillState === "tap-to-unmute"
                      ? "inline-flex cursor-pointer items-center gap-3 rounded-full bg-amber-500 px-7 py-2.5 text-base font-medium text-stone-950 shadow-lg ring-2 ring-amber-300/60 transition hover:bg-amber-400 md:px-8 md:py-3 md:text-lg"
                      : "inline-flex cursor-pointer items-center gap-3 rounded-full bg-brand-red px-7 py-2.5 text-base font-medium text-white shadow-lg transition hover:bg-brand-red md:px-8 md:py-3 md:text-lg"
                  }
                >
                  {pillState === "tap-to-unmute" ? (
                    <MutedSpeakerIcon />
                  ) : (
                    <UnmutedSpeakerIcon />
                  )}
                  <span>
                    {pillState === "tap-to-unmute"
                      ? "Tap to Unmute"
                      : "Play with Sound"}
                  </span>
                </button>
              </div>
            ))
          : null}
      </div>
    </>
  )
}
