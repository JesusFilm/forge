// One curated Home section as a horizontal, D-pad-navigable rail (R11/R12):
// eyebrow + title header over a FlatList of HomeCards inside a
// TVFocusGuideView. Grid-configured sections render as rails too — TV's
// density choice — and section descriptions are not rendered (mobile parity).
//
// Fixed card dims → getItemLayout, so a long section virtualizes without a
// measuring pass. Renders nothing for an empty section: the model already
// drops them (R12), this is defensive — no empty focus container.
//
// Redesign: the rail also reports WHICH row gained focus (onRowFocus) so the
// screen can drive its row-anchored scroll + deep/browse chrome state. The
// onCardFocus(card) contract is unchanged.

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
import { HOME_CARD_THUMB_HEIGHT, HOME_CARD_WIDTH, HomeCard } from "./HomeCard"
import { buildRailItems, type RailItem } from "./homeRailItems"

const IS_ANDROID = Platform.OS === "android"

// Android uses a wider gap (same card size) so the rail shows slightly fewer
// cards with more spacing — the user-tuned density. tvOS keeps main's 28.
const ITEM_GAP = scale(IS_ANDROID ? 48 : 28)
const COLUMN_WIDTH = HOME_CARD_WIDTH + ITEM_GAP
const RAIL_PADDING_LEFT = scale(80)

// How many card columns span the visible width. A rail with fewer cards than
// this leaves empty columns on the right, which the tvOS focus engine treats
// as "nothing there" — a vertical move from an over-hanging column SKIPS the
// rail to a longer one below/above. We pad such rails up to this many columns
// with invisible focusable cards so every visible column has a focus target.
const VISIBLE_COLUMNS = Math.ceil(
  (Dimensions.get("window").width - RAIL_PADDING_LEFT) / COLUMN_WIDTH,
)

const keyExtractor = (item: RailItem, index: number) =>
  item.kind === "card"
    ? `home-card-${item.card.id}-${index}`
    : `home-pad-${index}`

// Fixed card dims → no measuring pass. The last item has no trailing gap, so
// its length is overstated by ITEM_GAP — harmless for virtualization and
// scrollToIndex (same note as EpisodeRail). Module-scope: pure function of
// module constants.
const getItemLayout = (
  _: ArrayLike<RailItem> | null | undefined,
  index: number,
) => ({
  length: COLUMN_WIDTH,
  offset: COLUMN_WIDTH * index,
  index,
})

// react-native-tvos host nodes expose requestTVFocus() (NativeMethods), absent
// from the bundled View type. Encapsulate the cast in one helper so it stays
// out of render code; no-ops safely on a null/detached node.
function requestTVFocus(node: ViewType | null): void {
  ;(node as { requestTVFocus?: () => void } | null)?.requestTVFocus?.()
}

/**
 * Invisible over-hang catcher: a focusable, transparent, accessibility-hidden
 * cell in the rail's empty right columns. When a vertical D-pad move lands here
 * (because the source column over-hangs this shorter rail), it instantly
 * bounces focus to the rail's last REAL card via requestTVFocus() — a
 * same-rail move, which works where cross-FlatList nextFocus does not. It is
 * inert: dispatches no card/row focus, so the showcase/scroll only react to the
 * real card it redirects to. Non-focusable until the target node is known, so
 * focus is never stranded on an invisible cell.
 */
const RailPad = memo(function RailPad({
  targetNode,
}: {
  targetNode: ViewType | null
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
      style={styles.pad}
    />
  )
})

