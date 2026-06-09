import { useCallback, useState } from "react"
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { COLORS } from "../../lib/colors"
import { scale } from "../../lib/scale"
import { SECTION_HEADING } from "./sectionHeading"

// ── Enable LayoutAnimation on Android ───────────────────────────────────────

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

// ── Types ───────────────────────────────────────────────────────────────────

type QuestionItem = {
  id: string
  question: string
  answer: string
}

// ── QuestionRow ─────────────────────────────────────────────────────────────

function QuestionRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: QuestionItem
  isExpanded: boolean
  onToggle: () => void
}) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <View style={styles.item}>
      <Pressable
        style={[styles.questionRow, isFocused && styles.questionRowFocused]}
        onPress={onToggle}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityState={{ expanded: isExpanded }}
      >
        <Text style={styles.questionText} numberOfLines={3}>
          {item.question}
        </Text>
        <Text style={styles.chevron}>{isExpanded ? "\u2304" : "\u203A"}</Text>
      </Pressable>
      {isExpanded && <Text style={styles.answerText}>{item.answer}</Text>}
    </View>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function RelatedQuestionsRenderer({
  section,
}: {
  section: NormalizedBlock
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const heading = section.rqHeading as string | null
  const questions = (section.questions as QuestionItem[] | undefined) ?? []

  const handleToggle = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  if (questions.length === 0) {
    if (heading == null) return null
    return (
      <View style={styles.container}>
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text style={styles.heading} accessibilityRole="header">
          {heading}
        </Text>
      )}
      {questions.map((item, index) => (
        <QuestionRow
          key={`rq-${item.id}-${index}`}
          item={item}
          isExpanded={expandedId === item.id}
          onToggle={() => handleToggle(item.id)}
        />
      ))}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginBottom: scale(32),
  },
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(12),
    paddingHorizontal: scale(80),
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
    marginHorizontal: scale(80),
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: scale(20),
    paddingHorizontal: 0,
    borderRadius: scale(8),
  },
  questionRowFocused: {
    shadowColor: COLORS.primary,
    shadowRadius: scale(30),
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 0 },
  },
  questionText: {
    flex: 1,
    fontFamily: "System",
    fontSize: scale(22),
    fontWeight: "600",
    color: COLORS.text,
    marginRight: scale(12),
  },
  chevron: {
    fontFamily: "System",
    fontSize: scale(24),
    color: COLORS.muted,
  },
  answerText: {
    fontFamily: "System",
    fontSize: scale(20),
    fontWeight: "400",
    color: COLORS.muted,
    lineHeight: scale(30),
    paddingBottom: scale(20),
  },
})
