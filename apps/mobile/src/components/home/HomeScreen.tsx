/**
 * The Home tab: curated watch-home content composed in the three-layer
 * architecture (CuratedHomeLayout is the structural reference; data comes
 * from the ported curation config via useWatchHome, not an Experience).
 *
 * Layer ordering (z-index): heroLayer (0) → FlashList feed (scrolls over the
 * hero) → heroInteractiveLayer (2, box-none, invisible mute target) →
 * HomeHeader (10, owns its own absolute positioning).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { LinearGradient } from "expo-linear-gradient"
import { useNavigation } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useWatchHome } from "../../hooks/useWatchHome"
import {
  ACCENT,
  BG_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import {
  buildWatchHomeHeroQueue,
  type WatchHomeSlide,
} from "../../lib/watchHome/carouselSequence"
import type { WatchHomeSection } from "../../lib/watchHome/model"
import { feedback, layout, text } from "../../styles/shared"
import { HomeHeader } from "../ui/HomeHeader"
import { HomeChipRail } from "./HomeChipRail"
import { HomeHeroPager, type HomeHeroPagerHandle } from "./HomeHeroPager"
import { HomeMissionSection } from "./HomeMissionSection"
import { HomeShelf } from "./HomeShelf"

// ── Types ───────────────────────────────────────────────────────────────────

type HomeFeedItem =
  | { kind: "chips" }
  | { kind: "section"; section: WatchHomeSection }
  | { kind: "mission" }

type MuteButtonRect = { x: number; y: number; w: number; h: number }

// Stable empty queue so the no-model render keeps one slides identity (a new
// array identity resets the pager to slide 0 by design).
const EMPTY_SLIDES: readonly WatchHomeSlide[] = []

/**
 * HomeHeader's visual height below the safe-area inset (4 top offset + 40
 * button + 8 bottom padding). The hero-less degraded feed pads down by
 * inset + this so the first shelf clears the absolute header.
 */
const HEADER_ALLOWANCE = 52

// ── Component ───────────────────────────────────────────────────────────────

