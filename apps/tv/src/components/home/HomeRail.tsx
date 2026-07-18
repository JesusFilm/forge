// One curated Home section as a horizontal D-pad rail (R11/R12): eyebrow +
// title over a FlatList of HomeCards. Fixed card dims → getItemLayout; empty
// sections render nothing; onRowFocus reports the focused row for scroll anchoring.

import { memo, useCallback, useMemo, useState } from "react"
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type View as ViewType,
} from "react-native"

import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import {
  HOME_CARD_DIMS,
  HOME_CARD_WIDTH,
  HomeCard,
  type HomeCardVariant,
} from "./HomeCard"
import { buildRailItems, type RailItem } from "./homeRailItems"
import {
  BASE_ITEM_PADDING,
  railPaddingTopFor,
  railPullUpFor,
} from "./homeRailHeadroom"

// Skeleton mirrors the resting head→cards gap through this module's surface.
export { HEAD_CARD_GAP } from "./homeRailHeadroom"

const IS_ANDROID = Platform.OS === "android"

// Android uses a wider gap (same card size) so the rail shows slightly fewer
// cards with more spacing — the user-tuned density. tvOS keeps main's 28.
export const ITEM_GAP = scale(IS_ANDROID ? 48 : 28)
export const RAIL_PADDING_LEFT = scale(80)
/** Landscape column pitch — the default geometry, and the skeleton's. */
export const COLUMN_WIDTH = HOME_CARD_WIDTH + ITEM_GAP

const columnWidthFor = (variant: HomeCardVariant) =>
  HOME_CARD_DIMS[variant].width + ITEM_GAP

function visibleColumnsFor(variant: HomeCardVariant): number {
  return Math.ceil(
    (Dimensions.get("window").width - RAIL_PADDING_LEFT) /
      columnWidthFor(variant),
  )
}

// tvOS treats empty right-hand columns as "nothing there", so a vertical move from
// an over-hanging column SKIPS short rails; pad to this count with invisible
// focusable cards. Per-variant: narrower portrait cards fit more columns.
const VISIBLE_COLUMNS: Record<HomeCardVariant, number> = {
  landscape: visibleColumnsFor("landscape"),
  portrait: visibleColumnsFor("portrait"),
}

const keyExtractor = (item: RailItem, index: number) =>
  item.kind === "card"
    ? `home-card-${item.card.id}-${index}`
    : `home-pad-${index}`

// Fixed card dims → no measuring pass. Last item's length is overstated by
// ITEM_GAP (no trailing gap) — harmless for virtualization/scrollToIndex
// (see EpisodeRail). Built once per variant: the pitch follows the card width.
function makeGetItemLayout(variant: HomeCardVariant) {
  const pitch = columnWidthFor(variant)
  return (_: ArrayLike<RailItem> | null | undefined, index: number) => ({
    length: pitch,
    offset: pitch * index,
    index,
  })
}

const GET_ITEM_LAYOUT: Record<
  HomeCardVariant,
  ReturnType<typeof makeGetItemLayout>
> = {
  landscape: makeGetItemLayout("landscape"),
  portrait: makeGetItemLayout("portrait"),
}

// Top headroom only (geometry model + invariants live in homeRailHeadroom.ts).
// The bottom keeps the base gap: only an extreme diagonal touchpad nudge can
// push a portrait card's text a few pt past it — a transient, accepted clip.
const ITEM_WRAPPER: Record<
  HomeCardVariant,
  { paddingTop: number; paddingBottom: number }
> = StyleSheet.create({
  landscape: {
    paddingTop: railPaddingTopFor(HOME_CARD_DIMS.landscape),
    paddingBottom: BASE_ITEM_PADDING,
  },
  portrait: {
    paddingTop: railPaddingTopFor(HOME_CARD_DIMS.portrait),
    paddingBottom: BASE_ITEM_PADDING,
  },
})

