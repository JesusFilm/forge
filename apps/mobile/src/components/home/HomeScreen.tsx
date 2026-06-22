/**
 * Curated Home tab (config via useWatchHome, not an Experience). Z-order:
 * heroLayer(0) → FlashList → heroInteractiveLayer(2, box-none chrome) →
 * HomeHeader(10). Chrome lives in the overlay since the FlashList swallows
 * taps aimed at the hero; hero swipes ride a capture-phase root PanResponder.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { LinearGradient } from "expo-linear-gradient"
import { useNavigation, useRouter } from "expo-router"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useTypography } from "../../hooks/useTypography"
import { useWatchHome } from "../../hooks/useWatchHome"
import { useWatchHomeCarouselMemory } from "../../hooks/useWatchHomeCarouselMemory"
import {
  ACCENT,
  BG_COLOR,
  TEXT_ON_OVERLAY,
  TEXT_SECONDARY,
  hexToRgba,
} from "../../lib/color"
import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { openExternalUrl } from "../../lib/openExternalUrl"
import {
  buildWatchHomeHeroQueue,
  muxSlideDisplayCopy,
  type WatchHomeSlide,
} from "../../lib/watchHome/carouselSequence"
import type { WatchHomeSection } from "../../lib/watchHome/model"
import { slideRouteArgs } from "../../lib/watchHome/slideRouteArgs"
import { encodeWatchSeed } from "../../lib/watchSeed"
import { feedback, layout, text } from "../../styles/shared"
import { HomeHeader } from "../ui/HomeHeader"
import { HomeHeroSelectorRail } from "./HomeHeroSelectorRail"
import {
  HERO_CHROME_BOTTOM,
  HERO_CTA_HEIGHT,
  HomeHeroPager,
  type HomeHeroPagerHandle,
} from "./HomeHeroPager"
import { HomeMissionSection } from "./HomeMissionSection"
import { HomeShelf } from "./HomeShelf"

// ── Types ───────────────────────────────────────────────────────────────────

type HomeFeedItem =
  | { kind: "selector" }
  | { kind: "section"; section: WatchHomeSection }
  | { kind: "mission" }

// Stable empty queue so the no-model render keeps one slides identity (a new
// array identity resets the pager to slide 0 by design).
const EMPTY_SLIDES: readonly WatchHomeSlide[] = []

/**
 * HomeHeader's visual height below the safe-area inset (4+40+8). The hero-less
 * degraded feed pads by inset + this so the first shelf clears the header.
 */
const HEADER_ALLOWANCE = 52

/** Hero swipe: |dx| must beat |dy| by this ratio before the capture claims. */
const HERO_SWIPE_DOMINANCE = 1.5
/** Hero swipe: minimum |dx| before the capture-phase responder claims. */
const HERO_SWIPE_ACTIVATE_PX = 12
/** Hero swipe: |dx| at release that commits a slide change. */
const HERO_SWIPE_COMMIT_PX = 40

// ── Component ───────────────────────────────────────────────────────────────

