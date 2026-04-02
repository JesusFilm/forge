import { useCallback, useState } from "react"
import { Linking, Pressable, StyleSheet, Text, View } from "react-native"

import { AnimatedChevron, animateLayout } from "../ui/AnimatedChevron"
import { validateActionUrl } from "../../lib/validateUrl"
import { useTypography } from "../../hooks/useTypography"
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

// ── Constants ───────────────────────────────────────────────────────────────

const ACCENT = "#CB333B"

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
        <View style={styles.questionIcon}>
          <Text style={styles.questionIconText}>{"?"}</Text>
        </View>
        <Text style={[styles.questionText, typography.body]} numberOfLines={3}>
          {item.question}
        </Text>
        <AnimatedChevron
          isExpanded={isExpanded}
          glyph={"\u25B8"}
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
    <View style={styles.container}>
      <View style={styles.headerRow}>
        {heading != null && (
          <Text
            style={[styles.heading, typography.heading]}
            accessibilityRole="header"
          >
            {heading}
          </Text>
        )}
        {ctaLabel != null && ctaLink != null && (
          <Pressable
            onPress={handleCtaPress}
            style={styles.ctaLink}
            accessibilityRole="link"
            accessibilityLabel={ctaLabel}
          >
            <Text style={[styles.ctaLinkText, typography.bodySmall]}>
              {ctaLabel}
            </Text>
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
  container: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  heading: {
    fontWeight: "700",
    color: "#f5f5f4",
    fontFamily: "System",
    flex: 1,
  },
  ctaLink: {
    minHeight: 48,
    justifyContent: "center",
    paddingLeft: 12,
  },
  ctaLinkText: {
    fontWeight: "600",
    color: ACCENT,
    fontFamily: "System",
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
  questionIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#a8a29e",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.4,
    marginRight: 14,
  },
  questionIconText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#a8a29e",
    fontFamily: "System",
    lineHeight: 13,
  },
  questionText: {
    flex: 1,
    fontWeight: "600",
    color: "#f5f5f4",
    fontFamily: "System",
    marginRight: 12,
  },
  chevron: {
    fontSize: 18,
    color: "#a8a29e",
  },
  answerText: {
    color: "#d6d3d1",
    fontFamily: "System",
    paddingBottom: 16,
    paddingLeft: 34,
  },
})