export function HomeScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const { width: screenWidth } = useWindowDimensions()
  // Matches HomeHeroPager's default; computed here because the hero layer,
  // feed padding, and scroll brackets all share it.
  const heroHeight = Math.round(screenWidth * 1.2)

  const { model, loading, refreshing, error, refetch } = useWatchHome()

  // ── Hero queue (referentially stable per model identity) ──────────────────

  // In-memory played set (web's localStorage persistence does not port —
  // KTD-3). A ref, not state: it only feeds queue REBUILDS (new model
  // identity); the live pager tracks its own progress internally.
  // Intentionally duplicates the reducer's playedIds: the reducer's set signals
  // wrap for the pager; this ref feeds queue rebuilds across model refreshes
  // and resets on wrap.
  const playedIdsRef = useRef<Set<string>>(new Set())
  // Stable per-mount seed keeps each insert's mux playback selection stable
  // for the session (carouselSequence's sessionSeed contract).
  const sessionSeedRef = useRef(
    `home-${Math.random().toString(36).slice(2, 10)}`,
  )

  const heroSlides = useMemo<readonly WatchHomeSlide[]>(() => {
    if (model == null) return EMPTY_SLIDES
    const queue = buildWatchHomeHeroQueue({
      pools: model.carousel.pools,
      inserts: model.carousel.muxInserts,
      playedIds: playedIdsRef.current,
      sessionSeed: sessionSeedRef.current,
    })
    if (queue.wrapped) {
      // Helper contract: wrapped=true means every eligible slide was already
      // in the played set and the returned queue was rebuilt ignoring it.
      // Reset the set so the next rebuild starts a fresh played cycle instead
      // of wrapping forever.
      playedIdsRef.current = new Set()
    }
    return queue.slides
  }, [model])

  const heroVisible = heroSlides.length > 0

  // ── Pager wiring ───────────────────────────────────────────────────────────

  const pagerRef = useRef<HomeHeroPagerHandle>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const prevSlideIdRef = useRef<string | null>(null)

  const handleSlideChange = useCallback(
    (index: number, slide: WatchHomeSlide) => {
      setActiveIndex(index)
      // Mark the slide we LEFT as played so queue rebuilds (pull-to-refresh
      // producing a new model) lead with unseen content. Mux insert ids never
      // appear in the pools, so collecting them here is harmless.
      const prev = prevSlideIdRef.current
      if (prev != null && prev !== slide.id) playedIdsRef.current.add(prev)
      prevSlideIdRef.current = slide.id
    },
    [],
  )

  const handleChipPress = useCallback((index: number) => {
    pagerRef.current?.selectSlide(index)
  }, [])

  // ── Mute session rules (screen-owned; the pager is controlled) ─────────────

  const [muted, setMuted] = useState(true)
  const handleMuteToggle = useCallback(() => setMuted((m) => !m), [])

  const [focused, setFocused] = useState(true)
  useEffect(() => {
    // Mirror CuratedHomeLayout's session-mute rule: leaving the tab resets to
    // muted; an unmute persists across slide advances while the tab stays
    // focused. The focus flag also suspends the pager on tab blur (AE6) —
    // AppState backgrounding is handled inside HomeHeroPager.
    const unsubscribeBlur = navigation.addListener("blur", () => {
      setMuted(true)
      setFocused(false)
    })
    const unsubscribeFocus = navigation.addListener("focus", () => {
      setFocused(true)
    })
    return () => {
      unsubscribeBlur()
      unsubscribeFocus()
    }
  }, [navigation])

  const [muteButtonRect, setMuteButtonRect] = useState<MuteButtonRect | null>(
    null,
  )
  const handleMuteButtonLayout = useCallback(
    (x: number, y: number, w: number, h: number) => {
      setMuteButtonRect({ x, y, w, h })
    },
    [],
  )

  // The pager shows its visual mute button only on video slides; keep the
  // invisible overlay target in lockstep so mux slides aren't silently
  // tappable through a stale rect.
  const activeSlideIsVideo = heroSlides[activeIndex]?.kind === "video"

  // ── Scroll brackets (plain JS onScroll — CuratedHomeLayout pattern) ────────

  const [heroPaused, setHeroPaused] = useState(false)
  const [heroBlurOpacity, setHeroBlurOpacity] = useState(0)

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      // Boolean state bails out of identical updates on its own.
      setHeroPaused(scrollY > heroHeight * 0.7)
      // Quantize the blur ramp to 1/20 steps so repeated identical values
      // bail out instead of re-rendering at 60fps.
      const blur = Math.min(1, Math.max(0, scrollY / (heroHeight * 0.5)))
      setHeroBlurOpacity(Math.round(blur * 20) / 20)
    },
    [heroHeight],
  )

  // ── Feed composition ───────────────────────────────────────────────────────

  const feedItems = useMemo<HomeFeedItem[]>(() => {
    if (model == null) return []
    const items: HomeFeedItem[] = []
    // Chip rail mirrors the pager-chrome rule: multi-slide queues only (AE2).
    if (heroSlides.length > 1) items.push({ kind: "chips" })
    for (const section of model.sections) {
      items.push({ kind: "section", section })
    }
    items.push({ kind: "mission" })
    return items
  }, [model, heroSlides.length])

  const keyExtractor = useCallback(
    (item: HomeFeedItem) =>
      item.kind === "section" ? `section-${item.section.id}` : item.kind,
    [],
  )

  const renderItem = useCallback(
    ({ item, index }: { item: HomeFeedItem; index: number }) => {
      const content =
        item.kind === "chips" ? (
          <View style={styles.chipRailSpacing}>
            <HomeChipRail
              slides={heroSlides}
              activeIndex={activeIndex}
              onChipPress={handleChipPress}
            />
          </View>
        ) : item.kind === "section" ? (
          <HomeShelf section={item.section} />
        ) : (
          <HomeMissionSection />
        )

      return (
        // Translucent per-item background (feedItemBackground convention) —
        // the mission section carries its own. Never on contentContainerStyle:
        // an opaque content container fills the padding region and hides the
        // absolute hero behind it.
        <View
          style={item.kind === "mission" ? null : styles.feedItemBackground}
        >
          {index === 0 && heroVisible && (
            <LinearGradient
              colors={[hexToRgba(BG_COLOR, 0), hexToRgba(BG_COLOR, 0.9)]}
              style={styles.feedFeather}
            />
          )}
          {content}
        </View>
      )
    },
    [heroSlides, activeIndex, handleChipPress, heroVisible],
  )

  const contentContainerStyle = useMemo(
    () => ({
      // Hero-less degraded render: feed starts below the absolute header
      // instead of leaving a hero-sized hole.
      paddingTop: heroVisible ? heroHeight : insets.top + HEADER_ALLOWANCE,
      paddingBottom: 48,
    }),
    [heroVisible, heroHeight, insets.top],
  )

  // ── States (R12: never a blank screen) ─────────────────────────────────────

  if ((loading || refreshing) && model == null) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    )
  }

  if (error != null && model == null) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top }]}>
        <Text style={text.errorTitle}>Something went wrong</Text>
        <Text style={[text.errorMessage, styles.errorMessageSpacing]}>
          {error}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.retryButton,
            pressed && feedback.pressed,
          ]}
          onPress={refetch}
          accessibilityRole="button"
          accessibilityLabel="Retry loading"
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  // Full-empty: nothing resolved at all. A hero-less-but-shelves model (or
  // shelves-less-but-hero) is a valid degraded render and falls through.
  if (model == null || (model.sections.length === 0 && !heroVisible)) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>No content available</Text>
      </View>
    )
  }

  return (
    <View style={layout.screenContainer}>
      {heroVisible && (
        <View style={[styles.heroLayer, { height: heroHeight }]}>
          <HomeHeroPager
            ref={pagerRef}
            slides={heroSlides}
            heroHeight={heroHeight}
            paused={heroPaused || !focused}
            blurOpacity={heroBlurOpacity}
            muted={muted}
            onMuteToggle={handleMuteToggle}
            onMuteButtonLayout={handleMuteButtonLayout}
            onSlideChange={handleSlideChange}
          />
        </View>
      )}

      <HomeHeader title={null} titleOpacity={0} showWordmark />

      <FlashList
        data={feedItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={activeIndex}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={contentContainerStyle}
        showsVerticalScrollIndicator={false}
        maintainVisibleContentPosition={{ disabled: true }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refetch}
            tintColor={TEXT_SECONDARY}
          />
        }
      />

      {heroVisible && (
        <View
          style={[styles.heroInteractiveLayer, { height: heroHeight }]}
          pointerEvents="box-none"
        >
          {muteButtonRect != null && activeSlideIsVideo && (
            // Invisible touch target for the pager's visual mute button
            // (hybrid-overlay pattern — FlashList swallows touches in its
            // padding region, so the hero layer can't take them directly).
            <Pressable
              style={{
                position: "absolute",
                left: muteButtonRect.x,
                top: muteButtonRect.y,
                width: muteButtonRect.w,
                height: muteButtonRect.h,
              }}
              onPress={handleMuteToggle}
              accessibilityLabel={muted ? "Unmute video" : "Mute video"}
              accessibilityRole="button"
            />
          )}
        </View>
      )}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  heroLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  heroInteractiveLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  feedItemBackground: {
    backgroundColor: hexToRgba(BG_COLOR, 0.9),
  },
  feedFeather: {
    height: 48,
    marginTop: -48,
  },
  chipRailSpacing: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  loadingText: {
    color: TEXT_SECONDARY,
    fontSize: 17,
    fontFamily: "System",
    marginTop: 12,
  },
  errorMessageSpacing: {
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  retryText: {
    color: TEXT_ON_OVERLAY,
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "System",
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontSize: 17,
    fontFamily: "System",
  },
})
