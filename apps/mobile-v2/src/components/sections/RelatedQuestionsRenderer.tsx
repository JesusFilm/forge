import { useCallback, useState } from "react"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"
import Ionicons from "@expo/vector-icons/Ionicons"

import { AnimatedChevron, animateLayout } from "../ui/AnimatedChevron"
import { validateActionUrl } from "../../lib/validateUrl"
import { useTypography } from "../../hooks/useTypography"
import {
  ACCENT,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_BODY,
} from "../../lib/color"
import { layout, text, button } from "../../styles/shared"
import type { NormalizedBlock } from "../../lib/normalizer"

// ── Types ───────────────────────────────────────────────────────────────────

type QuestionItem = {
  id: string
  question: string
  answer: string
}

export interface RelatedQuestionsRendererProps {
  section: NormalizedBlock
}

// ── QuestionItem ────────────────────────────────────────────────────────────

function QuestionRow({
  item,
  isExpanded,
  onToggle,
}: {
  item: QuestionItem
  isExpanded: boolean
  onToggle: () => void
}) {
  const typography = useTypography()

  return (
    <View style={styles.item}>
      <Pressable
        style={styles.questionRow}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={item.question}
        accessibilityState={{ expanded: isExpanded }}
      >
        <Text style={[styles.questionText, typography.body]} numberOfLines={3}>
          {item.question}
        </Text>
        <AnimatedChevron
          isExpanded={isExpanded}
          glyph={"\u203A"}
          style={styles.chevron}
        />
      </Pressable>
      {isExpanded && (
        <Text style={[styles.answerText, typography.bodySmall]}>
          {item.answer}
        </Text>
      )}
    </View>
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export function RelatedQuestionsRenderer({
  section,
}: RelatedQuestionsRendererProps) {
  const typography = useTypography()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const heading = section.rqHeading as string | null
  const ctaLabel = section.ctaLabel as string | null
  const ctaLink = section.ctaLink as string | null
  const questions = (section.questions as QuestionItem[] | undefined) ?? []

  const handleToggle = useCallback((id: string) => {
    animateLayout()
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const handleCtaPress = useCallback(() => {
    if (ctaLink && validateActionUrl(ctaLink)) {
      Linking.openURL(ctaLink)
    }
  }, [ctaLink])

  return (
    <View style={[layout.sectionOuter, styles.localContainer]}>
      <View style={[layout.headerRow, styles.localHeaderRow]}>
        {heading != null && (
          <Text
            style={[
              text.sectionHeading,
              styles.localHeading,
              typography.heading,
            ]}
            accessibilityRole="header"
          >
            {heading}
          </Text>
        )}
        {ctaLink != null && (
          <Pressable
            onPress={handleCtaPress}
            style={[button.iconButton44, styles.localCtaButton]}
            accessibilityRole="link"
            accessibilityLabel={ctaLabel ?? "Ask a question"}
          >
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={22}
              color={ACCENT}
            />
          </Pressable>
        )}
      </View>
      {questions.map((item) => (
        <QuestionRow
          key={`rq-${item.id}`}
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
  localContainer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  localHeaderRow: {
    marginBottom: 12,
  },
  localHeading: {
    flex: 1,
  },
  localCtaButton: {
    marginLeft: 8,
  },
  item: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255, 255, 255, 0.1)",
  },
  questionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    minHeight: 48,
  },
  questionText: {
    flex: 1,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    fontFamily: "System",
    marginRight: 12,
  },
  chevron: {
    fontSize: 22,
    color: TEXT_SECONDARY,
  },
  answerText: {
    color: TEXT_BODY,
    fontFamily: "System",
    paddingBottom: 16,
    paddingLeft: 0,
  },
})
