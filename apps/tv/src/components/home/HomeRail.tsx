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
import { FOCUS_RING_WIDTH, resolveFocusVisual } from "../focus/focusVisual"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { WATCH_THEME } from "../watch/watchDetailTheme"
import {
  HOME_CARD_DIMS,
  HOME_CARD_WIDTH,
  HomeCard,
  type HomeCardVariant,
} from "./HomeCard"
import { buildRailItems, type RailItem } from "./homeRailItems"

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

const THUMB_SPEC = resolveFocusVisual("thumb")

// Generous stand-in for the title+kind block under the art (~64 real) — only
// sizes focus headroom, so overestimating is safe.
const META_HEIGHT_ALLOWANCE = scale(80)

// The design's head→cards gap (22px ≈ 24); also the minimum focus headroom.
const BASE_ITEM_PADDING = scale(24)

// tvOS touchpad nudges add RCTTVView's default parallax on top of the focus
// scale: ±2pt center shift + 0.05rad tilt about a 1/500 perspective, which
// magnifies the near top corner. Android TV has no parallax (D-pad only).
const PARALLAX_SHIFT_Y = IS_ANDROID ? 0 : 2
const PARALLAX_TILT_SIN = IS_ANDROID ? 0 : Math.sin(0.05)
const PARALLAX_TILT_COS = Math.cos(0.05)
const PARALLAX_PERSPECTIVE = 500

// Room the focused card needs above its layout box before the FlatList's
// scroll bounds clip it: half the magnify growth + lift + scaled ring, at the
// worst-case diagonal nudge (both tilts perspective-magnify the top corner).
function focusHeadroomFor(variant: HomeCardVariant): number {
  const { width, thumbHeight } = HOME_CARD_DIMS[variant]
  const cardHeight = thumbHeight + META_HEIGHT_ALLOWANCE
  const halfWidth = (width / 2 + FOCUS_RING_WIDTH) * THUMB_SPEC.magnify
  const topFromCenter =
    (cardHeight / 2 + FOCUS_RING_WIDTH) * THUMB_SPEC.magnify + THUMB_SPEC.lift
  // UIKit applies the two tilts as separate additive CAAnimations that
  // compose by matrix concatenation, each with its own m34 — the offset
  // routed through both perspectives weighs (1+cos); bound both terms so.
  const perspectiveW =
    1 -
    (PARALLAX_TILT_SIN *
      (1 + PARALLAX_TILT_COS) *
      (halfWidth + topFromCenter)) /
      PARALLAX_PERSPECTIVE
  return Math.ceil(
    topFromCenter / perspectiveW + PARALLAX_SHIFT_Y - cardHeight / 2,
  )
}

const ITEM_PADDING_TOP: Record<HomeCardVariant, number> = {
  landscape: Math.max(BASE_ITEM_PADDING, focusHeadroomFor("landscape")),
  portrait: Math.max(BASE_ITEM_PADDING, focusHeadroomFor("portrait")),
}

// Top headroom only; the bottom keeps the base (nothing overhangs it).
const ITEM_WRAPPER: Record<
  HomeCardVariant,
  { paddingTop: number; paddingBottom: number }
> = StyleSheet.create({
  landscape: {
    paddingTop: ITEM_PADDING_TOP.landscape,
    paddingBottom: BASE_ITEM_PADDING,
  },
  portrait: {
    paddingTop: ITEM_PADDING_TOP.portrait,
    paddingBottom: BASE_ITEM_PADDING,
  },
})

// Headroom beyond the base gap is carved out of the clip bounds, not the
// layout: pull the list up by the same amount so cards keep the design's 24
// head→cards gap and the rail's outer height is unchanged.
const RAIL_PULL_UP: Record<HomeCardVariant, { marginTop: number }> =
  StyleSheet.create({
    landscape: { marginTop: BASE_ITEM_PADDING - ITEM_PADDING_TOP.landscape },
    portrait: { marginTop: BASE_ITEM_PADDING - ITEM_PADDING_TOP.portrait },
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
