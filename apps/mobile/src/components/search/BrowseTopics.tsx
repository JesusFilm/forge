import { ScrollView, StyleSheet, Text, View } from "react-native"

import { BROWSE_TOPICS } from "../../lib/browseTopics"
import { TEXT_SECONDARY } from "../../lib/color"
import { useCategoryThumbnails } from "../../hooks/useCategoryThumbnails"
import { TopicCard } from "./TopicCard"

export interface BrowseTopicsProps {
  onSelect: (searchTerm: string) => void
}

// The Discover empty state: a "Browse Categories" heading over a 2-column grid
// of gradient category cards, scrollable so it never clips on short screens.
// Replaces the old dead-end placeholder line. Tapping a card routes through
// onSelect (wired to the screen's stale-guarded search).
export function BrowseTopics({ onSelect }: BrowseTopicsProps) {
  const thumbnails = useCategoryThumbnails()

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
    paddingHorizontal: 16,
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
    gap: 12,
  },
})