export function HomeScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const router = useRouter()
  const { width: screenWidth } = useWindowDimensions()
  // Matches HomeHeroPager's default; computed here because the hero layer,
  // feed padding, and scroll brackets all share it.
  const heroHeight = Math.round(screenWidth * 1.2)

  const { model, loading, refreshing, error, refetch } = useWatchHome()

  // ── Hero queue (referentially stable per model identity) ──────────────────

  // AsyncStorage carousel memory (web parity). playedIdsRef is a ref so it only
  // feeds queue REBUILDS, not the live pager; it intentionally duplicates the
  // reducer's playedIds (reducer signals wrap; ref feeds rebuilds, resets on wrap).
  const {
    playedIdsRef,
    startPoolIndexRef,
    hydrated: memoryHydrated,
    markVideoPlayed,
    resetPlayedIds,
    persistActiveSlide,
  } = useWatchHomeCarouselMemory()
  // Stable per-mount seed keeps each insert's mux playback selection stable
  // for the session (carouselSequence's sessionSeed contract).
  const sessionSeedRef = useRef(
    `home-${Math.random().toString(36).slice(2, 10)}`,
  )

  // memoryHydrated is a rebuild trigger, not data: hydration usually resolves
  // before the model fetch (first build sees persisted exclusions); if it loses
  // that race the queue rebuilds once, leading with unseen content.
  const heroSlides = useMemo<readonly WatchHomeSlide[]>(() => {
    if (model == null) return EMPTY_SLIDES
    const queue = buildWatchHomeHeroQueue({
      pools: model.carousel.pools,
      inserts: model.carousel.muxInserts,
      playedIds: playedIdsRef.current,
      startPoolIndex: startPoolIndexRef.current,
      sessionSeed: sessionSeedRef.current,
    })
    if (queue.wrapped && queue.videos.length > 0) {
      // wrapped=true means every eligible slide was already played and the queue
      // was rebuilt ignoring the set; reset it so the next rebuild starts fresh.
      // videos.length guard stops a content outage (no eligible videos) from wiping persisted memory.
      resetPlayedIds()
    }
    return queue.slides
    // playedIdsRef/startPoolIndexRef are stable refs read at build time, not
    // rebuild triggers; memoryHydrated is the rebuild trigger for them.
  }, [model, memoryHydrated, resetPlayedIds])

  const heroVisible = heroSlides.length > 0

  // ── Pager wiring ───────────────────────────────────────────────────────────

  const pagerRef = useRef<HomeHeroPagerHandle>(null)
  const [activeHero, setActiveHero] = useState<{
    index: number
    slide: WatchHomeSlide
  } | null>(null)
  const prevSlideRef = useRef<{
    id: string
    kind: WatchHomeSlide["kind"]
  } | null>(null)

  // A rebuild resets the pager to slide 0 without re-firing onSlideChange (its
  // index-unchanged guard), so the stored slide can go stale. Drop it so the
  // chrome renders from heroSlides[0] instead of an evicted slide.
  useEffect(() => {
    setActiveHero(null)
  }, [heroSlides])

  // Event-time mirrors for the once-created PanResponder (reading state
  // directly there would capture stale closures).
  const swipeStateRef = useRef({
    scrollY: 0,
    activeIndex: 0,
    slideCount: 0,
    heroHeight,
  })
  useEffect(() => {
    swipeStateRef.current.slideCount = heroSlides.length
    swipeStateRef.current.heroHeight = heroHeight
  }, [heroSlides.length, heroHeight])

  const handleSlideChange = useCallback(
    (index: number, slide: WatchHomeSlide) => {
      setActiveHero({ index, slide })
      swipeStateRef.current.activeIndex = index
      // Mark the VIDEO slide we LEFT as played (persisted, monthly reset) so
      // rebuilds (refresh + next launch) lead with unseen content. Mux insert
      // ids never appear in the pools, so they are skipped rather than stored.
      const prev = prevSlideRef.current
      if (prev != null && prev.id !== slide.id && prev.kind === "video") {
        markVideoPlayed(prev.id)
      }
      prevSlideRef.current = { id: slide.id, kind: slide.kind }
      // Active video slide is the resume point: the next launch's queue build
      // continues the pool rotation from here (web's 24h session-resume rule).
      persistActiveSlide(slide)
    },
    [markVideoPlayed, persistActiveSlide],
  )

  const handleSelectSlide = useCallback((index: number) => {
    pagerRef.current?.selectSlide(index)
  }, [])

  const activeIndex = activeHero?.index ?? 0
  // Chrome renders from the CURRENT queue at the active index. The stored
  // slide is only a fallback for the single commit where a stale index
  // outlives a shorter new queue, before the reset effect above lands.
  const activeSlide = heroSlides[activeIndex] ?? activeHero?.slide ?? null

  // Mux overlay copy is time-of-day sensitive (Eastern-hour rule) — resolve
  // the CTA action at display time, per active-slide entry.
  const activeInsertAction = useMemo(
    () =>
      activeSlide?.kind === "mux"
        ? muxSlideDisplayCopy(activeSlide, new Date()).action
        : null,
    [activeSlide],
  )

  // ── Hero swipe (capture-phase PanResponder on the screen root) ─────────────

  // Index snapshot taken when the gesture claims: anchors the swipe intent to
  // the slide the user SAW — an auto-advance landing mid-gesture must not
  // retarget the release.
  const gestureStartIndexRef = useRef(0)

  const heroPanResponder = useMemo(
    () =>
      PanResponder.create({
        // Claim ONLY horizontal-dominant moves over the VISIBLE hero, before
        // the FlashList takes them; vertical drags and taps return false so feed
        // scroll + Pressables stay untouched. Never claims when hero is hidden or has <2 slides (nothing to swipe to).
        onMoveShouldSetPanResponderCapture: (evt, gesture) => {
          const { scrollY, slideCount, heroHeight: h } = swipeStateRef.current
          if (slideCount < 2) return false
          // The Home tab is full-bleed from the window top (headerShown:
          // false), so pageY maps straight onto hero coordinates: the visible
          // hero ends at heroHeight - scrollY, clamped at 0 once scrolled past.
          const visibleHeroBottom = Math.max(0, h - scrollY)
          const claims =
            evt.nativeEvent.pageY < visibleHeroBottom &&
            Math.abs(gesture.dx) >
              Math.abs(gesture.dy) * HERO_SWIPE_DOMINANCE &&
            Math.abs(gesture.dx) > HERO_SWIPE_ACTIVATE_PX
          if (claims) {
            gestureStartIndexRef.current = swipeStateRef.current.activeIndex
          }
          return claims
        },
        onPanResponderTerminationRequest: () => true,
        onPanResponderRelease: (_evt, gesture) => {
          const { slideCount } = swipeStateRef.current
          const index = gestureStartIndexRef.current
          if (slideCount === 0) return
          if (gesture.dx < -HERO_SWIPE_COMMIT_PX) {
            pagerRef.current?.swipeToSlide(Math.min(index + 1, slideCount - 1))
          } else if (gesture.dx > HERO_SWIPE_COMMIT_PX) {
            pagerRef.current?.swipeToSlide(Math.max(index - 1, 0))
          }
          // Sub-threshold drag: no slide change.
        },
      }),
    [],
  )

  // ── Mute session rules (screen-owned; the pager is controlled) ─────────────

  const [muted, setMuted] = useState(true)
  const handleMuteToggle = useCallback(() => setMuted((m) => !m), [])

  const [focused, setFocused] = useState(true)
  useEffect(() => {
    // CuratedHomeLayout session-mute rule: blur resets to muted; an unmute
    // persists across slide advances while focused. The focus flag also suspends
    // the pager on blur (AE6); AppState backgrounding is handled in HomeHeroPager.
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

  // ── Hero chrome actions (overlay-layer Pressables) ─────────────────────────

  const handleWatchNow = useCallback(() => {
    if (activeSlide?.kind !== "video") return
    const { slug, title, label, imageUrl, playbackId } =
      slideRouteArgs(activeSlide)
    if (slug == null) return
    // Same routing rule as HomeCard / Discover (series-shaped label → series
    // page, else watch page), with a seed for instant paint. navigate (not
    // push) dedupes a double-tap into one screen.
    const seed = encodeWatchSeed({ slug, title, imageUrl, playbackId })
    const route = isSeriesLabel(label) ? "series" : "watch"
    router.navigate(`/${route}/${encodeURIComponent(slug)}?seed=${seed}`)
  }, [activeSlide, router])

  const handleInsertPress = useCallback(() => {
    // External destination — system browser via the shared validated helper.
    if (activeInsertAction != null) openExternalUrl(activeInsertAction.url)
  }, [activeInsertAction])

  // ── Scroll brackets (plain JS onScroll — CuratedHomeLayout pattern) ────────

  const [heroPaused, setHeroPaused] = useState(false)
  const [heroBlurOpacity, setHeroBlurOpacity] = useState(0)
  const [chromeOpacity, setChromeOpacity] = useState(1)

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      swipeStateRef.current.scrollY = scrollY
      // Boolean state bails out of identical updates on its own.
      setHeroPaused(scrollY > heroHeight * 0.7)
      // Quantize the blur ramp to 1/20 steps so repeated identical values
      // bail out instead of re-rendering at 60fps.
      const blur = Math.min(1, Math.max(0, scrollY / (heroHeight * 0.5)))
      setHeroBlurOpacity(Math.round(blur * 20) / 20)
      // Hero chrome fades faster than the blur ramp so the buttons are gone
      // before feed content overlaps them. Same 1/20 quantization.
      const fade = Math.min(1, Math.max(0, scrollY / (heroHeight * 0.3)))
      setChromeOpacity(Math.round((1 - fade) * 20) / 20)
    },
    [heroHeight],
  )

  // ── Feed composition ───────────────────────────────────────────────────────

  const feedItems = useMemo<HomeFeedItem[]>(() => {
    if (model == null) return []
    const items: HomeFeedItem[] = []
    // Selector rail mirrors the pager-chrome rule: multi-slide queues only (AE2).
    if (heroSlides.length > 1) items.push({ kind: "selector" })
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
        item.kind === "selector" ? (
          <View style={styles.selectorRailSpacing}>
            <HomeHeroSelectorRail
              slides={heroSlides}
              activeIndex={activeIndex}
              onSelectSlide={handleSelectSlide}
            />
          </View>
        ) : item.kind === "section" ? (
          <HomeShelf section={item.section} />
        ) : (
          <HomeMissionSection />
        )

      return (
        // Translucent per-item background (mission carries its own). Never on
        // contentContainerStyle: an opaque container fills the padding region
        // and hides the absolute hero behind it.
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
    [heroSlides, activeIndex, handleSelectSlide, heroVisible],
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
    <View style={layout.screenContainer} {...heroPanResponder.panHandlers}>
      {heroVisible && (
        <View style={[styles.heroLayer, { height: heroHeight }]}>
          <HomeHeroPager
            ref={pagerRef}
            slides={heroSlides}
            heroHeight={heroHeight}
            paused={heroPaused || !focused}
            blurOpacity={heroBlurOpacity}
            muted={muted}
            onSlideChange={handleSlideChange}
          />
        </View>
      )}

      <HomeHeader title={null} titleOpacity={0} homeVariant />

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
        // Hero chrome must live ABOVE the FlashList (which swallows hero-layer
        // taps) but belong to the hero: it fades with scroll and stops taking
        // touches once faded, letting feed taps pass through.
        <View
          style={[styles.heroInteractiveLayer, { height: heroHeight }]}
          pointerEvents="box-none"
        >
          {activeSlide != null && (
            <HeroChrome
              opacity={chromeOpacity}
              slide={activeSlide}
              insertAction={activeInsertAction}
              muted={muted}
              onWatchNow={handleWatchNow}
              onToggleMute={handleMuteToggle}
              onInsertAction={handleInsertPress}
            />
          )}
        </View>
      )}
    </View>
  )
}

