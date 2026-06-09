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
  inset,
}: {
  item: QuestionItem
  isExpanded: boolean
  onToggle: () => void
  inset: number
}) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <View style={[styles.item, { marginHorizontal: inset }]}>
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
  inset = scale(80),
}: {
  section: NormalizedBlock
  /**
   * Horizontal screen gutter. Defaults to the SDUI full-bleed gutter
   * (scale(80)); the watch page passes 0 when the section sits inside an
   * already-padded column.
   */
  inset?: number
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
        <Text
          style={[styles.heading, { paddingHorizontal: inset }]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {heading != null && (
        <Text
          style={[styles.heading, { paddingHorizontal: inset }]}
          accessibilityRole="header"
        >
          {heading}
        </Text>
      )}
      {questions.map((item, index) => (
        <QuestionRow
          key={`rq-${item.id}-${index}`}
          item={item}
          isExpanded={expandedId === item.id}
          onToggle={() => handleToggle(item.id)}
          inset={inset}
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
  // Horizontal gutters (heading paddingHorizontal / item marginHorizontal)
  // come from the `inset` prop so the section works full-bleed and in-column.
  heading: {
    ...SECTION_HEADING,
    marginBottom: scale(12),
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
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
