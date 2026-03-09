import { StyleSheet, Text, View } from "react-native"

import type { SectionWrapperSection } from "../../lib/sectionModels"
import { ContentDispatcher } from "./SectionDispatcher"

export interface SectionWrapperRendererProps {
  section: SectionWrapperSection
}

export function SectionWrapperRenderer({
  section,
}: SectionWrapperRendererProps) {
  return (
    // @ts-expect-error React 19 vs RN component types
    <View
      style={[
        styles.container,
        section.backgroundColor === "dark" && styles.dark,
        section.backgroundColor === "primary" && styles.primary,
        section.backgroundColor === "light" && styles.light,
      ]}
    >
      {/* @ts-expect-error RN Text vs React 19 ReactNode */}
      <Text
        style={[
          styles.label,
          (section.backgroundColor === "dark" ||
            section.backgroundColor === "primary") &&
            styles.labelLight,
        ]}
      >
        Section ({section.backgroundColor ?? "default"})
      </Text>
      <ContentDispatcher content={section.content} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#bdbdbd",
  },
  dark: {
    backgroundColor: "#424242",
  },
  primary: {
    backgroundColor: "#1565c0",
  },
  light: {
    backgroundColor: "#fafafa",
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: "#616161",
    marginBottom: 4,
  },
  labelLight: {
    color: "#fff",
  },
})
