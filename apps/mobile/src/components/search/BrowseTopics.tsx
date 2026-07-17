import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"

import { BROWSE_TOPICS } from "../../lib/browseTopics"
import { TEXT_SECONDARY } from "../../lib/color"
import { useCategoryThumbnails } from "../../hooks/useCategoryThumbnails"
import { TopicCard } from "./TopicCard"

const GRID_PADDING = 16
const GRID_GAP = 12

export interface BrowseTopicsProps {
  onSelect: (searchTerm: string) => void
}

// Discover empty state: "Browse Categories" heading over a scrollable 2-column
// grid of gradient cards. Tapping a card routes through onSelect (wired to the
// screen's stale-guarded search).
export function BrowseTopics({ onSelect }: BrowseTopicsProps) {
  const thumbnails = useCategoryThumbnails()
  const { width } = useWindowDimensions()
  // Explicit two-column width: full width minus the content padding and the
  // single inter-card gap, halved. An explicit width keeps the grid reliably
  // 2-up — a flexGrow/flexBasis combo blows a lone wrapped card to full width.
  const cardWidth = Math.floor((width - GRID_PADDING * 2 - GRID_GAP) / 2)

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.heading}>Browse Categories</Text>
      <View style={styles.grid}>
        {BROWSE_TOPICS.map((topic) => (
          <TopicCard
            key={topic.searchTerm}
            topic={topic}
            onSelect={onSelect}
            thumbnailUrl={thumbnails[topic.searchTerm]}
            cardWidth={cardWidth}
          />
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: GRID_PADDING,
    paddingTop: 12,
    paddingBottom: 24,
  },
  heading: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
})
