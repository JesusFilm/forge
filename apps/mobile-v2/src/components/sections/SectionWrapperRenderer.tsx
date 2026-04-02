import { StyleSheet, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { ContentDispatcher } from "./ContentDispatcher"

// ── Types ───────────────────────────────────────────────────────────────────

type BackgroundColorKey =
  | "default"
  | "light"
  | "dark"
  | "primary"
  | "cosmic"
  | "purple"

export interface SectionWrapperRendererProps {
  section: NormalizedBlock
}

// ── Color Maps ──────────────────────────────────────────────────────────────

const BACKGROUND_COLORS: Record<BackgroundColorKey, string> = {
  default: "#292524",
  light: "#44403c",
  dark: "#1c1917",
  primary: "#CB333B",
  cosmic: "#1e1b4b",
  purple: "#581c87",
}

// ── Component ───────────────────────────────────────────────────────────────

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  const bgKey = section.backgroundColor as BackgroundColorKey | null
  const content =
    (section.sectionContent as NormalizedBlock[] | undefined) ?? []

  const bgColor =
    bgKey && bgKey in BACKGROUND_COLORS ? BACKGROUND_COLORS[bgKey] : undefined

  return (
    <View
      style={[
        styles.container,
        bgColor != null && { backgroundColor: bgColor },
      ]}
    >
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
