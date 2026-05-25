import { ImageBackground, StyleSheet, View } from "react-native"

import { layout } from "../../styles/shared"
import type { AdminBlock } from "../../lib/queries"
import { ContentDispatcher } from "./ContentDispatcher"

// ── Types ───────────────────────────────────────────────────────────────────

export interface SectionWrapperRendererProps {
  section: AdminBlock
}

const SECTION_BACKGROUND_COLORS: Record<string, string> = {
  default: "#292524",
  light: "#f5f5f4",
  dark: "#1c1917",
  primary: "#1e3a8a",
  cosmic: "#1e1b4b",
  purple: "#581c87",
}

function sectionBackgroundColor(value: unknown) {
  if (typeof value !== "string" || value.trim() === "") return undefined
  const color = value.trim()
  return /^#[0-9a-fA-F]{6}$/.test(color)
    ? color
    : SECTION_BACKGROUND_COLORS[color]
}

// ── Component ───────────────────────────────────────────────────────────────

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  const s = section as Record<string, unknown>
  const content = (s.sectionContent as AdminBlock[] | undefined) ?? []
  const backgroundColor = sectionBackgroundColor(s.backgroundColor)
  const backgroundImageUrl =
    typeof s.backgroundImageUrl === "string" ? s.backgroundImageUrl : ""
  const outerStyle = [
    layout.sectionOuter,
    backgroundColor ? { backgroundColor } : null,
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
