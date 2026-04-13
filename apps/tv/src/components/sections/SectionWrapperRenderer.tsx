import { StyleSheet, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { SectionDispatcher } from "./SectionDispatcher"

export interface SectionWrapperRendererProps {
  section: NormalizedBlock
}

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  const content =
    (section.sectionContent as NormalizedBlock[] | undefined) ?? []

  if (content.length === 0) return null

  return (
    <View style={styles.wrapper}>
      {content.map((child, index) => (
        <SectionDispatcher
          key={`${child.kind}-${child.id}-${index}`}
          section={child}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: 24,
  },
})
