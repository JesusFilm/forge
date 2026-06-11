import { useFocusEffect, useRouter } from "expo-router"
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native"

import { HomeBackdrop } from "../src/components/home/HomeBackdrop"
import { HomeBillboard } from "../src/components/home/HomeBillboard"
import { resolveHomeCardPath } from "../src/components/home/homeCardRouting"
import { HomeRail } from "../src/components/home/HomeRail"
import {
  areHeroActionsGhosted,
  isTopBarHidden,
  resolveBrowseState,
  resolveRowScrollTarget,
  ROW_ANCHOR_OFFSET,
  type HomeBrowseState,
} from "../src/components/home/homeScrollState"
import { HomeTopBar } from "../src/components/home/HomeTopBar"
import { MissionSection } from "../src/components/home/MissionSection"
import {
  createShowcaseFocusDebouncer,
  INITIAL_SHOWCASE_STATE,
  showcaseReducer,
  type ShowcaseFocusDebouncer,
} from "../src/components/home/showcaseState"
import { WATCH_THEME } from "../src/components/watch/watchDetailTheme"
import { useWatchHome } from "../src/hooks/useWatchHome"
import { scale } from "../src/lib/scale"
import { WATCH_HOME_FEATURED_RAIL } from "../src/lib/watchHome/config"
import { resolveHomeScreenState } from "../src/lib/watchHome/homeScreenState"
import {
  resolveFeaturedTitle,
  type WatchHomeCard,
} from "../src/lib/watchHome/model"

/**
 * Home screen — the "Forge TV Home" redesign.
 *
 * The TV home renders the curated watch-home set — the same hero pool and
 * sections web /watch and mobile home use — from useWatchHome's lean bulk
 * fetch (R8). A full-screen ambient backdrop (HomeBackdrop) paints the
 * focused card's artwork behind everything; the billboard hero
 * (HomeBillboard) carries that card's copy plus Play / More Info actions;
 * the top bar (HomeTopBar) holds the brandmark, Search/Home tabs, and clock.
 * Rails drive the showcase via the debounced reducer (R10/R11), and ALSO
 * drive the screen's browse state: row 0 = "browse" (light scrim), rows >= 1
 * = "deep" (full scrim, top bar hidden, row anchored near the viewport top).
 * The SDUI Experience pipeline still serves /experience/[slug] — only this
 * screen left it (R9).
 */
