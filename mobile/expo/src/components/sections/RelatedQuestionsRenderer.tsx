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

import type {
  RelatedQuestionItem,
  RelatedQuestionsSection,
} from "../../lib/sectionModels"

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

function AnimatedChevron({ isExpanded }: { isExpanded: boolean }) {
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
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.chevron}>▸</Text>
    </Animated.View>
  )
}

function QuestionItem({
  item,
  isExpanded,
  onToggle,
}: {
  item: RelatedQuestionItem
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.item}>
      {/* @ts-expect-error React 19 vs RN component types */}
      <Pressable
        style={styles.questionRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityState={{ expanded: isExpanded }}
      >
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text style={styles.questionText} numberOfLines={3}>
          {item.question}
        </Text>
        <AnimatedChevron isExpanded={isExpanded} />
      </Pressable>
      {isExpanded && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.answerText}>{item.answer}</Text>
      )}
    </View>
  )
}

export function RelatedQuestionsRenderer({
  section,
}: RelatedQuestionsRendererProps) {
  const { heading, questions } = section
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {heading != null && (
        // @ts-expect-error RN Text vs React 19 ReactNode
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      {questions.map((item) => (
        <QuestionItem
          key={item.id}
          item={item}
          isExpanded={expandedId === item.id}
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
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 16,
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
  },
  questionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginRight: 12,
  },
  chevron: {
    fontSize: 18,
    color: "#666666",
  },
  answerText: {
    fontSize: 15,
    color: "#4a4a4a",
    lineHeight: 22,
    paddingBottom: 16,
  },
})
