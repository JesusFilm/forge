import { StyleSheet, Text, View } from "react-native"

import { BROWSE_TOPICS } from "../../lib/browseTopics"
import { TEXT_SECONDARY } from "../../lib/color"
import { TopicBubble } from "./TopicBubble"

export interface BrowseTopicsProps {
  onSelect: (searchTerm: string) => void
}

// The Discover empty state: a "Browse" heading over the six topic bubbles, which
// wrap to fit the viewport. Replaces the old dead-end placeholder line. Tapping a
// bubble routes through onSelect (wired to the screen's stale-guarded search).
export function BrowseTopics({ onSelect }: BrowseTopicsProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Browse</Text>
      <View style={styles.bubbles}>
        {BROWSE_TOPICS.map((topic) => (
          <TopicBubble
            key={topic.searchTerm}
            topic={topic}
            onSelect={onSelect}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  heading: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  bubbles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
})
