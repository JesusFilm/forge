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
  type View as ViewType,
} from "react-native"

import { HomeBackdrop } from "../src/components/home/HomeBackdrop"
import { HeroPager } from "../src/components/home/HeroPager"
import { advanceByDelta } from "../src/components/home/heroPagerState"
import { HomeHeroCarousel } from "../src/components/home/HomeHeroCarousel"
import { resolveHomeCardPath } from "../src/components/home/homeCardRouting"
import { HomeRail } from "../src/components/home/HomeRail"
import { isRailActive } from "../src/components/home/homeRailWindow"
import {
  isTopBarHidden,
  resolveBrowseState,
  resolveRowScrollTarget,
  ROW_ANCHOR_OFFSET,
  type HomeBrowseState,
} from "../src/components/home/homeScrollState"
import { HomeTopBar } from "../src/components/home/HomeTopBar"
import { MissionSection } from "../src/components/home/MissionSection"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import {
  createShowcaseFocusDebouncer,
  INITIAL_SHOWCASE_STATE,
  showcaseReducer,
  type ShowcaseFocusDebouncer,
} from "../src/components/home/showcaseState"
import { WATCH_THEME } from "../src/components/watch/watchDetailTheme"
import { useWatchHome } from "../src/hooks/useWatchHome"
import { scale } from "../src/lib/scale"
import { resolveHomeScreenState } from "../src/lib/watchHome/homeScreenState"
import type { WatchHomeCard } from "../src/lib/watchHome/model"

/**
 * Home screen — the "Forge TV Home" redesign.
 *
 * The TV home renders the curated watch-home set — the same hero pool and
 * sections web /watch and mobile home use — from useWatchHome's lean bulk
 * fetch (R8). A full-screen ambient backdrop (HomeBackdrop) paints the
 * focused card's artwork behind everything; the billboard hero
 * (HomeBillboard) carries that card's copy (non-interactive);
 * the top bar (HomeTopBar) holds the brandmark, Search/Home tabs, and clock.
 * Rails drive the showcase via the debounced reducer (R10/R11), and ALSO
 * drive the screen's browse state: row 0 = "browse" (light scrim), rows >= 1
 * = "deep" (full scrim, top bar hidden, row anchored near the viewport top).
 * The SDUI Experience pipeline still serves /experience/[slug] — only this
 * screen left it (R9).
 */
// Phase 2 windowing: how many rails on each side of the focused row keep their
// cards mounted. >= 1 so the next rail is ready before D-pad focus reaches it; 2
// keeps one extra ready in each direction and lets its images decode ahead.
const RAIL_WINDOW_BUFFER = 2