// Headroom beyond the resting gap is carved out of the clip bounds, not the
// layout: pull the list up by the same amount so cards keep the HEAD_CARD_GAP
// seam under the head and the rail's outer height is unchanged.
const RAIL_PULL_UP: Record<HomeCardVariant, { marginTop: number }> =
  StyleSheet.create({
    landscape: { marginTop: railPullUpFor(HOME_CARD_DIMS.landscape) },
    portrait: { marginTop: railPullUpFor(HOME_CARD_DIMS.portrait) },
  })

// react-native-tvos host nodes expose requestTVFocus() (NativeMethods), absent
// from the bundled View type. Encapsulate the cast in one helper so it stays
// out of render code; no-ops safely on a null/detached node.
function requestTVFocus(node: ViewType | null): void {
  ;(node as { requestTVFocus?: () => void } | null)?.requestTVFocus?.()
}

/**
 * Invisible over-hang catcher in the rail's empty right columns. A vertical move landing here bounces
 * focus to the last REAL card via requestTVFocus() (same-rail move works where cross-FlatList nextFocus
 * doesn't). Inert (emits no card/row focus) and non-focusable until the target node is known.
 */
const RailPad = memo(function RailPad({
  targetNode,
  variant,
}: {
  targetNode: ViewType | null
  variant: HomeCardVariant
}) {
  return (
    <Pressable
      focusable={targetNode != null}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onFocus={() => {
        // Bounce focus to the rail's last real card (same-rail move — works
        // where cross-FlatList nextFocus doesn't). Synchronous is reliable
        // here; no defer needed.
        requestTVFocus(targetNode)
      }}
      // Sized to the rail's real cards (per-variant) so its focus frame aligns
      // for vertical geometry. Stays transparent, never opacity:0 — tvOS skips
      // alpha-0 views, which would make it unfocusable and defeat the bounce.
      style={{
        width: HOME_CARD_DIMS[variant].width,
        height: HOME_CARD_DIMS[variant].thumbHeight,
      }}
    />
  )
})

type HomeRailProps = {
  eyebrow: string
  title: string
  cards: WatchHomeCard[]
  /** This rail's position in the feed (featured = 0). */
  rowIndex: number
  /** Re-emits the focused card object plus its native node (closed over
   *  per-card in HomeCard) so the screen can re-focus it after a nav push/pop. */
  onCardFocus: (card: WatchHomeCard, node: ViewType | null) => void
  /** Fires alongside onCardFocus with this rail's rowIndex — drives the
   *  screen's row-anchored scrolling and deep/browse chrome state. */
  onRowFocus?: (rowIndex: number) => void
  onCardPress: (card: WatchHomeCard) => void
  /**
   * D-pad-up destination for this rail's cards. The featured rail passes the
   * Search tab's node so its edge cards reach the top bar; section rails leave
   * it undefined and rely on the full-width rail above them.
   */
  upFocusTarget?: ViewType | null
  /**
   * When true, restores this rail's LAST-focused card on re-entry. Parent gates
   * it on for the topmost rail only when source focus is NOT a rail below, so
   * Down off the hero CTA restores while Up from below stays column-preserving.
   */
  restoreLastFocus?: boolean
  /**
   * Image-windowing (Android): when false (off the focus window), the rail's
   * cards still mount at full size and stay focusable — so D-pad focus never
   * lands on an empty rail — but skip their image decode. The parent keeps the
   * focused row + a buffer of neighbours active. Defaults to true (eager).
   */
  active?: boolean
  /** Card shape; "portrait" when every item has curated 2:3 poster art. Default landscape. */
  variant?: HomeCardVariant
}