type HomeRailProps = {
  eyebrow: string
  title: string
  cards: WatchHomeCard[]
  /** This rail's position in the feed (featured = 0). */
  rowIndex: number
  /** Re-emits the focused card object (closed over per-card in HomeCard). */
  onCardFocus: (card: WatchHomeCard) => void
  /** Fires alongside onCardFocus with this rail's rowIndex — drives the
   *  screen's row-anchored scrolling and deep/browse chrome state. */
  onRowFocus?: (rowIndex: number) => void
  onCardPress: (card: WatchHomeCard) => void
  /**
   * D-pad-up destination for this rail's cards. The featured rail passes the
   * Search tab's node so its edge cards (no focusable directly above the
   * centered tab bar) can still reach the top bar; section rails leave it
   * undefined and rely on the full-width rail above them.
   */
  upFocusTarget?: ViewType | null
  /**
   * When true, this rail's TVFocusGuideView restores its LAST-focused card when
   * focus re-enters. The topmost rail enables it ONLY while the source focus is
   * NOT a rail below it (the parent gates this), so Down off the hero CTA
   * restores the last card, while Up from a rail below stays column-preserving.
   */
  restoreLastFocus?: boolean
  /**
   * Image-windowing (Android): when false (off the focus window), the rail's
   * cards still mount at full size and stay focusable — so D-pad focus never
   * lands on an empty rail — but skip their image decode. The parent keeps the
   * focused row + a buffer of neighbours active. Defaults to true (eager).
   */
  active?: boolean
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
}: HomeRailProps) {
  // This rail's last real card node — the bounce target for the pad cards.
  // State (not a ref) so the pads re-render with it once it mounts.
  const [lastCardNode, setLastCardNode] = useState<ViewType | null>(null)

  const handleCardFocus = useCallback(
    (card: WatchHomeCard) => {
      onRowFocus?.(rowIndex)
      onCardFocus(card)
    },
    [onCardFocus, onRowFocus, rowIndex],
  )

  // Real cards + invisible over-hang pads (see homeRailItems.buildRailItems).
  const items = useMemo(() => buildRailItems(cards, VISIBLE_COLUMNS), [cards])

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<RailItem>) => {
      const isLastColumn = index === items.length - 1
      if (item.kind === "pad") {
        return (
          <View style={[styles.itemWrapper, !isLastColumn && styles.itemGap]}>
            <RailPad targetNode={lastCardNode} />
          </View>
        )
      }
      return (
        <View style={[styles.itemWrapper, !isLastColumn && styles.itemGap]}>
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

      {/* autoFocus restores this rail's LAST-focused card when focus re-enters
          (the topmost rail uses it for Down off the hero CTA). The parent gates
          it OFF whenever the source focus is a rail BELOW, so Up-from-below
          keeps the focus engine's column-preserving geometry instead. Other
          rails leave it off entirely. The skip into shorter rails is handled by
          the invisible RailPad cards (see `items`), not the guide.
          extraData={lastCardNode}: FlatList re-renders rows on data/extraData
          change only — the pads need to re-render once the bounce target is
          captured. */}
      {/* Android: trap horizontal focus inside the rail so Right at the last
          card (and Left at the first) is a no-op — without this the focus engine
          escapes diagonally to the rail below's edge card. Up/Down still cross
          rails (only left/right trapped). tvOS keeps its native edge behavior. */}
      <TVFocusGuideView
        autoFocus={restoreLastFocus}
        trapFocusLeft={IS_ANDROID}
        trapFocusRight={IS_ANDROID}
      >
        <FlatList
          data={items}
          extraData={lastCardNode}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={keyExtractor}
          onScrollToIndexFailed={() => {}}
          getItemLayout={getItemLayout}
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
  // Vertical room so the focus lift + white ring + shadow never clip against
  // neighbours; doubles as the design's head→cards gap (22px ≈ 24).
  itemWrapper: {
    paddingVertical: scale(24),
  },
  itemGap: {
    marginRight: ITEM_GAP,
  },
  // Invisible over-hang catcher: a card-sized focusable in the rail's empty
  // right columns. Transparent (no background/content) rather than opacity:0 —
  // the tvOS focus engine skips alpha-0 views, so opacity:0 made the pad
  // unfocusable. Matches the thumb height so its focus frame lines up with the
  // real cards' band for vertical (up/down) geometry.
  pad: {
    width: HOME_CARD_WIDTH,
    height: HOME_CARD_THUMB_HEIGHT,
  },
})
