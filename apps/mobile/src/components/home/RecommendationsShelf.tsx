/**
 * The Recommended for You row (feat-517). A thin renderer: Home's controller
 * owns the slate, and this row reports its first mount, draws the served items
 * as landscape cards, records one render fact per item, and opens a tapped
 * video in the same tick as the selection call (KTD3, KTD6).
 */
import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import {
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useRouter } from "expo-router"

import { useTypography } from "../../hooks/useTypography"
import {
  isSlateExpired,
  type UserRecommendationItem,
  type UserRecommendationSlate,
} from "../../lib/recommendations/delivery"
import type { SelectionResult } from "../../lib/recommendations/selection"
import type { UserRecommendationsStatus } from "../../hooks/useUserRecommendations"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { encodeWatchSeed } from "../../lib/watchSeed"
import { carousel, layout, text, CARD_GAP } from "../../styles/shared"
import { HomeCard, homeCardHeight, homeCardWidth } from "./HomeCard"

// ── Constants ───────────────────────────────────────────────────────────────

/** R4: the app's own string. The block's authored title is not read (KD8). */
export const RECOMMENDATIONS_SHELF_TITLE = "Recommended for You"

/** R6: a slate of any other length is a fault and renders no cards. */
export const RECOMMENDATIONS_SHELF_ITEM_COUNT = 6

/** Stable, low-cardinality RUM action name for this row's cards (KTD8). */
export const RECOMMENDATION_CARD_ACTION_NAME = "recommendation-card"

/** Mirrors `text.sectionHeadingPadded`'s own `marginBottom`. */
const HEADING_MARGIN_BOTTOM = 12

// ── Types ───────────────────────────────────────────────────────────────────

export type RecommendationsShelfProps = {
  status: UserRecommendationsStatus
  /** The slate on display: the last served one, held across a refetch (R18). */
  slate: UserRecommendationSlate | null
  /** Home's focus flag: render facts wait for focus (KTD3). */
  focused: boolean
  /** True while the row is within the viewport; U4 drives it for real. */
  inView: boolean
  onShelfMount: () => void
  onRecordRender: (itemId: string) => void
  onSelect: (itemId: string) => Promise<SelectionResult | null>
  onRefresh: () => void
}

// ── Pure seams ──────────────────────────────────────────────────────────────

/**
 * The height the row reserves while it has no cards, from the same constants
 * its real cards render with, so a served slate lands without a layout jump.
 */
export function recommendationsShelfBodyHeight(
  screenWidth: number,
  headingLineHeight: number,
): number {
  return (
    headingLineHeight +
    HEADING_MARGIN_BOTTOM +
    homeCardHeight("landscape", screenWidth)
  )
}

/**
 * The served items to draw, or null when there is nothing to draw. A slate of
 * the wrong length is re-checked here as well as in `validateServedSlate`:
 * that predicate is the only bound on what reaches this row (R6).
 */
export function recommendationsShelfCards(
  slate: UserRecommendationSlate | null,
): UserRecommendationItem[] | null {
  if (slate == null) return null
  if (slate.items.length !== RECOMMENDATIONS_SHELF_ITEM_COUNT) return null
  return [...slate.items].sort((left, right) => left.position - right.position)
}

/** R8: a terminal non-served outcome collapses once the row leaves the view. */
export function recommendationsShelfCollapsed(
  status: UserRecommendationsStatus,
  inView: boolean,
): boolean {
  const awaitingSlate = status === "idle" || status === "loading"
  return !awaitingSlate && !inView
}

/** The recommendation item as the Home card presentation consumes it (R10). */
export function recommendationCardModel(
  item: UserRecommendationItem,
): WatchHomeCard {
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

// ── Component ───────────────────────────────────────────────────────────────

export const RecommendationsShelf = memo(function RecommendationsShelf({
  status,
  slate,
  focused,
  inView,
  onShelfMount,
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

  // Card model and press handler are built once per slate, so a row re-render
  // that changes neither leaves every card's memo intact.
  const rows = useMemo(
    () =>
      (items ?? []).map((item) => ({
        id: item.id,
        card: recommendationCardModel(item),
        press: () => handleSelect(item),
      })),
    [items, handleSelect],
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

  if (items == null) {
    if (recommendationsShelfCollapsed(status, inView)) return null
    return (
      <View style={[layout.sectionOuter, styles.localContainer]}>
        <View
          style={{
            height: recommendationsShelfBodyHeight(
              screenWidth,
              typography.titleSmall.lineHeight,
            ),
          }}
        />
      </View>
    )
  }

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      <Text
        style={[text.sectionHeadingPadded, typography.titleSmall]}
        accessibilityRole="header"
      >
        {RECOMMENDATIONS_SHELF_TITLE}
      </Text>
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
})
