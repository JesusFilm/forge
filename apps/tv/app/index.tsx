import { useFocusEffect, useRouter } from "expo-router"
import { useCallback, useEffect, useReducer, useRef, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { HomeHeader } from "../src/components/HomeHeader"
import { resolveHomeCardPath } from "../src/components/home/homeCardRouting"
import { HomeRail } from "../src/components/home/HomeRail"
import { MissionSection } from "../src/components/home/MissionSection"
import { ShowcaseCanvas } from "../src/components/home/ShowcaseCanvas"
import {
  createShowcaseFocusDebouncer,
  INITIAL_SHOWCASE_STATE,
  showcaseReducer,
  type ShowcaseFocusDebouncer,
} from "../src/components/home/showcaseState"
import { useWatchHome } from "../src/hooks/useWatchHome"
import { COLORS } from "../src/lib/colors"
import { scale } from "../src/lib/scale"
import { WATCH_HOME_FEATURED_RAIL } from "../src/lib/watchHome/config"
import { resolveHomeScreenState } from "../src/lib/watchHome/homeScreenState"
import {
  resolveFeaturedTitle,
  type WatchHomeCard,
} from "../src/lib/watchHome/model"

/**
 * Home screen.
 *
 * The TV home renders the curated watch-home set — the same hero pool and
 * sections web /watch and mobile home use — from useWatchHome's lean bulk
 * fetch (R8): a non-interactive Focus-Driven Showcase up top, then the
 * Featured rail (the hero pool) and every configured section as horizontal
 * rails. Rails own 100% of focus; focusing any card swaps the showcase
 * (debounced, R10/R11). The SDUI Experience pipeline still serves
 * /experience/[slug] — only this screen left it (R9).
 */
export default function HomeScreen() {
  const router = useRouter()
  const [retryFocused, setRetryFocused] = useState(false)
  const { model, loading, error, refetch } = useWatchHome()

  // Back-from-/search focus restoration. tvos#852 workaround: on every
  // regain-focus after the first real mount, bump a key that tells
  // <HomeHeader /> to apply hasTVPreferredFocus to its Search chip.
  // Skip the first mount so the rails' own initial focus wins on cold
  // home render.
  //
  // Counter (not boolean) to absorb React Strict Mode's deliberate
  // double-invoke of effects in dev: with a counter we wait for the
  // *third* run-through (Strict Mode mount-unmount-mount + first
  // navigation back) before bumping.
  const [searchChipFocusKey, setSearchChipFocusKey] = useState(0)
  const focusEffectRunCountRef = useRef(0)
  useFocusEffect(
    useCallback(() => {
      focusEffectRunCountRef.current += 1
      // In production the cleanup-and-rerun pattern of Strict Mode does
      // not fire, so the first real run is run #1. In dev, Strict Mode
      // produces runs #1 (mount) + #2 (immediate remount) before any user
      // navigation; the first back-from-/search lands as run #3. Skip
      // everything before #2 so dev matches prod first-render behavior.
      const STRICT_MODE_DEV_RUNS = 1
      if (focusEffectRunCountRef.current <= STRICT_MODE_DEV_RUNS + 1) return
      setSearchChipFocusKey((k) => k + 1)
    }, []),
  )

  // Featured rail title re-evaluates on every screen focus with an injected
  // clock (the model never reads Date.now()), so a Home left open across a
  // time-of-day boundary greets correctly on return from a pushed screen.
  const [featuredTitle, setFeaturedTitle] = useState(() =>
    resolveFeaturedTitle(WATCH_HOME_FEATURED_RAIL, new Date()),
  )
  useFocusEffect(
    useCallback(() => {
      const next = resolveFeaturedTitle(WATCH_HOME_FEATURED_RAIL, new Date())
      setFeaturedTitle((prev) => (prev === next ? prev : next))
    }, []),
  )

  // ── Showcase state ──
  // First model seeds the showcase (modelResolved); later models — background
  // refetches — re-reconcile (modelRefreshed keeps the current pick when its
  // id survives). Only CARDS dispatch focus events: the search chip and Retry
  // never do, so the showcase retains across non-card focus automatically
  // (AE4) and across stack push/pop (state lives up here, not in the rails).
  const [showcase, dispatchShowcase] = useReducer(
    showcaseReducer,
    INITIAL_SHOWCASE_STATE,
  )
  const modelResolvedRef = useRef(false)
  useEffect(() => {
    if (model == null) return
    if (!modelResolvedRef.current) {
      modelResolvedRef.current = true
      dispatchShowcase({ type: "modelResolved", model })
    } else {
      dispatchShowcase({ type: "modelRefreshed", model })
    }
  }, [model])

  // Trailing ~150ms debounce so fast D-pad traversal commits once with the
  // settled card (tv-focus-driven-hero-patterns-20260420.md §4). Lazily
  // created once; cancelled on unmount so no commit fires into a dead tree.
  const focusDebouncerRef = useRef<ShowcaseFocusDebouncer | null>(null)
  if (focusDebouncerRef.current == null) {
    focusDebouncerRef.current = createShowcaseFocusDebouncer((card) =>
      dispatchShowcase({ type: "cardFocused", card }),
    )
  }
  useEffect(() => () => focusDebouncerRef.current?.cancel(), [])

  const handleCardFocus = useCallback((card: WatchHomeCard) => {
    focusDebouncerRef.current?.focus(card)
  }, [])

  // Featured-rail focus also scrolls the feed back to the top. The showcase
  // is non-focusable, so the tvOS focus engine never auto-scrolls it back
  // into view: after browsing lower rails, D-pad up stops scrolling once the
  // Featured rail is visible and the hero stays stranded above the viewport.
  // The scroll is immediate (not debounced) — it must track the return trip,
  // not the settled card.
  const scrollRef = useRef<ScrollView | null>(null)
  const handleFeaturedCardFocus = useCallback(
    (card: WatchHomeCard) => {
      scrollRef.current?.scrollTo({ y: 0, animated: true })
      handleCardFocus(card)
    },
    [handleCardFocus],
  )

  // Shape-based routing (R13): series-shaped → /series, leaf → /watch, both
  // seeded for instant first paint. Null path (no slug) is a no-op press.
  const handleCardPress = useCallback(
    (card: WatchHomeCard) => {
      const path = resolveHomeCardPath(card)
      if (path != null) router.push(path)
    },
    [router],
  )

  // The nav header (Search chip). Rendered in every state — including loading,
  // error and empty — so Search stays reachable while the home model resolves;
  // in the content state it is the sticky first child of the ScrollView.
  const homeHeader = (
    <HomeHeader
      key={`home-header-${searchChipFocusKey}`}
      searchChipPreferredFocus={searchChipFocusKey > 0}
    />
  )

  const screenState = resolveHomeScreenState({ model, loading, error })

  // ── Loading state (no model yet — initial load or a retry) ──
  if (screenState === "loading") {
    return (
      <View style={styles.screen}>
        {homeHeader}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </View>
    )
  }

  // ── Error state — only when nothing is renderable (R16): a stale model
  // beats an error screen, so refetch failures fall through to content. ──
  if (screenState === "error") {
    return (
      <View style={styles.screen}>
        {homeHeader}
        <View style={styles.centered}>
          <Text style={styles.errorText}>Something went wrong</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <Pressable
            onFocus={() => setRetryFocused(true)}
            onBlur={() => setRetryFocused(false)}
            style={[
              styles.retryButton,
              retryFocused && styles.retryButtonFocused,
            ]}
            onPress={refetch}
            hasTVPreferredFocus
          >
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    )
  }

  // ── Empty state (no model, or a model that resolved zero cards) ──
  // `model == null` is redundant with screenState === "empty" here (the
  // loading/error returns above cover every other model-less state) but
  // narrows `model` to non-null for the content branch below.
  if (screenState === "empty" || model == null) {
    return (
      <View style={styles.screen}>
        {homeHeader}
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No content available</Text>
        </View>
      </View>
    )
  }

  // ── Content ──
  // ONE ScrollView with the header as its sticky first child: the tvOS focus
  // engine cannot traverse a parent-View boundary, so chip↔rail D-pad
  // traversal (R14/AE6) relies on header + rails being siblings in the same
  // scroll container — the structure the Experience-driven home shipped with.
  // The non-focusable showcase between them is invisible to the focus engine
  // (same as PR #803's non-interactive hero). If traversal ever proves
  // unreliable, the documented fallback is TVFocusGuideView destinations in
  // both directions (tv-focus-driven-hero-patterns-20260420.md §3).
  return (
    <ScrollView
      ref={scrollRef}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      stickyHeaderIndices={[0]}
    >
      <View>{homeHeader}</View>

      <ShowcaseCanvas card={showcase.current} />

      <HomeRail
        eyebrow={WATCH_HOME_FEATURED_RAIL.eyebrow}
        title={featuredTitle}
        cards={model.featured}
        onCardFocus={handleFeaturedCardFocus}
        onCardPress={handleCardPress}
      />

      {model.sections.map((section) => (
        <HomeRail
          key={section.id}
          eyebrow={section.eyebrow}
          title={section.title}
          cards={section.cards}
          onCardFocus={handleCardFocus}
          onCardPress={handleCardPress}
        />
      ))}

      {/* Mission tail (R15): storytelling cards + beta-signup QR close the
          feed. Its QR wrapper is focusable but non-actioning, and never
          dispatches card-focus — the showcase retains the last card (R10). */}
      <MissionSection />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  centered: {
    flex: 1,
    backgroundColor: COLORS.surface,
    alignItems: "center",
    justifyContent: "center",
    padding: scale(80),
  },
  list: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  listContent: {
    // Breathing room below the mission tail.
    paddingBottom: scale(80),
  },
  // ── Error state ──
  errorText: {
    fontFamily: "System",
    fontSize: scale(28),
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: scale(8),
  },
  errorDetail: {
    fontFamily: "System",
    fontSize: scale(18),
    color: COLORS.muted,
    marginBottom: scale(32),
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: scale(40),
    paddingVertical: scale(16),
    borderRadius: scale(28),
    backgroundColor: COLORS.primary,
  },
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: COLORS.primary,
    shadowRadius: scale(20),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "600",
    color: COLORS.text,
  },
  // ── Empty state ──
  emptyText: {
    fontFamily: "System",
    fontSize: scale(24),
    color: COLORS.muted,
  },
})
