/**
 * The Recommended for You row (feat-517). A thin renderer: Home's controller
 * owns the slate, and this row reports its first mount, shows its title over a
 * pulsing skeleton until the slate lands, draws the served items as landscape
 * cards, records one render fact per item, and opens a tapped video in the same
 * tick as the selection call (KTD3, KTD6).
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import {
  Animated,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useRouter } from "expo-router"

import { useGuardedViewabilityCallback } from "../../hooks/useGuardedViewabilityCallback"
import { useShimmerOpacity } from "../../hooks/useShimmerOpacity"
import { useTypography } from "../../hooks/useTypography"
import {
  isSlateExpired,
  type UserRecommendationItem,
  type UserRecommendationSlate,
} from "../../lib/recommendations/delivery"
import { IMPRESSION_VIEWABILITY_CONFIG } from "../../lib/recommendations/impressionDwell"
import type { SelectionResult } from "../../lib/recommendations/selection"
import type { UserRecommendationsStatus } from "../../hooks/useUserRecommendations"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { USER_RECOMMENDATION_DEFAULT_COUNT } from "../../lib/recommendations/operations"
import { encodeWatchSeed } from "../../lib/watchSeed"
import {
  card as cardStyle,
  carousel,
  layout,
  text,
  CARD_GAP,
} from "../../styles/shared"
import { HomeCard, homeCardHeight, homeCardWidth } from "./HomeCard"

// ── Constants ───────────────────────────────────────────────────────────────

/** R4: the app's own string. The block's authored title is not read (KD8). */
export const RECOMMENDATIONS_SHELF_TITLE = "Recommended for You"

/** What a screen reader hears while the skeleton pulses. */
export const RECOMMENDATIONS_SHELF_LOADING_LABEL = "Loading recommendations"

export const RECOMMENDATIONS_SKELETON_CARD_TEST_ID =
  "recommendations-skeleton-card"

/** One full card and the next one's peek, as the served carousel opens. */
const SKELETON_CARD_COUNT = 2

/** R6: the count the controller requests; any other length renders no cards. */
const RECOMMENDATIONS_SHELF_ITEM_COUNT = USER_RECOMMENDATION_DEFAULT_COUNT

/** Stable, low-cardinality RUM action name for this row's cards (KTD8). */
export const RECOMMENDATION_CARD_ACTION_NAME = "recommendation-card"

// ── Types ───────────────────────────────────────────────────────────────────

export type RecommendationsShelfProps = {
  status: UserRecommendationsStatus
  /** The slate on display: the last served one, held across a refetch (R18). */
  slate: UserRecommendationSlate | null
  /** Home's focus flag: render facts wait for focus (KTD3). */
  focused: boolean
  onShelfMount: () => void
  /** The card ids this row's own list reports at least half visible (KTD4). */
  onCardsVisible: (itemIds: readonly string[]) => void
  /** The row is leaving the tree, so every card signal drops (KTD4). */
  onDetached: () => void
  onRecordRender: (itemId: string) => void
  onSelect: (itemId: string) => Promise<SelectionResult | null>
  onRefresh: () => void
}

// ── Pure seams ──────────────────────────────────────────────────────────────

/**
 * The served items to draw, or null when there is nothing to draw. A slate of
 * the wrong length is re-checked here as well as in `validateServedSlate`:
 * that predicate is the only bound on what reaches this row (R6).
 */
function recommendationsShelfCards(
  slate: UserRecommendationSlate | null,
): UserRecommendationItem[] | null {
  if (slate == null) return null
  if (slate.items.length !== RECOMMENDATIONS_SHELF_ITEM_COUNT) return null
  return [...slate.items].sort((left, right) => left.position - right.position)
}

function awaitingSlate(status: UserRecommendationsStatus): boolean {
  return status === "idle" || status === "loading"
}

/**
 * A failed load hides the whole row at once, even on screen (decided
 * 2026-09-24). Not `served`: that lands one commit before its slate does.
 */
