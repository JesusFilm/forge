import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  type Ref,
} from "react"
import {
  AppState,
  FlatList,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
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
import { useRouter } from "expo-router"
import Ionicons from "@expo/vector-icons/Ionicons"

import {
  ACCENT,
  BG_COLOR,
  SURFACE_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import { feedback } from "../../styles/shared"
import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import { prefetchHeroStream, useHeroStream } from "../../hooks/useHeroStream"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { validateActionUrl } from "../../lib/validateUrl"
import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { encodeWatchSeed } from "../../lib/watchSeed"
import {
  muxSlideDisplayCopy,
  type WatchHomeSlide,
  type WatchHomeVideoSlide,
} from "../../lib/watchHome/carouselSequence"
import {
  WATCH_HOME_IMAGE_SLIDE_DWELL_MS,
  WATCH_HOME_MAX_DWELL_MS,
  activeSlide as selectActiveSlide,
  createInitialPagerState,
  pagerReducer,
  showsPagerChrome,
  timersRunning,
} from "../../lib/watchHome/pagerReducer"
import { HomePagerDots } from "./HomePagerDots"

// ── Types ───────────────────────────────────────────────────────────────────

export type HomeHeroPagerHandle = {
  /**
   * Chip-rail jump (CHIP_TAPPED): swaps the hero in place, no navigation.
   * No-op on the current index; dropped while a swap is in flight.
   */
  selectSlide: (index: number) => void
}

export type HomeHeroPagerProps = {
  /**
   * The hero queue (buildWatchHomeHeroQueue output). MUST be referentially
   * stable across renders — a new array identity resets the pager to slide 0.
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
   * Mute is a CONTROLLED prop: the screen owns the state and the invisible
   * overlay touch target (hybrid-overlay pattern, see
   * docs/solutions/mobile/hero-mute-button-hybrid-overlay-touch-target.md).
   * The session rules — unmute persists across advances, tab blur resets to
   * muted — are specified and jest-covered by pagerReducer; the screen's
   * state must implement them.
   */
  muted?: boolean
  onMuteToggle?: () => void
  /** Visual mute button rect (relative to the pager container) for the U7 overlay. */
  onMuteButtonLayout?: (x: number, y: number, w: number, h: number) => void
  /** Fires whenever the active slide settles (swipe, chip, or auto-advance). */
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
  onMuteToggle,
  onMuteButtonLayout,
  onSlideChange,
  ref,
}: HomeHeroPagerProps) {
  const { width: screenWidth } = useWindowDimensions()
  const typography = useTypography()
  const router = useRouter()

  const pageWidth = screenWidth
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

  // Genuine stream failure → skip. Transient "idle" blips are ignored so the
  // videoReady latch (and the mounted VideoView) survive them. Only video
  // slides consume the error: a stale source erroring in the background must
  // not skip an active mux slide (those advance on their own 7s timer).
  useEffect(() => {
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status !== "error") return
      const current = stateRef.current
      if (current.slides[current.currentIndex]?.kind !== "video") return
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

  // Leaving a slide: silence the outgoing stream immediately (the incoming
  // slide reveals via PLAY_STARTED after its own swap) and bump the slide
  // epoch so re-entering a slide re-issues its swap.
  const slideEpochRef = useRef(0)
  const prevActiveIdRef = useRef(activeId)
  useEffect(() => {
    if (prevActiveIdRef.current === activeId) return
    prevActiveIdRef.current = activeId
    slideEpochRef.current += 1
    try {
      player.pause()
    } catch {
      // Native player already released.
    }
  }, [activeId, player])

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
    player
      .replaceAsync(url)
      .then(() => {
        dispatch({ type: "SWAP_FINISHED" })
        // Stale settle: the pager moved on mid-swap — pendingSwap re-issues
        // for the new slide; don't start the old source under its poster.
        if (slideEpochRef.current !== epochAtSwap) return
        if (stateRef.current.suspended !== null) return
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
    player,
  ])

  // Warm the next video slide's stream once the current slide settles.
  useEffect(() => {
    const { slides: queue, currentIndex } = state
    if (queue.length <= 1) return
    for (let step = 1; step < queue.length; step++) {
      const next = queue[(currentIndex + step) % queue.length]
      if (next?.kind === "video") {
        prefetchHeroStream(next.slug)
        break
      }
    }
  }, [state])

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

  useEffect(() => {
    if (state.slides.length === 0) return
    try {
      listRef.current?.scrollToIndex({
        index: state.currentIndex,
        animated: true,
      })
    } catch {
      // List not laid out yet; getItemLayout makes later calls reliable.
    }
  }, [state.currentIndex, state.slides.length])

  const handleMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / pageWidth)
      dispatch({ type: "SLIDE_SHOWN", index })
    },
    [pageWidth],
  )

  const handleScrollToIndexFailed = useCallback(
    (info: { index: number }) => {
      listRef.current?.scrollToOffset({
        offset: info.index * pageWidth,
        animated: true,
      })
    },
    [pageWidth],
  )

  const getItemLayout = useCallback(
    (_data: ArrayLike<WatchHomeSlide> | null | undefined, index: number) => ({
      length: pageWidth,
      offset: index * pageWidth,
      index,
    }),
    [pageWidth],
  )

  const keyExtractor = useCallback((item: WatchHomeSlide) => item.id, [])

  useImperativeHandle(
    ref,
    () => ({
      selectSlide: (index: number) => dispatch({ type: "CHIP_TAPPED", index }),
    }),
    [],
  )

  const onSlideChangeRef = useRef(onSlideChange)
  useEffect(() => {
    onSlideChangeRef.current = onSlideChange
  })
  useEffect(() => {
    const slide = state.slides[state.currentIndex]
    if (slide) onSlideChangeRef.current?.(state.currentIndex, slide)
  }, [state.currentIndex, state.slides])

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleWatchNow = useCallback(
    (slide: WatchHomeVideoSlide) => {
      if (!slide.slug) return
      // Series/watch routing rule shared with Discover (watch.tsx
      // handleSelectResult): series-shaped label → series page, else watch
      // page, with a seed for instant paint. playbackId may be null.
      const seed = encodeWatchSeed({
        slug: slide.slug,
        title: slide.title,
        imageUrl: slide.posterUrl ?? slide.thumbnailUrl,
        playbackId: slide.playbackId,
      })
      const route = isSeriesLabel(slide.label) ? "series" : "watch"
      router.push(`/${route}/${encodeURIComponent(slide.slug)}?seed=${seed}`)
    },
    [router],
  )

  const handleInsertAction = useCallback((url: string) => {
    // External destination — system browser via validated Linking
    // (RelatedQuestionsRenderer pattern).
    if (validateActionUrl(url)) Linking.openURL(url)
  }, [])

  // ── Mute button layout reporting (hybrid-overlay pattern) ─────────────────

  const containerRef = useRef<View>(null)
  const muteButtonRef = useRef<View>(null)

  const handleMuteButtonLayout = useCallback(() => {
    if (onMuteButtonLayout && containerRef.current && muteButtonRef.current) {
      muteButtonRef.current.measureLayout(
        containerRef.current,
        (x, y, w, h) => onMuteButtonLayout(x, y, w, h),
        () => {
          if (__DEV__)
            console.warn("[HomeHeroPager] measureLayout failed for mute button")
        },
      )
    }
  }, [onMuteButtonLayout])

  // ── Render ────────────────────────────────────────────────────────────────

  const renderItem = useCallback(
    ({ item, index }: { item: WatchHomeSlide; index: number }) => (
      <HeroPage
        slide={item}
        isActive={index === state.currentIndex}
        phase={state.phase}
        videoReady={state.videoReady}
        player={player}
        width={pageWidth}
        height={pageHeight}
        typography={typography}
        onWatchNow={handleWatchNow}
        onInsertAction={handleInsertAction}
      />
    ),
    [
      state.currentIndex,
      state.phase,
      state.videoReady,
      player,
      pageWidth,
      pageHeight,
      typography,
      handleWatchNow,
      handleInsertAction,
    ],
  )

  if (state.slides.length === 0) return null

  const chrome = showsPagerChrome(state)
  const showMuteButton = onMuteToggle != null && activeKind === "video"

  return (
    <View ref={containerRef} style={[styles.container, { height: pageHeight }]}>
      <FlatList
        ref={listRef}
        data={state.slides}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={`${state.currentIndex}|${state.phase}|${state.videoReady}`}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScrollToIndexFailed={handleScrollToIndexFailed}
        getItemLayout={getItemLayout}
        initialNumToRender={1}
        windowSize={3}
        scrollEnabled={chrome}
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

      {showMuteButton && (
        // Visual only — the tappable target is U7's invisible overlay
        // Pressable, positioned from onMuteButtonLayout (the FlashList feed
        // above the hero would swallow direct touches).
        <View
          ref={muteButtonRef}
          onLayout={handleMuteButtonLayout}
          style={styles.muteButton}
        >
          <Ionicons
            name={muted ? "volume-mute" : "volume-high"}
            size={20}
            color={TEXT_ON_OVERLAY}
          />
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
  isActive: boolean
  phase: "poster" | "resolving" | "playing"
  videoReady: boolean
  player: VideoPlayer
  width: number
  height: number
  typography: TypographyScale
  onWatchNow: (slide: WatchHomeVideoSlide) => void
  onInsertAction: (url: string) => void
}

function HeroPage({
  slide,
  isActive,
  phase,
  videoReady,
  player,
  width,
  height,
  typography,
  onWatchNow,
  onInsertAction,
}: HeroPageProps) {
  const posterUrl = resolveImageUrl(slide.posterUrl ?? slide.thumbnailUrl)
  const isVideo = slide.kind === "video"

  // The single VideoView mounts only on the ACTIVE page once the player-level
  // videoReady latch is set; the poster stays painted on top until the
  // incoming slide actually plays (handoff rule — no black flash during
  // replaceAsync).
  const showVideo = isActive && isVideo && videoReady
  const posterHidden = showVideo && phase === "playing"

  // Mux overlay copy is time-of-day sensitive — resolve at DISPLAY time
  // (Eastern-hour rule), not at queue-build time.
  const muxCopy =
    slide.kind === "mux" ? muxSlideDisplayCopy(slide, new Date()) : null
  const eyebrow = muxCopy?.label ?? slide.label
  const title = muxCopy?.title ?? slide.title
  const insertAction = muxCopy?.action ?? null

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

      {!posterHidden &&
        (posterUrl != null ? (
          <Image
            source={posterUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            recyclingKey={slide.id}
            accessibilityLabel={slide.imageAlt}
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.posterFallback]} />
        ))}

      <LinearGradient
        colors={[hexToRgba(BG_COLOR, 0), BG_COLOR]}
        locations={[0.4, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={[StyleSheet.absoluteFill, styles.pageContent]}>
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

        {slide.kind === "video" && slide.slug != null && (
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && feedback.pressed,
            ]}
            onPress={() => onWatchNow(slide)}
            accessibilityRole="button"
            accessibilityLabel={`Watch ${slide.title} now`}
          >
            <Text style={[styles.ctaText, typography.body]}>Watch Now</Text>
          </Pressable>
        )}

        {insertAction != null && (
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && feedback.pressed,
            ]}
            onPress={() => onInsertAction(insertAction.url)}
            accessibilityRole="link"
            accessibilityLabel={insertAction.label}
          >
            <Text style={[styles.ctaText, typography.body]}>
              {insertAction.label}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

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
    paddingRight: 76, // clears the fixed mute button at the right edge
    paddingBottom: 44,
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
  ctaButton: {
    marginTop: 16,
    alignSelf: "flex-start",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
    minHeight: 48,
    justifyContent: "center",
  },
  ctaText: {
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
  muteButton: {
    position: "absolute",
    right: 16,
    bottom: 44,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  dotsOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 14,
    alignItems: "center",
  },
})
