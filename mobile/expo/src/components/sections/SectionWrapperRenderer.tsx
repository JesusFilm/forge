import { StyleSheet, View } from "react-native"

import type {
  SectionBackgroundColor,
  SectionWrapperSection,
} from "../../lib/sectionModels"
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
  // TODO: render blurHash background when react-native-blurhash is added

  const bgColor = backgroundColor
    ? backgroundColors[backgroundColor]
    : undefined

  const colorScheme = backgroundColor ? colorSchemes[backgroundColor] : "dark"

  return (
    // @ts-expect-error React 19 vs RN component types
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