export default function HomeScreen() {
  const router = useRouter()
  const [retryFocused, setRetryFocused] = useState(false)
  const { model, loading, error, refetch } = useWatchHome()

  // Back-from-/search focus restoration. tvos#852 workaround: on every
  // regain-focus after the first real mount, bump a key that tells
  // <HomeTopBar /> to apply hasTVPreferredFocus to its Search tab.
  // Skip the first mount so the rails' own initial focus wins on cold
  // home render.
  //
  // Counter (not boolean) to absorb React Strict Mode's deliberate
  // double-invoke of effects in dev: with a counter we wait for the
  // *third* run-through (Strict Mode mount-unmount-mount + first
  // navigation back) before bumping.
  const [searchTabFocusKey, setSearchTabFocusKey] = useState(0)
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
      setSearchTabFocusKey((k) => k + 1)
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
  // id survives). Only CARDS dispatch focus events: the top bar tabs, hero
  // actions, and Retry never do, so the showcase retains across non-card
  // focus automatically (AE4) and across stack push/pop (state lives up
  // here, not in the rails). The committed card now drives BOTH the
  // billboard copy and the full-screen backdrop.
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

  // ── Browse state + row-anchored scrolling ──
  // Focused row index → "top" | "browse" | "deep" (homeScrollState.ts) drives
  // the backdrop's deep scrim, the top bar's hide, and the hero actions'
  // ghosting. Scrolling is row-anchored, not free: each shelf reports its
  // content y via onLayout; focusing a card in row r >= 1 pins that shelf
  // near the viewport top, while row 0 / hero actions / tabs pin the feed to
  // 0 (the old featured-rail scroll-to-top behavior folds in here). The
  // scroll is immediate (not debounced) — it must track the traversal, not
  // the settled card.
  const [browseState, setBrowseState] = useState<HomeBrowseState>("top")
  const scrollRef = useRef<ScrollView | null>(null)
  const rowYsRef = useRef<number[]>([])

  const handleRowFocus = useCallback((rowIndex: number) => {
    setBrowseState(resolveBrowseState(rowIndex))
    const target = resolveRowScrollTarget({
      rowIndex,
      rowLayoutYs: rowYsRef.current,
      anchorOffset: scale(ROW_ANCHOR_OFFSET),
    })
    if (target != null) {
      scrollRef.current?.scrollTo({ y: target, animated: true })
    }
  }, [])

  // Tab bar / hero actions focus: pin to the top state.
  const handleChromeFocus = useCallback(() => {
    setBrowseState(resolveBrowseState(null))
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [])

  // Stable per-row onLayout handlers (featured = 0, sections = 1..n) so the
  // memoized rails' wrappers don't churn on every screen re-render.
  const rowCount = (model?.sections.length ?? 0) + 1
  const rowLayoutHandlers = useMemo(
    () =>
      Array.from(
        { length: rowCount },
        (_, rowIndex) => (event: LayoutChangeEvent) => {
          rowYsRef.current[rowIndex] = event.nativeEvent.layout.y
        },
      ),
    [rowCount],
  )

  // Shape-based routing (R13): series-shaped → /series, leaf → /watch, both
  // seeded for instant first paint. Null path (no slug) is a no-op press.
  // The billboard's Play and More Info actions route the same way.
  const handleCardPress = useCallback(
    (card: WatchHomeCard) => {
      const path = resolveHomeCardPath(card)
      if (path != null) router.push(path)
    },
    [router],
  )

  const handleSearchPress = useCallback(() => {
    router.push("/search")
  }, [router])

  // The top bar (brandmark · Search/Home tabs · clock). Rendered in every
  // state — including loading, error and empty — so Search stays reachable
  // while the home model resolves; in the content state it is the sticky
  // first child of the ScrollView.
  const topBar = (
    <HomeTopBar
      key={`home-top-bar-${searchTabFocusKey}`}
      hidden={isTopBarHidden(browseState)}
      searchTabPreferredFocus={searchTabFocusKey > 0}
      onSearchPress={handleSearchPress}
      onChromeFocus={handleChromeFocus}
    />
  )

  const screenState = resolveHomeScreenState({ model, loading, error })

  // ── Loading state (no model yet — initial load or a retry) ──
  if (screenState === "loading") {
    return (
      <View style={styles.screen}>
        {topBar}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={WATCH_THEME.accent} />
        </View>
      </View>
    )
  }

  // ── Error state — only when nothing is renderable (R16): a stale model
  // beats an error screen, so refetch failures fall through to content. ──
  if (screenState === "error") {
    return (
      <View style={styles.screen}>
        {topBar}
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
        {topBar}
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No content available</Text>
        </View>
      </View>
    )
  }

  // ── Content ──
  // The non-focusable backdrop sits absolutely behind ONE full-screen
  // ScrollView whose sticky first child is the top bar: the tvOS focus
  // engine cannot traverse a parent-View boundary, so tab↔hero↔rail D-pad
  // traversal relies on the top bar, billboard actions, and rails being
  // siblings in the same scroll container — the structure the previous home
  // shipped with (R14/AE6). If traversal ever proves unreliable, the
  // documented fallback is TVFocusGuideView destinations in both directions
  // (tv-focus-driven-hero-patterns-20260420.md §3).
  return (
    <View style={styles.screen}>
      <HomeBackdrop card={showcase.current} browseState={browseState} />

      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        stickyHeaderIndices={[0]}
      >
        <View>{topBar}</View>

        <HomeBillboard
          card={showcase.current}
          actionsGhosted={areHeroActionsGhosted(browseState)}
          onChromeFocus={handleChromeFocus}
          onCardPress={handleCardPress}
        />

        <View onLayout={rowLayoutHandlers[0]}>
          <HomeRail
            rowIndex={0}
            eyebrow={WATCH_HOME_FEATURED_RAIL.eyebrow}
            title={featuredTitle}
            cards={model.featured}
            onCardFocus={handleCardFocus}
            onRowFocus={handleRowFocus}
            onCardPress={handleCardPress}
          />
        </View>

        {model.sections.map((section, sectionIndex) => (
          <View key={section.id} onLayout={rowLayoutHandlers[sectionIndex + 1]}>
            <HomeRail
              rowIndex={sectionIndex + 1}
              eyebrow={section.eyebrow}
              title={section.title}
              cards={section.cards}
              onCardFocus={handleCardFocus}
              onRowFocus={handleRowFocus}
              onCardPress={handleCardPress}
            />
          </View>
        ))}

        {/* Mission tail (R15): storytelling cards + beta-signup QR close the
            feed. Its QR wrapper is focusable but non-actioning, and never
            dispatches card-focus — the showcase retains the last card (R10)
            and the browse state stays "deep" while the tail is explored. */}
        <MissionSection />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    // The redesign's near-black canvas (WATCH_THEME.below) — the backdrop
    // paints over it in the content state; loading/error/empty render the
    // top bar straight on it.
    backgroundColor: WATCH_THEME.below,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: scale(80),
  },
  list: {
    flex: 1,
  },
  listContent: {
    // Breathing room below the mission tail.
    paddingBottom: scale(80),
  },
  // ── Error state ──
  errorText: {
    fontFamily: "System",
    fontSize: Math.round(scale(28)),
    fontWeight: "bold",
    color: WATCH_THEME.text,
    marginBottom: scale(8),
  },
  errorDetail: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    color: WATCH_THEME.text62,
    marginBottom: scale(32),
    textAlign: "center",
  },
  retryButton: {
    paddingHorizontal: scale(40),
    paddingVertical: scale(16),
    borderRadius: scale(28),
    backgroundColor: WATCH_THEME.accent,
  },
  retryButtonFocused: {
    transform: [{ scale: 1.05 }],
    shadowColor: WATCH_THEME.accent,
    shadowRadius: scale(20),
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 0 },
  },
  retryText: {
    fontFamily: "System",
    fontSize: Math.round(scale(20)),
    fontWeight: "600",
    color: WATCH_THEME.text,
  },
  // ── Empty state ──
  emptyText: {
    fontFamily: "System",
    fontSize: Math.round(scale(24)),
    color: WATCH_THEME.text62,
  },
})