export const HomeRail = memo(function HomeRail({
  eyebrow,
  title,
  cards,
  rowIndex,
  onCardFocus,
  onRowFocus,
  onCardPress,
  upFocusTarget,
  restoreLastFocus,
  active = true,
  variant = "landscape",
}: HomeRailProps) {
  // This rail's last real card node — the bounce target for the pad cards.
  // State (not a ref) so the pads re-render with it once it mounts.
  const [lastCardNode, setLastCardNode] = useState<ViewType | null>(null)

  const handleCardFocus = useCallback(
    (card: WatchHomeCard, node: ViewType | null) => {
      onRowFocus?.(rowIndex)
      onCardFocus(card, node)
    },
    [onCardFocus, onRowFocus, rowIndex],
  )

  // Real cards + invisible over-hang pads (see homeRailItems.buildRailItems).
  const items = useMemo(
    () => buildRailItems(cards, VISIBLE_COLUMNS[variant]),
    [cards, variant],
  )

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<RailItem>) => {
      const isLastColumn = index === items.length - 1
      if (item.kind === "pad") {
        return (
          <View
            style={[ITEM_WRAPPER[variant], !isLastColumn && styles.itemGap]}
          >
            <RailPad targetNode={lastCardNode} variant={variant} />
          </View>
        )
      }
      return (
        <View style={[ITEM_WRAPPER[variant], !isLastColumn && styles.itemGap]}>
          {/* HomeCard re-emits its `card` prop from onFocus/onPress —
              never re-index into `data` from an async focus callback
              (the array can shrink under it). */}
          <HomeCard
            card={item.card}
            index={index}
            onFocus={handleCardFocus}
            onPress={onCardPress}
            // Coalesce null -> undefined: a null nextFocusUp (search node not
            // captured yet) should fall back to geometry, not wire to nothing.
            nextFocusUp={upFocusTarget ?? undefined}
            // Capture the last REAL card — the pads' bounce target.
            nodeRef={index === cards.length - 1 ? setLastCardNode : undefined}
            // Off-window rails mount their cards (so focus always has a target)
            // but skip the image decode — that's the image-window perf win.
            loadImage={active}
            variant={variant}
          />
        </View>
      )
    },
    [
      cards.length,
      items.length,
      handleCardFocus,
      onCardPress,
      upFocusTarget,
      lastCardNode,
      active,
      variant,
    ],
  )

  if (cards.length === 0) return null

  return (
    <View style={styles.container}>
      <View style={styles.head}>
        <Text style={styles.eyebrow} numberOfLines={1}>
          {eyebrow}
        </Text>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>

      {/* autoFocus restores the LAST-focused card on re-entry; parent gates it off when source focus
          is a rail below (keeps column-preserving geometry). Short-rail skips are handled by RailPad
          cards, not the guide. extraData forces the pads to re-render once the bounce target is captured. */}
      {/* Android: trap horizontal focus so Right at the last card (Left at the
          first) is a no-op — else the focus engine escapes diagonally to the
          rail below. Up/Down still cross rails. tvOS keeps native edge behavior. */}
      <TVFocusGuideView
        autoFocus={restoreLastFocus}
        trapFocusLeft={IS_ANDROID}
        trapFocusRight={IS_ANDROID}
        style={RAIL_PULL_UP[variant]}
      >
        <FlatList
          data={items}
          extraData={lastCardNode}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={keyExtractor}
          onScrollToIndexFailed={() => {}}
          getItemLayout={GET_ITEM_LAYOUT[variant]}
          renderItem={renderItem}
        />
      </TVFocusGuideView>
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(8),
  },
  head: {
    paddingHorizontal: scale(80),
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(17)),
    fontWeight: "700",
    // .16em of the 17px eyebrow.
    letterSpacing: scale(2.7),
    textTransform: "uppercase",
    color: WATCH_THEME.accent,
    marginBottom: scale(6),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(34)),
    fontWeight: "700",
    letterSpacing: -scale(0.4),
    color: WATCH_THEME.text,
  },
  listContent: {
    paddingHorizontal: scale(80),
  },
  itemGap: {
    marginRight: ITEM_GAP,
  },
})
