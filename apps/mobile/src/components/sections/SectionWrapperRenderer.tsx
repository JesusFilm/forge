import { ImageBackground, StyleSheet, View } from "react-native"

import { layout } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"
import { ContentDispatcher } from "./ContentDispatcher"

// ── Types ───────────────────────────────────────────────────────────────────

export interface SectionWrapperRendererProps {
  section: AdminBlock
}

// ── Component ───────────────────────────────────────────────────────────────

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  const s = section as Record<string, unknown>
  const content = (s.sectionContent as AdminBlock[] | undefined) ?? []
  const backgroundImageUrl =
    typeof s.backgroundImageUrl === "string" ? s.backgroundImageUrl : ""
  const outerStyle = [
    layout.sectionOuter,
    backgroundImageUrl ? styles.withImage : null,
  ]

  return (
    <View style={outerStyle}>
      {backgroundImageUrl ? (
        <ImageBackground
          source={{ uri: backgroundImageUrl }}
          resizeMode="cover"
          style={styles.imageBackground}
        >
          <View style={styles.imageOverlay}>
            {content.length > 0 && <ContentDispatcher content={content} />}
          </View>
        </ImageBackground>
      ) : (
        content.length > 0 && <ContentDispatcher content={content} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  imageBackground: {
    overflow: "hidden",
  },
  imageOverlay: {
    backgroundColor: "rgba(0, 0, 0, 0.35)",
  },
  withImage: {
    overflow: "hidden",
  },
})
