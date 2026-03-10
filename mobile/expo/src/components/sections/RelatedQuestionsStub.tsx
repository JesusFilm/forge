import { StyleSheet, Text, View } from "react-native"

import type { RelatedQuestionsSection } from "../../lib/sectionModels"

export interface RelatedQuestionsRendererProps {
  section: RelatedQuestionsSection
}

export function RelatedQuestionsRenderer({
  section,
}: RelatedQuestionsRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View style={styles.container}>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.label}>RelatedQuestions</Text>
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text style={styles.detail}>
        {section.heading ?? section.id} · {section.questions.length} items
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#e0f7fa",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#80deea",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#00695c",
    marginBottom: 4,
  },
  detail: {
    fontSize: 13,
    color: "#333",
  },
})