function recommendationsShelfHidden(
  status: UserRecommendationsStatus,
): boolean {
  return (
    status === "unavailable" ||
    status === "disabled" ||
    status === "unprovisioned"
  )
}

/** The recommendation item as the Home card presentation consumes it (R10). */
function recommendationCardModel(item: UserRecommendationItem): WatchHomeCard {
  return {
    id: item.id,
    // KTD8: the progress bar is keyed on the Admin video id.
    videoId: item.targetMediaId,
    sourceId: "recommendations",
    coreId: item.targetMediaId,
    slug: item.videoSlug,
    title: item.videoTitle,
    description: item.description.length > 0 ? item.description : null,
    label: "",
    rawLabel: null,
    metaLabel: null,
    imageUrl: item.imageUrl,
    imageAlt: item.videoTitle,
    playbackId: null,
    durationSeconds: item.durationSeconds,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
  }
}

// ── Skeleton ────────────────────────────────────────────────────────────────

/**
 * Card-sized stand-ins in the served row's own layout, so the swap to real
 * cards moves nothing (R8). Only a pulsing skeleton reports a load.
 */
function RecommendationsShelfSkeleton({
  pulsing,
  screenWidth,
}: {
  pulsing: boolean
  screenWidth: number
}) {
  const opacity = useShimmerOpacity(pulsing)
  const size = {
    width: homeCardWidth("landscape", screenWidth),
    height: homeCardHeight("landscape", screenWidth),
  }
  return (
    <View
      style={[carousel.listContent, styles.skeletonRow]}
      accessible={pulsing}
      accessibilityRole={pulsing ? "progressbar" : undefined}
      accessibilityLabel={
        pulsing ? RECOMMENDATIONS_SHELF_LOADING_LABEL : undefined
      }
      accessibilityElementsHidden={!pulsing}
      importantForAccessibility={pulsing ? "yes" : "no-hide-descendants"}
    >
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <Animated.View
          key={index}
          testID={RECOMMENDATIONS_SKELETON_CARD_TEST_ID}
          style={[cardStyle.surface, size, { opacity }]}
        />
      ))}
    </View>
  )
}

// ── Component ───────────────────────────────────────────────────────────────

