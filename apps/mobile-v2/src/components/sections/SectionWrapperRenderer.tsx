import { View } from "react-native"

import { layout } from "../../styles/shared"
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
    <View style={layout.sectionOuter}>
      {content.length > 0 && <ContentDispatcher content={content} />}
    </View>
  )
}
