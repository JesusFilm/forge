import { StyleSheet, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { ContentDispatcher } from "./ContentDispatcher"

// ── Types ───────────────────────────────────────────────────────────────────

export interface SectionWrapperRendererProps {
  section: NormalizedBlock
}

// ── Component ───────────────────────────────────────────────────────────────

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  const content =
    (section.sectionContent as NormalizedBlock[] | undefined) ?? []

  return (
    <View style={styles.container}>
      {content.length > 0 && <ContentDispatcher content={content} />}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
})
