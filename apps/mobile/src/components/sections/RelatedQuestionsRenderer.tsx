import { useEffect, useRef, useState } from "react"
import {
  Animated,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native"

import { useTypography, type TypographyScale } from "../../hooks/useTypography"
import type {
  RelatedQuestionItem,
  RelatedQuestionsSection,
} from "../../lib/sectionModels"
import { useSectionColorScheme } from "./SectionColorSchemeContext"

// Enable LayoutAnimation on Android
if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

export interface RelatedQuestionsRendererProps {
  section: RelatedQuestionsSection
}

function AnimatedChevron({
  isExpanded,
  isOnDark,
}: {
  isExpanded: boolean
  isOnDark?: boolean
}) {
  const rotation = useRef(new Animated.Value(isExpanded ? 1 : 0)).current

  useEffect(() => {
    Animated.timing(rotation, {
      toValue: isExpanded ? 1 : 0,
      duration: 300,
      useNativeDriver: true,
    }).start()
  }, [isExpanded, rotation])

  const rotateInterpolation = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "90deg"],
  })

  return (
    <Animated.View style={{ transform: [{ rotate: rotateInterpolation }] }}>
      <Text style={[styles.chevron, isOnDark && styles.chevronLight]}>▸</Text>
    </Animated.View>
  )
}

function QuestionItem({
  item,
  isExpanded,
  isOnDark,
  typography,
  onToggle,
}: {
  item: RelatedQuestionItem
  isExpanded: boolean
  isOnDark?: boolean
  typography: TypographyScale
  onToggle: () => void
}) {
  return (
    <View style={[styles.item, isOnDark && styles.itemLight]}>
      <Pressable
        style={styles.questionRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityState={{ expanded: isExpanded }}
      >
        <Text
          style={[
            styles.questionText,
            typography.body,
            isOnDark && styles.questionTextLight,
          ]}
          numberOfLines={3}
        >
          {item.question}
        </Text>
        <AnimatedChevron isExpanded={isExpanded} isOnDark={isOnDark} />
      </Pressable>
      {isExpanded && (
        <Text
          style={[
            styles.answerText,
            typography.bodySmall,
            isOnDark && styles.answerTextLight,
          ]}
        >
          {item.answer}
        </Text>
      )}
    </View>
  )
}

export function RelatedQuestionsRenderer({
  section,
}: RelatedQuestionsRendererProps) {
  const { heading, questions } = section
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const colorScheme = useSectionColorScheme()
  const isOnDark = colorScheme === "light"
  const typography = useTypography()

  const toggle = (id: string) => {
    LayoutAnimation.configureNext({
      duration: 300,
      update: { type: LayoutAnimation.Types.easeInEaseOut },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    })
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text
          style={[
            styles.heading,
            typography.heading,
            isOnDark && styles.headingLight,
          ]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {questions.map((item) => (
        <QuestionItem
          key={item.id}
          item={item}
          isExpanded={expandedId === item.id}
          isOnDark={isOnDark}
          typography={typography}
          onToggle={() => toggle(item.id)}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    marginVertical: 4,
  },
  heading: {
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
  },
  headingLight: {
    color: "#ffffff",
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  itemLight: {
    borderBottomColor: "rgba(255, 255, 255, 0.2)",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
  },
  questionText: {
    flex: 1,
    fontWeight: "600",
    color: "#1a1a1a",
    marginRight: 12,
  },
  questionTextLight: {
    color: "#ffffff",
  },
  chevron: {
    fontSize: 18, // Icon/badge size — intentionally excluded from typography scale
    color: "#666666",
  },
  chevronLight: {
    color: "rgba(255, 255, 255, 0.7)",
  },
  answerText: {
    color: "#4a4a4a",
    paddingBottom: 16,
  },
  answerTextLight: {
    color: "rgba(255, 255, 255, 0.85)",
  },
})
