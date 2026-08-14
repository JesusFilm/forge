import { useFocusEffect, usePathname, useRouter } from "expo-router"
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"
import {
  Platform,
  ScrollView,
  StyleSheet,
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
import { resolveHomeRailVariant } from "../src/components/home/homeRailVariant"
import { HomeSkeleton } from "../src/components/home/HomeSkeleton"
import { ScreenStateView } from "../src/components/ScreenStateView"
import { isRailActive } from "../src/components/home/homeRailWindow"
import {
  isTopBarHidden,
  resolveBrowseState,
  resolveRowMeasurementEffect,
  resolveRowScrollTarget,
  ROW_ANCHOR_OFFSET,
  trimRowMeasurements,
  type HomeBrowseState,
} from "../src/components/home/homeScrollState"
import { HomeTopBar } from "../src/components/home/HomeTopBar"
import {
  CONTINUE_WATCHING_SECTION_ID,
  buildContinueWatchingSection,
} from "../src/components/home/continueWatchingSection"
import { isProfileSurfaceEnabled } from "../src/lib/auth/profileFlag"
import {
  loadContinueWatching,
  type ContinueWatchingEntry,
} from "../src/lib/watchEvents/continueWatching"
import { removeFromContinueWatching } from "../src/lib/watchEvents/watchProgressSync"
import { MissionSection } from "../src/components/home/MissionSection"
import { TVFocusGuideView } from "../src/components/TVFocusGuideView"
import {
  createFocusMemory,
  type FocusMemory,
} from "../src/components/home/focusMemory"
import { datadogLog } from "../src/lib/datadog"
import {
  createShowcaseFocusDebouncer,
  INITIAL_SHOWCASE_STATE,
  showcaseReducer,
  type ShowcaseFocusDebouncer,
} from "../src/components/home/showcaseState"
import { WATCH_THEME } from "../src/components/watch/watchDetailTheme"
import { useWatchHome } from "../src/hooks/useWatchHome"
import { shouldAutoStartShowcase } from "../src/lib/showcaseMode/exitClassification"
import {
  SHOWCASE_AUTO_SOURCE,
  SHOWCASE_SOURCE_PARAM,
} from "../src/lib/showcaseMode/showcaseTelemetry"
import { useShowcasePrefs } from "../src/lib/showcaseMode/useShowcasePrefs"
import { scale } from "../src/lib/scale"
import { resolveHomeScreenState } from "../src/lib/watchHome/homeScreenState"
import type { WatchHomeCard } from "../src/lib/watchHome/model"

/**
 * Forge TV Home redesign: curated watch-home set (useWatchHome lean fetch, R8)
 * over ambient backdrop + non-interactive billboard hero + top bar; rails drive
 * showcase + browse (R10/R11). Only this screen left SDUI; /experience/[slug] still uses it (R9).
 */
// Image-windowing: rails within BUFFER rows of the focused row load their card
// images; cards outside still mount (focus-safe) but skip the decode. 2 keeps a
// neighbour warm in each direction without decoding the whole feed at once.
const RAIL_WINDOW_BUFFER = 2

// All home perf optimizations (image-windowing, row-change scroll gating) are
// Android-only. Apple TV had no perf problem and stays on its original eager
// path — every gated branch below restores main's behavior.
const IS_ANDROID = Platform.OS === "android"

// AE3 is "once per LAUNCH", so the latch outlives this component. A mount-scoped ref
// would re-arm when Home remounts beneath a viewer who just exited the reel and bounce
// them straight back into it — the trap R12 forbids.
let autoStartConsumed = false

export default function HomeScreen() {
  const router = useRouter()
  const { model, loading, error, refetch } = useWatchHome()

  // Continue Watching shelf (feat-322): reloaded on every screen focus so
  // returning from playback shows the fresh resume position immediately.
  const [continueEntries, setContinueEntries] = useState<
    ContinueWatchingEntry[]
  >([])
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      void loadContinueWatching().then((entries) => {
        if (!cancelled) setContinueEntries(entries)
      })
      return () => {
        cancelled = true
      }
    }, []),
  )
  // Client-owned section spliced ABOVE the curated sections (Netflix places
  // Continue Watching among the top rows); empty shelf renders nothing.
  const renderSections = useMemo(() => {
    if (model == null) return null
    const continueSection = buildContinueWatchingSection(continueEntries)
    return continueSection
      ? [continueSection, ...model.sections]
      : model.sections
  }, [model, continueEntries])

  // tvos#852: a stack pop doesn't restore the previously focused view (falls to
  // the top-left default). Remember the focused node (every focusable reports it)
  // and re-focus it on re-entry — subsumes the old back-from-/search restore.
  const focusMemoryRef = useRef<FocusMemory | null>(null)
  if (focusMemoryRef.current == null) {
    focusMemoryRef.current = createFocusMemory()
  }
  const captureFocusedNode = useCallback((node: ViewType | null) => {
    focusMemoryRef.current?.capture(node)
  }, [])

  // Restore only on a genuine re-entry, not first mount (hero's hasTVPreferredFocus
  // owns initial focus) — a prior blur proves re-entry. rAF defers past the pop's
  // commit so the target node is mounted before we focus it.
  const hasBlurredRef = useRef(false)
  useFocusEffect(
    useCallback(() => {
      let raf: number | null = null
      if (hasBlurredRef.current) {
        raf = requestAnimationFrame(() => {
          // A false restore on genuine re-entry (hasBlurredRef) means the
          // remembered node was lost — a real focus fault, not first-mount.
          const restored = focusMemoryRef.current?.restore()
          if (restored === false) datadogLog.warn("focus.restore_failed")
        })
      }
      return () => {
        if (raf != null) cancelAnimationFrame(raf)
        hasBlurredRef.current = true
      }
    }, []),
  )

  // R13: an office TV that power-cycles recovers without a remote. Gated on `hydrated`
  // because the pre-hydration default reads as off, and on the ACTIVE path so a deep
  // link keeps the route it asked for. A brief Home flash is the accepted cost.
  const { prefs: showcasePrefs, hydrated: showcasePrefsHydrated } =
    useShowcasePrefs()
  const activePath = usePathname()
  useEffect(() => {
    if (
      !shouldAutoStartShowcase({
        hydrated: showcasePrefsHydrated,
        autoStartEnabled: showcasePrefs.autoStart,
        alreadyStarted: autoStartConsumed,
        activePath,
      })
    ) {
      return
    }
    autoStartConsumed = true
    // Stamped so RUM can separate an unattended recovery from a human start (AE3).
    router.push(`/showcase?${SHOWCASE_SOURCE_PARAM}=${SHOWCASE_AUTO_SOURCE}`)
  }, [showcasePrefsHydrated, showcasePrefs.autoStart, activePath, router])

  // ── Showcase state ── First model seeds; refetches re-reconcile, keeping the
  // current pick if its id survives. Only CARDS dispatch focus, so it retains
  // across non-card focus (AE4) and stack push/pop; drives billboard + backdrop.
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

  // Also cancel a pending commit when the screen loses focus, not just on
  // unmount — else a debounce armed before navigating away fires ~150ms later
  // into backgrounded Home and commits a stale showcase card.
  useFocusEffect(
    useCallback(() => () => focusDebouncerRef.current?.cancel(), []),
  )

  const handleCardFocus = useCallback(
    (card: WatchHomeCard, node: ViewType | null) => {
      captureFocusedNode(node)
      focusDebouncerRef.current?.focus(card)
    },
    [captureFocusedNode],
  )

  // ── Browse state + row-anchored scrolling ── Focused row → top|browse|deep
  // (homeScrollState.ts) drives deep scrim + top bar hide. Scroll is row-anchored
  // via each shelf's onLayout y, immediate (not debounced) to track traversal.
  const [browseState, setBrowseState] = useState<HomeBrowseState>("top")
  // Image-windowing: the row that holds focus (hero / top bar = 0). Drives which
  // rails load card images (isRailActive); cards always mount so focus is safe.
  const [focusedRow, setFocusedRow] = useState(0)
  const scrollRef = useRef<ScrollView | null>(null)
  const rowYsRef = useRef<number[]>([])
  // If a row is focused before onLayout measures its y (cold paint / refetch
  // remount), resolveRowScrollTarget returns null and (focus-scroll off) the card
  // strands off-screen. Stash the row; recordRowY fires the scroll on onLayout.
  const pendingScrollRowRef = useRef<number | null>(null)
  // Last focused row, so handleRowFocus fires only on a real row TRANSITION
  // (within-row horizontal moves skip the redundant scroll). Reset to null when
  // focus leaves the rails so re-entering a row re-applies its scroll state.
  const lastFocusedRowRef = useRef<number | null>(null)
  // Row that currently holds focus, tracked on BOTH platforms — unlike the
  // Android-only dedupe gate above — so recordRowY can re-anchor when a
  // re-measure moves the focused row out from under the current offset.
  const focusedRowRef = useRef<number | null>(null)
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

  const handleRowFocus = useCallback(
    (rowIndex: number) => {
      // Android only: gate on a real row change so within-row horizontal moves
      // skip the redundant scroll. tvOS keeps main's behavior (fires every move).
      if (IS_ANDROID) {
        if (lastFocusedRowRef.current === rowIndex) return
        lastFocusedRowRef.current = rowIndex
      }
      focusedRowRef.current = rowIndex
      setBrowseState(resolveBrowseState(rowIndex))
      // Topmost section rail = rowIndex 1; anything >= 2 is a rail below it.
      setBelowTopmost(rowIndex >= 2)
      // Defer if the row's y isn't measured yet; recordRowY flushes it.
      pendingScrollRowRef.current = scrollToRow(rowIndex) ? null : rowIndex
      // Shift the image-window. Immediate + cheap (cards stay mounted; only
      // images toggle), so it can't strand focus or jerk the scroll.
      if (IS_ANDROID) setFocusedRow(rowIndex)
    },
    [scrollToRow],
  )

  const recordRowY = useCallback(
    (rowIndex: number, y: number) => {
      const effect = resolveRowMeasurementEffect({
        rowIndex,
        previousY: rowYsRef.current[rowIndex],
        nextY: y,
        pendingScrollRow: pendingScrollRowRef.current,
        focusedRow: focusedRowRef.current,
      })
      rowYsRef.current[rowIndex] = y
      if (effect === "flush-pending") {
        if (scrollToRow(rowIndex)) pendingScrollRowRef.current = null
      } else if (effect === "reanchor") {
        scrollToRow(rowIndex)
      }
    },
    [scrollToRow],
  )

  // Top bar tab focus: pin to the top state.
  const handleChromeFocus = useCallback(() => {
    if (IS_ANDROID) {
      lastFocusedRowRef.current = null
      setFocusedRow(0)
    }
    focusedRowRef.current = null
    setBrowseState(resolveBrowseState(null))
    setBelowTopmost(false)
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [])

  // Mission-tail QR focus: with the native focus-scroll disabled, the tail
  // needs its own scroll hook — pin to the end in the deep state.
  const handleMissionFocus = useCallback(() => {
    if (IS_ANDROID) {
      lastFocusedRowRef.current = null
      // Center the image-window on the bottom rails so Up from the mission tail
      // returns to a rail whose images are loaded.
      setFocusedRow(sectionCountRef.current)
    }
    focusedRowRef.current = null
    setBrowseState("deep")
    // The mission tail is below the topmost rail — keep its autoFocus OFF so a
    // later Up traversal stays column-preserving.
    setBelowTopmost(true)
    scrollRef.current?.scrollToEnd({ animated: true })
  }, [])

  // Stable per-row onLayout handlers (featured = 0, sections = 1..n) so the
  // memoized rails' wrappers don't churn on every screen re-render.
  const rowCount = (renderSections?.length ?? 0) + 1
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

  // TRIM, never wipe. `sections` is a fresh array on every setModel, and onLayout
  // only fires when geometry actually changes — so wiping left unchanged rows
  // permanently unmeasured and focus scrolled nowhere (the "after a long idle" bug).
  const sections = renderSections
  useEffect(() => {
    trimRowMeasurements(rowYsRef.current, rowCount)
    pendingScrollRowRef.current = null
    // A reshape can land focus on the same row index it held pre-refetch; clear
    // the gate so handleRowFocus re-applies scroll + image-window state.
    lastFocusedRowRef.current = null
  }, [sections, rowCount])

  // Shape-based routing (R13): series-shaped → /series, leaf → /watch, both
  // seeded for instant first paint. Null path (no slug) is a no-op press.
  const handleCardPress = useCallback(
    (card: WatchHomeCard) => {
      const path = resolveHomeCardPath(card)
      if (path != null) router.push(path)
    },
    [router],
  )

  // Continue Watching cards go STRAIGHT into playback at the saved position
  // (feat-322) — a viewer resuming should not have to press Play again. Same
  // route as a normal card so the session (dub menu, subtitles, Up Next) is
  // fully wired; the watch screen consumes the flag once it has a variant.
  const handleResumeCardPress = useCallback(
    (card: WatchHomeCard) => {
      const path = resolveHomeCardPath(card, { autoplay: true })
      if (path != null) router.push(path)
    },
    [router],
  )

  // Long-press on a Continue Watching card removes it — locally first (the
  // card disappears whatever the network does), then best-effort from the
  // account. The shelf state refreshes from storage so the rail re-renders
  // without waiting for the next focus pass.
  const handleResumeCardLongPress = useCallback((card: WatchHomeCard) => {
    void removeFromContinueWatching(card.sourceId).then(() =>
      loadContinueWatching().then(setContinueEntries),
    )
  }, [])

  const handleSearchPress = useCallback(() => {
    router.push("/search")
  }, [router])

  const handleSettingsPress = useCallback(() => {
    router.push("/settings")
  }, [router])

  const handleProfilePress = useCallback(() => {
    router.push("/profile")
  }, [router])

  // True when the focused element is a rail BELOW the topmost. Gates the topmost
  // rail's autoFocus: ON from topmost/hero CTA/top bar (track + restore last card
  // for Down off CTA), OFF coming Up from below (keep column-preserving geometry).
  const [belowTopmost, setBelowTopmost] = useState(false)

  // Hero paging: the screen owns the active index so HeroPager and the carousel
  // dots stay in lockstep (chevron/auto-advance request, pager slides). Hero art
  // no longer drives the backdrop — the pager covers it; backdrop is rail-browse.
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
  const handleHeroFocusChange = useCallback((isFocused: boolean) => {
    if (!isFocused) return
    if (IS_ANDROID) {
      lastFocusedRowRef.current = null
      setFocusedRow(0)
    }
    focusedRowRef.current = null
    setBelowTopmost(false)
    setBrowseState("browse")
    scrollRef.current?.scrollTo({ y: 0, animated: true })
  }, [])

  // Hero CTA's native node — the D-pad-up destination for EVERY first-rail card
  // (so Up never dead-ends under the hero art), and the hero TVFocusGuideView's
  // destination so Down from the top bar tabs lands on See more.
  const [ctaNode, setCtaNode] = useState<ViewType | null>(null)

  // Top bar Search tab's native node — D-pad-up destination for both hero action
  // buttons. The centered tabs don't overlap the left-anchored hero row, so Up
  // would dead-end without it (mirrors ctaNode's job for the rail).
  const [searchTabNode, setSearchTabNode] = useState<ViewType | null>(null)

  // The top bar (Search/Home/Settings tabs · clock), rendered in every state
  // (loading/error/empty too) so Search stays reachable while the model resolves;
  // in the content state it is the ScrollView's sticky first child.
  const topBar = (
    <HomeTopBar
      hidden={isTopBarHidden(browseState)}
      onSearchPress={handleSearchPress}
      onSettingsPress={handleSettingsPress}
      onProfilePress={
        isProfileSurfaceEnabled() ? handleProfilePress : undefined
      }
      onChromeFocus={handleChromeFocus}
      onSearchTabNode={setSearchTabNode}
      onFocusNode={captureFocusedNode}
    />
  )

  const screenState = resolveHomeScreenState({ model, loading, error })

  // ── Loading state (no model yet — initial load or a retry) ──
  if (screenState === "loading") {
    // Non-focusable skeleton (KTD2): no focus claim, so the hero's
    // hasTVPreferredFocus takes over when the content branch mounts. Shown only
    // when model == null (cold load); a warm re-entry skips straight to content.
    return (
      <View style={styles.screen}>
        {topBar}
        <HomeSkeleton />
      </View>
    )
  }

  // ── Error state — only when nothing is renderable (R16): a stale model
  // beats an error screen, so refetch failures fall through to content. ──
  if (screenState === "error") {
    return (
      <View style={styles.screen}>
        {topBar}
        <ScreenStateView
          kind="error"
          message="Something went wrong"
          detail={error}
          onRetry={refetch}
          retryHint="Reloads the home feed"
        />
      </View>
    )
  }

  // ── Empty state (no model, or a model with zero cards) ── `model == null` is
  // redundant with screenState === "empty" (returns above cover other model-less
  // states) but narrows `model` to non-null for the content branch below.
  if (screenState === "empty" || model == null) {
    return (
      <View style={styles.screen}>
        {topBar}
        <ScreenStateView kind="empty" message="No content available" />
      </View>
    )
  }

  // ── Content ── Non-focusable backdrop behind ONE ScrollView whose sticky first child is
  // the top bar: tvOS focus can't cross a parent-View boundary, so tab↔rail traversal needs
  // them as siblings in one scroll container (R14/AE6). Fallback if flaky: TVFocusGuideView destinations (tv-focus-driven-hero-patterns-20260420.md §3).
  return (
    <View style={styles.screen}>
      <HomeBackdrop card={showcase.current} browseState={browseState} />

      {/* Hero slide layer: above the backdrop, below the ScrollView. Pages hero
          art + copy with an Apple-TV slide while the in-flow action row paints on
          top; fades out in "deep" so the backdrop's rail-card art shows. */}
      <HeroPager
        slides={model.featured}
        index={heroIndex}
        direction={heroDirection}
        visible={browseState !== "deep"}
      />

      {/* scrollEnabled={false}: all scrolling is row-anchored + programmatic.
          Native tvOS focus-scroll must stay off — row-0 labels sit at the viewport
          bottom, so its scroll-into-view nudges the feed and overrides scrollTo(0). */}
      <ScrollView
        ref={scrollRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        stickyHeaderIndices={[0]}
        scrollEnabled={false}
        // Android only: skip drawing rails scrolled off-screen so a vertical
        // move only composites the visible rails. The row-anchored scroll keeps
        // the focused content on-screen, so focusables are never clipped.
        removeClippedSubviews={IS_ANDROID}
      >
        <View>{topBar}</View>

        {/* Focusable hero carousel; section rails stay at rowIndex 1..n. The guide bridges
            D-pad DOWN from the centered top bar tabs into the left-anchored hero CTA — geometry
            falls through to the first rail otherwise, and nextFocusDown can't fix it (sticky-header children drop nextFocus hints; see MissionSection's offset-focus bridge). */}
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
              onFocusNode={captureFocusedNode}
            />
          </TVFocusGuideView>
        </View>

        {(renderSections ?? []).map((section, sectionIndex) => (
          <View key={section.id} onLayout={rowLayoutHandlers[sectionIndex + 1]}>
            <HomeRail
              rowIndex={sectionIndex + 1}
              eyebrow={section.eyebrow}
              title={section.title}
              cards={section.cards}
              variant={resolveHomeRailVariant(section)}
              onCardFocus={handleCardFocus}
              onRowFocus={handleRowFocus}
              onCardPress={
                section.id === CONTINUE_WATCHING_SECTION_ID
                  ? handleResumeCardPress
                  : handleCardPress
              }
              onCardLongPress={
                section.id === CONTINUE_WATCHING_SECTION_ID
                  ? handleResumeCardLongPress
                  : undefined
              }
              // The topmost rail (sectionIndex 0) sits under the hero, whose CTA
              // is on the LEFT — wire every card's D-pad-up to the CTA node
              // rather than letting geometry dead-end under the artwork.
              upFocusTarget={sectionIndex === 0 ? ctaNode : undefined}
              // ...and restore its last-focused card on re-entry from ABOVE (Down
              // off the CTA), but NOT from a rail BELOW: belowTopmost gates autoFocus
              // off so Up-from-below keeps column-preserving geometry.
              restoreLastFocus={sectionIndex === 0 && !belowTopmost}
              // Android only: load images for rails in the focus window (cards
              // always mount). tvOS loads every rail's images (true) — main.
              active={
                IS_ANDROID
                  ? isRailActive(
                      sectionIndex + 1,
                      focusedRow,
                      RAIL_WINDOW_BUFFER,
                    )
                  : true
              }
            />
          </View>
        ))}

        {/* Mission tail (R15): storytelling cards + beta-signup QR. Its QR wrapper
            is focusable but non-actioning and never dispatches card-focus — the
            showcase keeps the last card (R10) and browse state stays "deep". */}
        <MissionSection
          onQrFocus={handleMissionFocus}
          onFocusNode={captureFocusedNode}
        />
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
  list: {
    flex: 1,
  },
  listContent: {
    // Breathing room below the mission tail.
    paddingBottom: scale(80),
  },
  // ── Error state ──
  // ── Empty state ──
})