export const RecommendationsShelf = memo(function RecommendationsShelf({
  status,
  slate,
  focused,
  onShelfMount,
  onCardsVisible,
  onDetached,
  onRecordRender,
  onSelect,
  onRefresh,
}: RecommendationsShelfProps) {
  const typography = useTypography()
  const router = useRouter()
  const { width: screenWidth } = useWindowDimensions()
  const cardWidth = homeCardWidth("landscape", screenWidth)

  // R7: FlashList mounts this row within its draw distance, so the first mount
  // is the deferred-fetch signal. Home owns the latch, this only reports.
  useEffect(() => {
    onShelfMount()
  }, [onShelfMount])

  const items = useMemo(() => recommendationsShelfCards(slate), [slate])
  const itemIds = useMemo(() => (items ?? []).map((entry) => entry.id), [items])

  // ── Card visibility (KTD4) ────────────────────────────────────────────────

  const itemIdsRef = useRef(itemIds)
  itemIdsRef.current = itemIds
  const visibleIndicesRef = useRef<number[]>([])
  const onCardsVisibleRef = useRef(onCardsVisible)
  onCardsVisibleRef.current = onCardsVisible
  const onDetachedRef = useRef(onDetached)
  onDetachedRef.current = onDetached

  // `null` keeps the indices the list last reported and maps them onto the
  // current slate. Guarded, because the two effects below call it outside any
  // list, where a throw would reach Home's own commit.
  const reportCards = useGuardedViewabilityCallback<readonly number[] | null>(
    "recommendations_row",
    (indices) => {
      if (indices != null) visibleIndicesRef.current = [...indices]
      onCardsVisibleRef.current(
        visibleIndicesRef.current
          .map((index) => itemIdsRef.current[index])
          .filter((itemId): itemId is string => itemId != null),
      )
    },
  )

  const handleViewableItemsChanged = useGuardedViewabilityCallback<{
    viewableItems: { index: number | null }[]
  }>("recommendations_row", ({ viewableItems }) =>
    reportCards(
      viewableItems
        .map((entry) => entry.index)
        .filter((index): index is number => index != null),
    ),
  )

  useEffect(() => {
    // Setup restores what the cleanup drops: a dev StrictMode cycle runs both
    // on this same instance, and the row's card signals must survive it.
    reportCards(null)
    return () => onDetachedRef.current()
  }, [reportCards])

  // Neither list recomputes viewability without a scroll or a layout change,
  // so the cards of a slate that lands under an unmoved row report themselves.
  useEffect(() => {
    reportCards(null)
  }, [itemIds, reportCards])

  // R11: one render fact per item per slate, and never while Home is blurred.
  const reportedRequestRef = useRef<string | null>(null)
  useEffect(() => {
    if (items == null || slate == null || !focused) return
    if (reportedRequestRef.current === slate.requestId) return
    reportedRequestRef.current = slate.requestId
    for (const item of items) onRecordRender(item.id)
  }, [items, slate, focused, onRecordRender])

  const handleSelect = useCallback(
    (item: UserRecommendationItem) => {
      // KTD6/AE6: the displayed slate's own deadline decides, never a null
      // return — the hook returns null for four different reasons.
      if (slate != null && isSlateExpired(slate)) onRefresh()
      else void onSelect(item.id)
      const seed = encodeWatchSeed({
        slug: item.videoSlug,
        title: item.videoTitle,
        imageUrl: item.imageUrl,
        playbackId: null,
      })
      // navigate, not push: a double-tap must not stack two watch screens.
      router.navigate(
        `/watch/${encodeURIComponent(item.videoSlug)}?seed=${seed}`,
      )
    },
    [slate, onSelect, onRefresh, router],
  )

  // Card models and press closures are built once per slate and read the
  // latest handler through a ref, so a refetch's `select` identity churn
  // leaves every card's memo intact (R18).
  const handleSelectRef = useRef(handleSelect)
  handleSelectRef.current = handleSelect
  const rows = useMemo(
    () =>
      (items ?? []).map((item) => ({
        id: item.id,
        card: recommendationCardModel(item),
        press: () => handleSelectRef.current(item),
      })),
    [items],
  )

  const renderItem = useCallback(
    ({ item: row }: { item: (typeof rows)[number] }) => (
      <HomeCard
        card={row.card}
        variant="landscape"
        onPressOverride={row.press}
        actionName={RECOMMENDATION_CARD_ACTION_NAME}
      />
    ),
    [],
  )

  // One heading for both branches, so the placeholder cannot drift from it.
  const heading = (
    <Text
      style={[text.sectionHeadingPadded, typography.titleSmall]}
      accessibilityRole="header"
    >
      {RECOMMENDATIONS_SHELF_TITLE}
    </Text>
  )

  if (items == null) {
    if (recommendationsShelfHidden(status)) return null
    return (
      <View style={[layout.sectionOuter, styles.localContainer]}>
        {heading}
        <RecommendationsShelfSkeleton
          // A deep link mounts Home unfocused and idle for the whole watch
          // session; the loop must not run behind the player all that time.
          pulsing={awaitingSlate(status) && focused}
          screenWidth={screenWidth}
        />
      </View>
    )
  }

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      {heading}
      <FlatList
        data={rows}
        renderItem={renderItem}
        keyExtractor={(row) => row.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={carousel.listContent}
        snapToInterval={cardWidth + CARD_GAP}
        snapToAlignment="start"
        decelerationRate="fast"
        onViewableItemsChanged={handleViewableItemsChanged}
        viewabilityConfig={IMPRESSION_VIEWABILITY_CONFIG}
        accessibilityLabel={`${items.length} items in ${RECOMMENDATIONS_SHELF_TITLE}`}
      />
    </View>
  )
})

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  localContainer: {
    paddingVertical: 8,
  },
  skeletonRow: {
    flexDirection: "row",
    overflow: "hidden",
  },
})