// ── Hero chrome (memo'd: chromeOpacity steps re-render only this subtree) ───

type HeroChromeProps = {
  opacity: number
  slide: WatchHomeSlide
  insertAction: { label: string; url: string } | null
  muted: boolean
  onWatchNow: () => void
  onToggleMute: () => void
  onInsertAction: () => void
}

const HeroChrome = memo(function HeroChrome({
  opacity,
  slide,
  insertAction,
  muted,
  onWatchNow,
  onToggleMute,
  onInsertAction,
}: HeroChromeProps) {
  const typography = useTypography()

  return (
    <View
      style={[styles.heroChrome, { opacity }]}
      // Stop taking touches once half-faded: feed content starts overlapping
      // at ~25% fade, and half-visible buttons must not intercept taps aimed
      // at the feed beneath them.
      pointerEvents={opacity < 0.5 ? "none" : "box-none"}
    >
      <View style={styles.heroChromeLeft} pointerEvents="box-none">
        {slide.kind === "video" && slide.slug != null && (
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && feedback.pressed,
            ]}
            onPress={onWatchNow}
            accessibilityRole="button"
            accessibilityLabel={`Watch ${slide.title} now`}
          >
            <Text style={[styles.ctaText, typography.body]}>Watch Now</Text>
          </Pressable>
        )}
        {slide.kind === "mux" && insertAction != null && (
          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              pressed && feedback.pressed,
            ]}
            onPress={onInsertAction}
            accessibilityRole="link"
            accessibilityLabel={insertAction.label}
          >
            <Text style={[styles.ctaText, typography.body]}>
              {insertAction.label}
            </Text>
          </Pressable>
        )}
      </View>
      {slide.kind === "video" && (
        <Pressable
          style={({ pressed }) => [
            styles.muteButton,
            pressed && feedback.pressed,
          ]}
          onPress={onToggleMute}
          accessibilityLabel={muted ? "Unmute video" : "Mute video"}
          accessibilityRole="button"
        >
          <Ionicons
            name={muted ? "volume-mute" : "volume-high"}
            size={20}
            color={TEXT_ON_OVERLAY}
          />
        </Pressable>
      )}
    </View>
  )
})

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
  heroChrome: {
    // Mirrors the chrome's old in-pager position: CTA bottom-left, mute circle
    // bottom-right, both at 16 padding and HERO_CHROME_BOTTOM above the hero
    // bottom (shared geometry with the pager's reserved text-block padding).
    position: "absolute",
    left: 0,
    right: 0,
    bottom: HERO_CHROME_BOTTOM,
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
  },
  heroChromeLeft: {
    flex: 1,
    alignItems: "flex-start",
  },
  ctaButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
    minHeight: HERO_CTA_HEIGHT,
    justifyContent: "center",
  },
  ctaText: {
    fontWeight: "600",
    color: TEXT_ON_OVERLAY,
    fontFamily: "System",
  },
  muteButton: {
    width: HERO_CTA_HEIGHT,
    height: HERO_CTA_HEIGHT,
    borderRadius: HERO_CTA_HEIGHT / 2,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  feedItemBackground: {
    backgroundColor: hexToRgba(BG_COLOR, 0.9),
  },
  feedFeather: {
    height: 48,
    marginTop: -48,
  },
  selectorRailSpacing: {
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
