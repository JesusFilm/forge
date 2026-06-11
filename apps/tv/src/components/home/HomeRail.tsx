// One curated Home section as a horizontal, D-pad-navigable rail (R11/R12):
// eyebrow + title header over a FlatList of HomeCards inside a
// TVFocusGuideView. Grid-configured sections render as rails too — TV's
// density choice — and section descriptions are not rendered (mobile parity).
//
// Fixed card dims → getItemLayout, so a long section virtualizes without a
// measuring pass. Renders nothing for an empty section: the model already
// drops them (R12), this is defensive — no empty focus container.

import { FlatList, StyleSheet, Text, View } from "react-native"

import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import type { WatchHomeCard } from "../../lib/watchHome/model"
import { TVFocusGuideView } from "../TVFocusGuideView"
import { HOME_CARD_WIDTH, HomeCard } from "./HomeCard"

const ITEM_GAP = scale(28)

type HomeRailProps = {
  eyebrow: string
  title: string
  cards: WatchHomeCard[]
  /** Re-emits the focused card object (closed over per-card in HomeCard). */
  onCardFocus: (card: WatchHomeCard) => void
  onCardPress: (card: WatchHomeCard) => void
}

export function HomeRail({
  eyebrow,
  title,
  cards,
  onCardFocus,
  onCardPress,
}: HomeRailProps) {
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

      <TVFocusGuideView autoFocus>
        <FlatList
          data={cards}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          keyExtractor={(item, index) => `home-card-${item.id}-${index}`}
          onScrollToIndexFailed={() => {}}
          // Fixed card dims → no measuring pass. The last item has no trailing
          // gap, so its length is overstated by ITEM_GAP — harmless for
          // virtualization and scrollToIndex (same note as EpisodeRail).
          getItemLayout={(_, index) => ({
            length: HOME_CARD_WIDTH + ITEM_GAP,
            offset: (HOME_CARD_WIDTH + ITEM_GAP) * index,
            index,
          })}
          renderItem={({ item, index }) => (
            <View
              style={[
                styles.itemWrapper,
                index < cards.length - 1 && styles.itemGap,
              ]}
            >
              {/* HomeCard re-emits its `card` prop from onFocus/onPress —
                  never re-index into `data` from an async focus callback
                  (the array can shrink under it). */}
              <HomeCard
                card={item}
                index={index}
                onFocus={onCardFocus}
                onPress={onCardPress}
              />
            </View>
          )}
        />
      </TVFocusGuideView>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(8),
  },
  head: {
    paddingHorizontal: scale(80),
    marginBottom: scale(4),
  },
  eyebrow: {
    fontFamily: "System",
    fontSize: Math.round(scale(18)),
    fontWeight: "700",
    letterSpacing: scale(1.8),
    textTransform: "uppercase",
    color: COLORS.primary,
    marginBottom: scale(8),
  },
  title: {
    fontFamily: "System",
    fontSize: Math.round(scale(32)),
    fontWeight: "700",
    letterSpacing: -scale(0.4),
    color: COLORS.text,
  },
  listContent: {
    paddingHorizontal: scale(80),
  },
  // Vertical room so the focus lift + glow never clip against neighbours.
  itemWrapper: {
    paddingVertical: scale(32),
  },
  itemGap: {
    marginRight: ITEM_GAP,
  },
})
