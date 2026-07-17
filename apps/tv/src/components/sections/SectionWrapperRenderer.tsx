import { useRef } from "react"
import { ImageBackground, StyleSheet, View } from "react-native"

import { WATCH_THEME } from "../watch/watchDetailTheme"
import {
  blockKey,
  type NormalizedBlock,
  type SectionWrapperBlockModel,
} from "../../lib/normalizer"
import { SectionDispatcher } from "./SectionDispatcher"
import { useExperienceContext } from "../../contexts/ExperienceProvider"

export interface SectionWrapperRendererProps {
  section: SectionWrapperBlockModel
  parentIndex?: number
}

// All CMS semantic names flatten onto the single WATCH_THEME near-black surface.
// WATCH_THEME exposes no elevation tiers, and Video Details / Home don't alternate
// section backgrounds, so the old three-tier warm-stone alternation is dropped for
// near-black consistency. Raw hex values on section wrappers stay ignored on TV.
type SectionSemanticName =
  | "default"
  | "dark"
  | "primary"
  | "light"
  | "cosmic"
  | "purple"

const SECTION_BACKGROUND_COLORS = {
  default: WATCH_THEME.below,
  dark: WATCH_THEME.below,
  primary: WATCH_THEME.below,
  light: WATCH_THEME.below,
  cosmic: WATCH_THEME.below,
  purple: WATCH_THEME.below,
} satisfies Record<SectionSemanticName, string>

function sectionBackgroundColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const key = value.trim()
  return key in SECTION_BACKGROUND_COLORS
    ? SECTION_BACKGROUND_COLORS[key as SectionSemanticName]
    : undefined
}

export function SectionWrapperRenderer({
  section,
  parentIndex,
}: SectionWrapperRendererProps) {
  const { registerNestedLayout } = useExperienceContext()
  const wrapperOffsetRef = useRef(0)
  const content: NormalizedBlock[] = section.sectionContent ?? []

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
      key={`${child.kind}-${blockKey(child) ?? "block"}-${index}`}
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
    backgroundColor: WATCH_THEME.scrim(0.35),
  },
  withImage: {
    overflow: "hidden",
  },
})
