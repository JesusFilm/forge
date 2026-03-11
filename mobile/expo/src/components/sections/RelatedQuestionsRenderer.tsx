import { useState } from "react"
import { Pressable, StyleSheet, Text, View } from "react-native"

import type { RelatedQuestionsSection } from "../../lib/sectionModels"

export interface RelatedQuestionsRendererProps {
  section: RelatedQuestionsSection
}

export function RelatedQuestionsRenderer({
  section,
}: RelatedQuestionsRendererProps) {
  const { heading, questions } = section
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggle = (id: string) => {
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
      {questions.map((item) => {
        const isExpanded = expandedId === item.id
        return (
          // @ts-expect-error React 19 vs RN component types
          <View key={item.id} style={styles.item}>
            {/* @ts-expect-error React 19 vs RN component types */}
            <Pressable
              style={styles.questionRow}
              onPress={() => toggle(item.id)}
              accessibilityRole="button"
              accessibilityLabel={item.question}
              accessibilityState={{ expanded: isExpanded }}
            >
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.questionText} numberOfLines={3}>
                {item.question}
              </Text>
              {/* @ts-expect-error RN Text vs React 19 ReactNode */}
              <Text style={styles.chevron}>{isExpanded ? "▾" : "▸"}</Text>
            </Pressable>
            {isExpanded && (
              // @ts-expect-error RN Text vs React 19 ReactNode
              <Text style={styles.answerText}>{item.answer}</Text>
            )}
          </View>
        )
      })}
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
