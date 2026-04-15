import { useRef } from "react"
import { StyleSheet, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { SectionDispatcher } from "./SectionDispatcher"
import { useExperienceContext } from "../../contexts/ExperienceProvider"

export interface SectionWrapperRendererProps {
  section: NormalizedBlock
  parentIndex?: number
}

export function SectionWrapperRenderer({
  section,
  parentIndex,
}: SectionWrapperRendererProps) {
  const { registerNestedLayout } = useExperienceContext()
  const wrapperOffsetRef = useRef(0)
  const content =
    (section.sectionContent as NormalizedBlock[] | undefined) ?? []

  if (content.length === 0) return null

  return (
    <View
      style={styles.wrapper}
      onLayout={(e) => {
        // Capture wrapper's Y offset relative to the section View in [slug].tsx.
        // This includes the paddingVertical and focus anchor height.
        wrapperOffsetRef.current = e.nativeEvent.layout.y
      }}
    >
      {content.map((child, index) => (
        <View
          key={`${child.kind}-${child.id}-${index}`}
          onLayout={(e) => {
            if (parentIndex != null) {
              // child's Y relative to wrapper + wrapper's Y relative to section View
              const offsetWithinSection =
                wrapperOffsetRef.current + e.nativeEvent.layout.y
              registerNestedLayout(child, parentIndex, offsetWithinSection)
            }
          }}
        >
          <SectionDispatcher section={child} />
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: 24,
  },
})
