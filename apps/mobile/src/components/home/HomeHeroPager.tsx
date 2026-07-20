import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Ref,
} from "react"
import {
  Animated,
  AppState,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { BlurView } from "expo-blur"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"
import { useEvent } from "expo"
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video"

import {
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import { prefetchHeroStream, useHeroStream } from "../../hooks/useHeroStream"
import { datadogLog } from "../../lib/datadog"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { sanitizeVideoErrorMessage } from "../../lib/videoQoe"
import {
  muxSlideDisplayCopy,
  type WatchHomeSlide,
} from "../../lib/watchHome/carouselSequence"
import {
  WATCH_HOME_IMAGE_SLIDE_DWELL_MS,
  WATCH_HOME_MAX_DWELL_MS,
  activeSlide as selectActiveSlide,
  createInitialPagerState,
  heroPageVideoState,
  pagerReducer,
  showsPagerChrome,
  timersRunning,
} from "../../lib/watchHome/pagerReducer"
import { HomePagerDots } from "./HomePagerDots"

// ── Types ───────────────────────────────────────────────────────────────────

export type HomeHeroPagerHandle = {
  /**
   * Chip-rail jump (CHIP_TAPPED): swaps hero in place. No-op on current
   * index; dropped while a swap is in flight.
   */
  selectSlide: (index: number) => void
  /**
   * Swipe-gesture jump (SWIPED): like selectSlide but never dropped during
   * an in-flight swap (the user physically moved the pager).
   */
  swipeToSlide: (index: number) => void
}

// Shared hero-chrome geometry. HomeScreen's overlay chrome uses these same
// numbers, so the pager's reserved text-block padding and the overlay
// buttons can't silently misalign when one side resizes.
/** Bottom offset of the chrome row above the hero's bottom edge. */
export const HERO_CHROME_BOTTOM = 44
/** Overlay CTA pill height (also the mute circle's diameter). */
export const HERO_CTA_HEIGHT = 48
/** Vertical footprint the text block reserves for the CTA (pill + 16 gap). */
export const HERO_CTA_FOOTPRINT = HERO_CTA_HEIGHT + 16

export type HomeHeroPagerProps = {
  /**
   * Hero queue. MUST be referentially stable across renders — a new array
   * identity resets the pager to slide 0.
   */
  slides: readonly WatchHomeSlide[]
  heroHeight?: number
  /**
   * Screen-driven suspension (scroll past the hero threshold / tab blur).
   * Mirrors VideoHeroRenderer's prop surface so U7 reuses the same wiring.
   */
  paused?: boolean
  blurOpacity?: number
  /**
   * CONTROLLED: HomeScreen owns the state and the mute button (the pager
   * hosts no interactive chrome; FlashList above it swallows taps). The pager
   * only syncs this onto player.muted; session rules live in HomeScreen.
   */
  muted?: boolean
  /** Fires whenever the active slide settles (chip, swipe, or auto-advance). */
  onSlideChange?: (index: number, slide: WatchHomeSlide) => void
  ref?: Ref<HomeHeroPagerHandle>
}

// ── Component ───────────────────────────────────────────────────────────────

export function HomeHeroPager({
  slides,
  heroHeight,
  paused,
  blurOpacity = 0,
  muted = true,
  onSlideChange,
  ref,
}: HomeHeroPagerProps) {
  const { width: screenWidth } = useWindowDimensions()
  const typography = useTypography()

  const pageHeight = heroHeight ?? Math.round(screenWidth * 1.2)

  const [state, dispatch] = useReducer(
    pagerReducer,
    slides,
    createInitialPagerState,
  )

  // Latest-state mirror for native-event callbacks registered once per player
  // (ref-mirror discipline — listeners must not re-register per render).
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  })

  // Sync the slides prop into the reducer (identity-guarded; the initial
  // value is already in createInitialPagerState).
  const slidesPropRef = useRef(slides)
  useEffect(() => {
    if (slidesPropRef.current === slides) return
    slidesPropRef.current = slides
    // Reset swap key: after pull-to-refresh a same-slug slide 0 would match
    // the stale key and skip its re-issued swap without this reset.
    lastSwapKeyRef.current = null
    dispatch({ type: "SLIDES_SET", slides })
  }, [slides])

  const active = selectActiveSlide(state)
  const activeId = active?.id ?? null
  const activeKind = active?.kind ?? null
  const activeVideoSlug = active?.kind === "video" ? active.slug : null

  // ── Player (one instance, FROZEN null source; swaps via replaceAsync) ────

  const player = useVideoPlayer(null, (p) => {
    p.muted = true
    // Advance is driven by the playToEnd listener, never the native loop
    // (expo-video-backdrop-seamless-loop doc).
    p.loop = false
  })

  useEffect(() => {
    return () => {
      try {
        player.pause()
      } catch {
        // Native player already released.
      }
    }
  }, [player])

  useEffect(() => {
    player.muted = muted
  }, [muted, player])

  // First frame / resume signal → reveal the video over the poster.
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  })
  useEffect(() => {
    if (isPlaying) dispatch({ type: "PLAY_STARTED" })
  }, [isPlaying])

  // Genuine stream failure → skip; transient "idle" blips are ignored so the
  // videoReady latch survives. Only video slides consume the error — a stale
  // background source must not skip an active mux slide (those run a 7s timer).
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status, error }) => {
      if (status !== "error") return
      const current = stateRef.current
      const message =
        error?.message != null
          ? sanitizeVideoErrorMessage(error.message)
          : "video playback error"
      // Mid-hold the player still carries the OUTGOING stream; its error must
      // not skip the incoming slide (whose own swap surfaces its own errors)
      // — but it must stay observable (R37: silent QoE losses are findings).
      if (current.transitionFromId != null) {
        const held = current.slides.find(
          (s) => s.id === current.transitionFromId,
        )
        datadogLog.warn("video.playback_error", {
          surface: "hero",
          phase: "transition_hold",
          content_id:
            held?.kind === "video" ? (held.slug ?? held.id) : held?.id,
          message,
        })
        return
      }
      const slide = current.slides[current.currentIndex]
      if (slide?.kind !== "video") return
      // R37: the hero is a distinct player the managed-player QoE excludes.
      datadogLog.warn("video.playback_error", {
        surface: "hero",
        content_id: slide.slug,
        message,
      })
      dispatch({ type: "STREAM_ERROR" })
    })
    return () => sub.remove()
  }, [player])

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      const current = stateRef.current
      if (current.slides.length <= 1) {
        // Single-slide queue: no auto-advance (AE2) — loop the lone video
        // manually instead of leaving a frozen last frame.
        if (current.suspended === null) {
          try {
            player.replay()
          } catch {
            // Native player already released.
          }
        }
        return
      }
      dispatch({ type: "PLAY_TO_END" })
    })
    return () => sub.remove()
  }, [player])

  // Leaving a slide: silence the outgoing stream (the incoming slide reveals
  // via PLAY_STARTED after its own swap) and bump the slide epoch so
  // re-entering a slide re-issues its swap. A transition hold defers the
  // pause — the outgoing video keeps playing through the slide animation.
  const slideEpochRef = useRef(0)
  const prevActiveIdRef = useRef(activeId)
  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return
    prevActiveIdRef.current = activeId
    slideEpochRef.current += 1
    if (stateRef.current.transitionFromId != null) return
    try {
      player.pause()
    } catch {
      // Native player already released.
    }
  }, [activeId, player])

  // The hold's release (settle/suspend/queue swap) is where the deferred
  // pause lands — and what re-arms the playingChange edge the incoming
  // slide's PLAY_STARTED reveal depends on.
  const prevTransitionIdRef = useRef(state.transitionFromId)
  useEffect(() => {
    const prev = prevTransitionIdRef.current
    prevTransitionIdRef.current = state.transitionFromId
    if (prev == null || state.transitionFromId != null) return
    try {
      player.pause()
    } catch {
      // Native player already released.
    }
  }, [state.transitionFromId, player])

  // ── Stream resolution → serialized replaceAsync swaps ────────────────────

  const stream = useHeroStream(activeVideoSlug)
  const streamSlugRef = useRef<string | null>(null)
  const failedSlugRef = useRef<string | null>(null)
  const lastSwapKeyRef = useRef<string | null>(null)

  useEffect(() => {
    // useHeroStream's state lags one render behind a slug change (its reset
    // effect runs in this same commit); skip the stale pass.
    const slugChanged = streamSlugRef.current !== activeVideoSlug
    if (slugChanged) streamSlugRef.current = activeVideoSlug

    if (activeKind !== "video" || activeVideoSlug == null) return
    if (slugChanged) return

    if (stream.resolving) {
      if (failedSlugRef.current === activeVideoSlug)
        failedSlugRef.current = null
      dispatch({ type: "STREAM_RESOLVING" })
      return
    }
    if (stream.failed) {
      // Consume each failure once; the reducer advances past the slide.
      if (failedSlugRef.current !== activeVideoSlug) {
        failedSlugRef.current = activeVideoSlug
        dispatch({ type: "STREAM_ERROR" })
      }
      return
    }
    const url = stream.streamUrl
    if (url == null) return
    if (state.swapInFlight) return
    // Transition hold: the player is still presenting the outgoing slide —
    // a swap now would flash the new source there mid-animation. The settle
    // clears the hold and re-runs this effect.
    if (state.transitionFromId != null) return
    if (state.suspended !== null) {
      // Remember the ready stream; RESUME re-issues the swap (AE6).
      dispatch({ type: "STREAM_READY" })
      return
    }

    // One swap per slide visit: the epoch key stops the finished-swap effect
    // re-run from swapping the same source forever, while a pendingSwap
    // (interrupted swap) always re-issues.
    const swapKey = `${slideEpochRef.current}:${activeId}:${url}`
    if (lastSwapKeyRef.current === swapKey && !state.pendingSwap) return
    lastSwapKeyRef.current = swapKey

    dispatch({ type: "SWAP_STARTED" })
    const epochAtSwap = slideEpochRef.current
    // Capture suspended synchronously: stateRef can be one commit behind the
    // epoch guard by the time the replaceAsync .then() fires.
    const suspendedAtSwap = stateRef.current.suspended
    player
      .replaceAsync(url)
      .then(() => {
        dispatch({ type: "SWAP_FINISHED" })
        // Stale settle: the pager moved on mid-swap — pendingSwap re-issues
        // for the new slide; don't start the old source under its poster.
        if (slideEpochRef.current !== epochAtSwap) return
        if (suspendedAtSwap !== null) return
        try {
          player.play()
        } catch {
          // Native player already released.
        }
      })
      .catch(() => {
        if (slideEpochRef.current !== epochAtSwap) {
          // The failed swap belonged to a slide we already left; clearing
          // the in-flight flag lets the pending swap re-issue (no skip).
          dispatch({ type: "SWAP_FINISHED" })
          return
        }
        dispatch({ type: "STREAM_ERROR" })
      })
  }, [
    activeId,
    activeKind,
    activeVideoSlug,
    stream,
    state.swapInFlight,
    state.suspended,
    state.pendingSwap,
    state.transitionFromId,
    player,
  ])

  // Warm the next video slide's stream once the current slide settles.
  useEffect(() => {
    const queue = state.slides
    if (queue.length <= 1) return
    for (let step = 1; step < queue.length; step++) {
      const next = queue[(state.currentIndex + step) % queue.length]
      if (next?.kind === "video") {
        prefetchHeroStream(next.slug)
        break
      }
    }
  }, [state.currentIndex, state.slides])

  // ── Timers (armed only while timersRunning — AE6 stops them) ─────────────

  const timersOn = timersRunning(state)

  useEffect(() => {
    if (!timersOn || activeKind !== "mux") return
    const timer = setTimeout(
      () => dispatch({ type: "IMAGE_TIMER_ELAPSED" }),
      WATCH_HOME_IMAGE_SLIDE_DWELL_MS,
    )
    return () => clearTimeout(timer)
  }, [timersOn, activeId, activeKind])

  useEffect(() => {
    if (!timersOn || activeKind !== "video" || state.phase === "playing") return
    const timer = setTimeout(
      () => dispatch({ type: "MAX_DWELL_ELAPSED" }),
      WATCH_HOME_MAX_DWELL_MS,
    )
    return () => clearTimeout(timer)
  }, [timersOn, activeId, activeKind, state.phase])

  // ── Suspension (paused prop + AppState, mirroring VideoHeroRenderer) ─────

  const appActiveRef = useRef(true)
  const pausedRef = useRef(paused === true)

  useEffect(() => {
    pausedRef.current = paused === true
    if (paused) {
      dispatch({ type: "SUSPEND", reason: "scroll" })
    } else if (appActiveRef.current) {
      dispatch({ type: "RESUME" })
    }
  }, [paused])

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      appActiveRef.current = nextState === "active"
      if (!appActiveRef.current) {
        dispatch({ type: "SUSPEND", reason: "blur" })
      } else if (!pausedRef.current) {
        dispatch({ type: "RESUME" })
      }
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    try {
      if (state.suspended !== null) {
        player.pause()
      } else if (state.phase === "playing" && activeKind === "video") {
        player.play()
      }
    } catch {
      // Native player already released.
    }
  }, [state.suspended, state.phase, activeKind, player])

  // ── Pager scroll wiring ───────────────────────────────────────────────────

  const listRef = useRef<FlatList<WatchHomeSlide>>(null)
  // The index the latest programmatic scrollToIndex is heading for; settles
  // on a different index are stale (an older animation finishing) and must
  // not move the reducer.
  const pendingScrollIndexRef = useRef(0)

  useEffect(() => {
    if (state.slides.length === 0) return
    pendingScrollIndexRef.current = state.currentIndex
    try {
      listRef.current?.scrollToIndex({
        index: state.currentIndex,
        animated: true,
      })
    } catch {
      // List not laid out yet; getItemLayout makes later calls reliable.
    }
  }, [state.currentIndex, state.slides.length])

  // List is scrollEnabled={false} — slide changes are programmatic only (all
  // route through the handle/reducer). Animated scrollToIndex still fires
  // momentum end; SLIDE_SHOWN on the settled index no-ops if it matches.
  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth)
      // Stale settle (an older animation overtaken by a newer target) must
      // not move the reducer; legit off-page re-syncs go through
      // onScrollToIndexFailed instead.
      if (index !== pendingScrollIndexRef.current) return
      dispatch({ type: "SLIDE_SHOWN", index })
    },
    [screenWidth],
  )

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.index * screenWidth,
        animated: true,
      })
    },
    [screenWidth],
  )

  const getItemLayout = useCallback(
    (_data: ArrayLike<WatchHomeSlide> | null | undefined, index: number) => ({
      length: screenWidth,
      offset: index * screenWidth,
      index,
    }),
    [screenWidth],
  )

  const keyExtractor = useCallback((item: WatchHomeSlide) => item.id, [])

  useImperativeHandle(
    ref,
    () => ({
      selectSlide: (index: number) => dispatch({ type: "CHIP_TAPPED", index }),
      swipeToSlide: (index: number) => dispatch({ type: "SWIPED", index }),
    }),
    [],
  )

  const onSlideChangeRef = useRef(onSlideChange)
  useEffect(() => {
    onSlideChangeRef.current = onSlideChange
  })
  // Notify only on a REAL index change — a slides-identity change landing on
  // the same index (e.g., SLIDES_SET resetting to 0) must not re-fire.
  const notifiedIndexRef = useRef<number | null>(null)
  useEffect(() => {
    if (notifiedIndexRef.current === state.currentIndex) return
    const slide = state.slides[state.currentIndex]
    if (!slide) return
    notifiedIndexRef.current = state.currentIndex
    onSlideChangeRef.current?.(state.currentIndex, slide)
  }, [state.currentIndex, state.slides])

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item, index }: { item: WatchHomeSlide; index: number }) => {
      const { showVideo, posterHidden } = heroPageVideoState(state, item, index)
      return (
        <HeroPage
          slide={item}
          showVideo={showVideo}
          posterHidden={posterHidden}
          player={player}
          width={screenWidth}
          height={pageHeight}
          typography={typography}
        />
      )
    },
    [
      state.currentIndex,
      state.phase,
      state.videoReady,
      state.transitionFromId,
      player,
      screenWidth,
      pageHeight,
      typography,
    ],
  )

  if (state.slides.length === 0) return null

  const chrome = showsPagerChrome(state)

  return (
    <View style={[styles.container, { height: pageHeight }]}>
      <FlatList
        ref={listRef}
        data={state.slides}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={`${state.currentIndex}|${state.phase}|${state.videoReady}|${state.transitionFromId ?? ""}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        getItemLayout={getItemLayout}
        initialNumToRender={1}
        windowSize={3}
        // Never user-scrollable: the vertical FlashList above the hero claims
        // direct drags anyway. Hero swipes are claimed by HomeScreen's
        // capture-phase PanResponder and arrive via swipeToSlide.
        scrollEnabled={false}
      />

      {blurOpacity > 0 && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: blurOpacity }]}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {Platform.OS === "ios" ? (
            <BlurView
              intensity={50}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.androidDim]} />
          )}
        </View>
      )}

      {chrome && (
        <View style={styles.dotsOverlay} pointerEvents="none">
          <HomePagerDots
            count={state.slides.length}
            activeIndex={state.currentIndex}
          />
        </View>
      )}
    </View>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

type HeroPageProps = {
  slide: WatchHomeSlide
  /**
   * This page hosts the single VideoView (active page, or the departing page
   * while a transition hold runs). Poster stays painted on top until
   * posterHidden — the handoff rule: no black flash during replaceAsync.
   */
  showVideo: boolean
  posterHidden: boolean
  player: VideoPlayer
  width: number
  height: number
  typography: TypographyScale
}

/** Poster→video crossfade length once the incoming slide starts playing. */
const POSTER_CROSSFADE_MS = 350

const HeroPage = memo(function HeroPage({
  slide,
  showVideo,
  posterHidden,
  player,
  width,
  height,
  typography,
}: HeroPageProps) {
  const posterUrl = resolveImageUrl(slide.posterUrl ?? slide.thumbnailUrl)

  // Crossfade instead of a hard cut: fade the poster out over the playing
  // video, then unmount it. Re-arming (slide change / phase reset) restores
  // full opacity BEFORE the poster remounts, so it never flashes transparent.
  const posterOpacity = useRef(new Animated.Value(1)).current
  const [posterMounted, setPosterMounted] = useState(true)
  useEffect(() => {
    if (posterHidden) {
      const fade = Animated.timing(posterOpacity, {
        toValue: 0,
        duration: POSTER_CROSSFADE_MS,
        useNativeDriver: true,
      })
      fade.start(({ finished }) => {
        if (finished) setPosterMounted(false)
      })
      return () => fade.stop()
    }
    posterOpacity.setValue(1)
    setPosterMounted(true)
  }, [posterHidden, posterOpacity])

  // Mux overlay copy is time-of-day sensitive — resolve at DISPLAY time
  // (Eastern-hour rule), not at queue-build time. Memoized per slide entry
  // (the intended display-time semantics; per-render recompute is wasteful).
  const muxCopy = useMemo(
    () =>
      slide.kind === "mux" ? muxSlideDisplayCopy(slide, new Date()) : null,
    [slide],
  )
  const eyebrow = muxCopy?.label ?? slide.label
  const title = muxCopy?.title ?? slide.title
  const insertAction = muxCopy?.action ?? null

  // Pages host DISPLAY content only — interactive chrome lives in HomeScreen's
  // zIndex-2 overlay, since the FlashList over the hero swallows taps here. The
  // text block reserves the overlay CTA's footprint to match the old layout.
  const reservesCtaSpace =
    (slide.kind === "video" && slide.slug != null) || insertAction != null

  return (
    // Plain tap on a slide does nothing (mux slides advance via CTA only) —
    // the page intentionally has no Pressable wrapper.
    <View style={{ width, height }}>
      {showVideo && (
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls={false}
          contentFit="cover"
        />
      )}

      {posterMounted && (
        <Animated.View
          style={[StyleSheet.absoluteFill, { opacity: posterOpacity }]}
        >
          {posterUrl != null ? (
            <Image
              source={posterUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={slide.id}
              accessibilityLabel={slide.imageAlt}
              // R18: a silently-dropped hero poster is a content-quality loss.
              onError={() =>
                datadogLog.warn("image.load_failed", { surface: "hero" })
              }
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.posterFallback]} />
          )}
        </Animated.View>
      )}

      <LinearGradient
        colors={[hexToRgba(BG_COLOR, 0), BG_COLOR]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View
        style={[
          StyleSheet.absoluteFill,
          styles.pageContent,
          reservesCtaSpace && styles.pageContentWithCta,
        ]}
      >
        {slide.kind === "mux" && slide.logo && (
          <Text style={[styles.wordmark, typography.caption]}>
            JESUS FILM PROJECT
          </Text>
        )}
        <Text style={[styles.eyebrow, typography.caption]}>
          {eyebrow.toUpperCase()}
        </Text>
        <Text
          style={[styles.title, typography.headingScale.h2]}
          accessibilityRole="header"
          numberOfLines={3}
        >
          {title}
        </Text>
        {muxCopy?.description != null && (
          <Text
            style={[styles.description, typography.bodySmall]}
            numberOfLines={2}
          >
            {muxCopy.description}
          </Text>
        )}
      </View>
    </View>
  )
})

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: "100%",
  },
  androidDim: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
  },
  posterFallback: {
    backgroundColor: SURFACE_COLOR,
  },
  pageContent: {
    justifyContent: "flex-end",
    paddingLeft: 16,
    // Clears HomeScreen's overlay mute circle at the right edge (48 + 16 + margin).
    paddingRight: 76,
    paddingBottom: HERO_CHROME_BOTTOM,
  },
  pageContentWithCta: {
    // Reserve the overlay CTA's footprint (pill + gap above it) so the title
    // block sits exactly where it did when the Pressable was in-page.
    paddingBottom: HERO_CHROME_BOTTOM + HERO_CTA_FOOTPRINT,
  },
  wordmark: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "800",
    letterSpacing: 3,
    marginBottom: 8,
  },
  eyebrow: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontWeight: "600",
    letterSpacing: 2,
    marginBottom: 6,
  },
  title: {
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
    fontWeight: "700",
  },
  description: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginTop: 6,
  },
  dotsOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: "center",
  },
})
