import { useRef } from "react"
import { ImageBackground, StyleSheet, View } from "react-native"

import type { NormalizedBlock } from "../../lib/normalizer"
import { SectionDispatcher } from "./SectionDispatcher"
import { useExperienceContext } from "../../contexts/ExperienceProvider"

export interface SectionWrapperRendererProps {
  section: NormalizedBlock
  parentIndex?: number
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

export function SectionWrapperRenderer({
  section,
  parentIndex,
}: SectionWrapperRendererProps) {
  const { registerNestedLayout } = useExperienceContext()
  const wrapperOffsetRef = useRef(0)
  const content =
    (section.sectionContent as NormalizedBlock[] | undefined) ?? []

  if (content.length === 0) return null

  const backgroundColor = sectionBackgroundColor(section.backgroundColor)
  const backgroundImageUrl =
    typeof section.backgroundImageUrl === "string"
      ? section.backgroundImageUrl
      : ""
  const wrapperStyle = [
    styles.wrapper,
    backgroundColor ? { backgroundColor } : null,
    backgroundImageUrl ? styles.withImage : null,
  ]
  const children = content.map((child, index) => (
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
  ))

  return (
    <View
      style={wrapperStyle}
      onLayout={(e) => {
        // Capture wrapper's Y offset relative to the section View in [slug].tsx.
        // This includes the paddingVertical and focus anchor height.
        wrapperOffsetRef.current = e.nativeEvent.layout.y
      }}
    >
      {backgroundImageUrl ? (
        <ImageBackground
          source={{ uri: backgroundImageUrl }}
          resizeMode="cover"
          style={styles.imageBackground}
        >
          <View style={styles.imageOverlay}>{children}</View>
        </ImageBackground>
      ) : (
        children
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: 24,
  },
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