// Delay before a vertical move mounts the new far rail — longer than the
// row-anchored scroll (~300ms) so the mount lands after the scroll, not during
// it (mounting ~10 cards mid-scroll is what made cross-rail moves jank).
const WINDOW_SHIFT_DELAY = 350

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

  // ── Showcase state ──
  // First model seeds the showcase (modelResolved); later models — background
  // refetches — re-reconcile (modelRefreshed keeps the current pick when its
  // id survives). Only CARDS dispatch focus events: the top bar tabs and
  // Retry never do, so the showcase retains across non-card focus
  // automatically (AE4) and across stack push/pop (state lives up here, not
  // in the rails). The committed card now drives BOTH the billboard copy and
  // the full-screen backdrop.
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

  // Also cancel a pending commit whenever the screen loses focus (navigating
  // to /search, a card detail, etc.) — not just on unmount. Otherwise a
  // debounce armed by the last focus move before navigation fires ~150ms
  // later into the now-backgrounded Home, committing a stale showcase card.
  useFocusEffect(
    useCallback(() => () => focusDebouncerRef.current?.cancel(), []),
  )

  const handleCardFocus = useCallback((card: WatchHomeCard) => {
    focusDebouncerRef.current?.focus(card)
  }, [])

  // ── Browse state + row-anchored scrolling ──
  // Focused row index → "top" | "browse" | "deep" (homeScrollState.ts) drives
  // the backdrop's deep scrim and the top bar's hide. Scrolling is
  // row-anchored, not free: each shelf reports its content y via onLayout;
  // focusing a card in row r >= 1 pins that shelf near the viewport top, while
  // row 0 / the top bar tabs pin the feed to 0 (the old featured-rail
  // scroll-to-top behavior folds in here). The scroll is immediate (not
  // debounced) — it must track the traversal, not the settled card.
  const [browseState, setBrowseState] = useState<HomeBrowseState>("top")
  // Phase 2 windowing: the row that holds focus (hero / top bar = 0). State (not
  // just the gate ref below) so the rail window re-renders as focus moves rows.
  const [focusedRow, setFocusedRow] = useState(0)
  const scrollRef = useRef<ScrollView | null>(null)
  const rowYsRef = useRef<number[]>([])
  // When a row is focused before its onLayout has measured its y (cold first
  // paint, or the window a background refetch reopens by remounting rows),
  // resolveRowScrollTarget returns null. With native focus-scroll disabled
  // that would strand the focused card off-screen, so we stash the row and
  // fire the scroll the moment its onLayout lands (recordRowY below).
  const pendingScrollRowRef = useRef<number | null>(null)
  // The row that currently holds focus. Within-row horizontal moves keep the
  // same row, so the row-level chrome/scroll update (handleRowFocus) is gated to
  // fire only on an actual row TRANSITION — a horizontal D-pad sweep then costs
  // only the (native-driven) card animation, not a redundant scrollTo per move.
  // Reset to null whenever focus leaves the rails (top bar / hero / mission) so
  // re-entering a row always re-applies its browse/scroll state.
  const lastFocusedRowRef = useRef<number | null>(null)
  // Last section rail's row index, read by handleMissionFocus so the bottom
  // rails stay windowed-active when focus drops to the mission tail (Up returns
  // to a mounted rail). Assigned each render once the model is known.
  const sectionCountRef = useRef(0)

  const scrollToRow = useCallback((rowIndex: number): boolean => {
    const target = resolveRowScrollTarget({
      rowIndex,
      rowLayoutYs: rowYsRef.current,
      anchorOffset: scale(ROW_ANCHOR_OFFSET),
    })
    if (target == null) return false
    scrollRef.current?.scrollTo({ y: target, animated: true })
    return true
  }, [])

  // Rail-window control. focusedRowAppliedRef mirrors focusedRow for the stable
  // edge-flush check below (reading state in the callback would stale it).
  const windowShiftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusedRowAppliedRef = useRef(0)
  const applyWindow = useCallback((row: number) => {
    if (windowShiftTimerRef.current != null) {
      clearTimeout(windowShiftTimerRef.current)
      windowShiftTimerRef.current = null
    }
    focusedRowAppliedRef.current = row
    setFocusedRow(row)
  }, [])
  const scheduleWindow = useCallback(
    (row: number) => {
      // At the window edge, mount now or a fast sweep strands on an unmounted
      // rail; otherwise defer so the mount lands after the scroll, not during.
      if (Math.abs(row - focusedRowAppliedRef.current) >= RAIL_WINDOW_BUFFER) {
        applyWindow(row)
        return
      }
      if (windowShiftTimerRef.current != null) {
        clearTimeout(windowShiftTimerRef.current)
      }
      windowShiftTimerRef.current = setTimeout(
        () => applyWindow(row),
        WINDOW_SHIFT_DELAY,
      )
    },
    [applyWindow],
  )
  useEffect(
    () => () => {
      if (windowShiftTimerRef.current != null) {
        clearTimeout(windowShiftTimerRef.current)
      }
    },
    [],
  )

  const handleRowFocus = useCallback(
    (rowIndex: number) => {
      // Within-row horizontal move: the row hasn't changed, so the row-level
      // browse/scroll state is identical — skip it (avoids a redundant scrollTo
      // on every horizontal D-pad move).
      if (lastFocusedRowRef.current === rowIndex) return
      lastFocusedRowRef.current = rowIndex
      // Focus + scroll run now on the already-mounted buffer rail; the window
      // mount is deferred (scheduleWindow) so it doesn't jank this move.
      setBrowseState(resolveBrowseState(rowIndex))
      // Topmost section rail = rowIndex 1; anything >= 2 is a rail below it.
      setBelowTopmost(rowIndex >= 2)
      // Defer if the row's y isn't measured yet; recordRowY flushes it.
      pendingScrollRowRef.current = scrollToRow(rowIndex) ? null : rowIndex
      scheduleWindow(rowIndex)
    },
    [scrollToRow, scheduleWindow],
  )

  const recordRowY = useCallback(
    (rowIndex: number, y: number) => {
      rowYsRef.current[rowIndex] = y
      if (pendingScrollRowRef.current === rowIndex && scrollToRow(rowIndex)) {
        pendingScrollRowRef.current = null
      }
    },
    [scrollToRow],
  )

  // Top bar tab focus: pin to the top state.
  const handleChromeFocus = useCallback(() => {
    lastFocusedRowRef.current = null
    applyWindow(0)
    setBrowseState(resolveBrowseState(null))
    setBelowTopmost(false)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [applyWindow])

  // Mission-tail QR focus: with the native focus-scroll disabled, the tail
  // needs its own scroll hook — pin to the end in the deep state.
  const handleMissionFocus = useCallback(() => {
    lastFocusedRowRef.current = null
    // Keep the bottom rails windowed-active so Up from the mission tail returns
    // to a mounted rail, not an empty placeholder.
    applyWindow(sectionCountRef.current)
    setBrowseState("deep")
    // The mission tail is below the topmost rail — keep its autoFocus OFF so a
    // later Up traversal stays column-preserving.
    setBelowTopmost(true)
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [applyWindow])

  // Stable per-row onLayout handlers (featured = 0, sections = 1..n) so the
  // memoized rails' wrappers don't churn on every screen re-render.
  const rowCount = (model?.sections.length ?? 0) + 1
  sectionCountRef.current = rowCount - 1
  const rowLayoutHandlers = useMemo(
    () =>
      Array.from(
        { length: rowCount },
        (_, rowIndex) => (event: LayoutChangeEvent) => {
          recordRowY(rowIndex, event.nativeEvent.layout.y)
        },
      ),
    [rowCount, recordRowY],
  )

  // Drop stale row measurements when the model's section set changes (a
  // background refetch can reorder/resize rows). Otherwise a focus landing
  // before the new rows re-measure would anchor to a previous section's y.
  // The cleared entries re-populate via onLayout; the null window is handled
  // by the deferred-scroll path above.
  const sections = model?.sections
  useEffect(() => {
    rowYsRef.current = []
    pendingScrollRowRef.current = null
  }, [sections])

  // Shape-based routing (R13): series-shaped → /series, leaf → /watch, both
  // seeded for instant first paint. Null path (no slug) is a no-op press.
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

  // Whether the currently-focused element is a rail BELOW the topmost one.
  // Gates the topmost rail's autoFocus: ON while the source is the topmost rail
  // / hero CTA / top bar (so the guide TRACKS and RESTORES its last card for
  // Down off the CTA), OFF while coming Up from a rail below (so that traversal
  // keeps the focus engine's column-preserving geometry).
  const [belowTopmost, setBelowTopmost] = useState(false)

  // Hero paging: the screen owns the active hero index so HeroPager (the
  // screen-level slide layer) and the carousel's dots stay in lockstep. The
  // chevron / auto-advance request an advance; the pager runs the slide. The
  // hero's own art no longer drives the backdrop — the pager covers it while
  // the hero is focused, and the backdrop is left to rail-browse.
  const featuredCount = model?.featured.length ?? 0
  const [heroIndex, setHeroIndex] = useState(0)
  // Direction of the last page: +1 next (slide in from the right), -1 previous
  // (from the left). Drives HeroPager's entry side.
  const [heroDirection, setHeroDirection] = useState(1)
  const advanceHero = useCallback(
    (delta: number) => {
      setHeroDirection(delta >= 0 ? 1 : -1)
      setHeroIndex((i) => advanceByDelta(i, delta, featuredCount))
    },
    [featuredCount],
  )
  // Keep heroIndex in range if a background refetch shrinks the hero set, so the
  // pager, dots and CTA never diverge.
  useEffect(() => {
    setHeroIndex((i) =>
      featuredCount > 0 ? Math.min(i, featuredCount - 1) : 0,
    )
  }, [featuredCount])
  const handleHeroFocusChange = useCallback(
    (isFocused: boolean) => {
      if (!isFocused) return
      lastFocusedRowRef.current = null
      applyWindow(0)
      setBelowTopmost(false)
      setBrowseState("browse")
      scrollRef.current?.scrollTo({ y: 0, animated: true })
    },
    [applyWindow],
  )

  // The hero CTA's native node — wired as the D-pad-up destination for EVERY
  // card in the first section rail, so Up from any card (even the rightmost)
  // returns to the CTA rather than dead-ending under the hero artwork. ALSO the
  // destination of the hero's TVFocusGuideView (below), so Down from the top bar
  // tabs lands on See more.
  const [ctaNode, setCtaNode] = useState<ViewType | null>(null)

  // The top bar Search tab's native node — wired as the D-pad-up destination for
  // both hero action buttons. The centered tab bar has no horizontal overlap
  // with the left-anchored hero action row, so Up from the hero dead-ends
  // without an explicit destination (the mirror of ctaNode's job for the rail).
  const [searchTabNode, setSearchTabNode] = useState<ViewType | null>(null)

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
      onSearchTabNode={setSearchTabNode}
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
            accessibilityRole="button"
            accessibilityLabel="Try again"
            accessibilityHint="Reloads the home feed"
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
  // engine cannot traverse a parent-View boundary, so tab↔rail D-pad
  // traversal relies on the top bar and rails being siblings in the same
  // scroll container — the structure the previous home shipped with
  // (R14/AE6). If traversal ever proves unreliable, the
  // documented fallback is TVFocusGuideView destinations in both directions
  // (tv-focus-driven-hero-patterns-20260420.md §3).
  return (
    <View style={styles.screen}>
      <HomeBackdrop card={showcase.current} browseState={browseState} />

      {/* The hero slide layer sits ABOVE the ambient backdrop and BELOW the
          ScrollView: it pages the hero art + copy with an Apple-TV slide while
          the in-flow action row paints on top. It fades out when a rail is
          focused (browseState "deep") so the backdrop's rail-card art shows. */}
      <HeroPager
        slides={model.featured}
        index={heroIndex}
        direction={heroDirection}
        visible={browseState !== "deep"}
      />

      {/* scrollEnabled={false}: ALL scrolling on this screen is
          row-anchored and programmatic (scrollTo/scrollToEnd below). The
          native tvOS focus-scroll must stay off — row-0 card labels sit at
          the viewport's bottom edge, so UIKit's scroll-into-view nudges the
          feed down on every horizontal focus move within the first rail,
          landing after (and overriding) this screen's scrollTo(0). */}
      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        stickyHeaderIndices={[0]}
        scrollEnabled={false}
      >
        <View>{topBar}</View>

        {/* The hero is a focusable carousel (replaces the passive billboard +
            the old featured rail). It owns the curated hero set; section rails
            below stay at rowIndex 1..n and anchor-scroll up on focus.

            The guide bridges D-pad DOWN from the centered top bar tabs into the
            hero: the hero's only focusables (See more + chevron) are
            left-anchored, so Down from a centered tab has no horizontal
            projection overlap and geometry falls straight through to the first
            rail. nextFocusDown set on the tabs can't fix it — they live in the
            sticky header, whose re-parented children drop nextFocus hints. This
            is the app's established offset-focus bridge (see MissionSection):
            a Down-entry into the hero region redirects to the See more CTA. */}
        <View onLayout={rowLayoutHandlers[0]}>
          <TVFocusGuideView
            autoFocus
            destinations={ctaNode != null ? [ctaNode] : undefined}
          >
            <HomeHeroCarousel
              slides={model.featured}
              index={heroIndex}
              hasTVPreferredFocus
              onSelect={handleCardPress}
              onFocusChange={handleHeroFocusChange}
              onRequestAdvance={advanceHero}
              onCtaNode={setCtaNode}
              upFocusTarget={searchTabNode}
            />
          </TVFocusGuideView>
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
              // The topmost rail (sectionIndex 0) sits under the hero, whose CTA
              // is on the LEFT — wire every card's D-pad-up to the CTA node
              // rather than letting geometry dead-end under the artwork.
              upFocusTarget={sectionIndex === 0 ? ctaNode : undefined}
              // ...and restore its LAST-focused card when focus re-enters from
              // ABOVE (Down off the hero CTA), but NOT when it re-enters from a
              // rail BELOW — belowTopmost gates autoFocus off in that case so
              // Up-from-below keeps the focus engine's column-preserving
              // geometry instead of snapping to the remembered card.
              restoreLastFocus={sectionIndex === 0 && !belowTopmost}
              // Phase 2: only rails within the window around the focused row
              // mount their cards; the rest render a same-height spacer.
              active={isRailActive(
                sectionIndex + 1,
                focusedRow,
                RAIL_WINDOW_BUFFER,
              )}
            />
          </View>
        ))}

        {/* Mission tail (R15): storytelling cards + beta-signup QR close the
            feed. Its QR wrapper is focusable but non-actioning, and never
            dispatches card-focus — the showcase retains the last card (R10)
            and the browse state stays "deep" while the tail is explored. */}
        <MissionSection onQrFocus={handleMissionFocus} />
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
