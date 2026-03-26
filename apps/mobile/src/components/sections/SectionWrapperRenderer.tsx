import { StyleSheet, View } from "react-native"

import type {
  SectionBackgroundColor,
  SectionWrapperSection,
} from "../../lib/sectionModels"
import { useIsInsideHero } from "./HeroSectionContext"
import {
  SectionColorSchemeContext,
  type ColorScheme,
} from "./SectionColorSchemeContext"
import { ContentDispatcher } from "./SectionDispatcher"

export interface SectionWrapperRendererProps {
  section: SectionWrapperSection
}

const backgroundColors: Record<SectionBackgroundColor, string> = {
  default: "#f5f5f5",
  light: "#fafafa",
  dark: "#1a1a1a",
  primary: "#CB333B",
}

const colorSchemes: Record<SectionBackgroundColor, ColorScheme> = {
  default: "dark",
  light: "dark",
  dark: "light",
  primary: "light",
}

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  const { backgroundColor, content } = section
  const insideHero = useIsInsideHero()
  // TODO: render blurHash background when react-native-blurhash is added

  const bgColor =
    backgroundColor && !insideHero
      ? backgroundColors[backgroundColor]
      : undefined

  const colorScheme: ColorScheme = insideHero
    ? "light"
    : backgroundColor
      ? colorSchemes[backgroundColor]
      : "dark"

  return (
    <View
      style={[
        styles.container,
        bgColor != null && { backgroundColor: bgColor },
      ]}
    >
      <SectionColorSchemeContext.Provider value={colorScheme}>
        {content.length > 0 && <ContentDispatcher content={content} />}
      </SectionColorSchemeContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
})
