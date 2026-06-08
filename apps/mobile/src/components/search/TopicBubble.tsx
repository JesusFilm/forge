import { Pressable, StyleSheet, Text, View } from "react-native"
import { LinearGradient } from "expo-linear-gradient"
import Ionicons from "@expo/vector-icons/Ionicons"

import type { BrowseTopic } from "../../lib/browseTopics"
import { hexToRgba, TEXT_PRIMARY } from "../../lib/color"
import { useTypography } from "../../hooks/useTypography"
import { feedback } from "../../styles/shared"

export interface TopicBubbleProps {
  topic: BrowseTopic
  onSelect: (searchTerm: string) => void
}

// A tappable gradient "bubble" chip. Mirrors the QuizButtonRenderer pattern:
// Pressable owns touch + a11y, a LinearGradient fills it. The soft per-topic
// fill is built from the topic's base color via hexToRgba (never "transparent",
// which dark-bands). The glyph is decorative — hidden from the a11y tree so the
// label alone reads.
export function TopicBubble({ topic, onSelect }: TopicBubbleProps) {
  const typography = useTypography()

  return (
    <Pressable
      style={({ pressed }) => [
        styles.bubble,
        { borderColor: hexToRgba(topic.baseColor, 0.5) },
        pressed && feedback.pressed,
      ]}
      onPress={() => onSelect(topic.searchTerm)}
      accessibilityRole="button"
      accessibilityLabel={`Search ${topic.label}`}
    >
      <LinearGradient
        colors={[
          hexToRgba(topic.baseColor, 0.35),
          hexToRgba(topic.baseColor, 0.12),
        ]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.gradient}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name={topic.glyph} size={16} color={topic.baseColor} />
        </View>
        <Text style={[styles.label, typography.bodySmall]} numberOfLines={1}>
          {topic.label}
        </Text>
      </LinearGradient>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 20,
    overflow: "hidden",
    minHeight: 44,
    borderWidth: 1,
  },
  gradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  label: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontWeight: "600",
  },
})
