import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SectionDispatcher } from "../components/sections"
import { useExperience } from "../hooks/useExperience"

const DEFAULT_LOCALE = "en"
const FALLBACK_SLUG = "easter"

export function WatchHomeScreen() {
  const state = useExperience({
    fallbackSlug: FALLBACK_SLUG,
    locale: DEFAULT_LOCALE,
  })

  if (state.status === "loading") {
    return (
      // @ts-expect-error React 19 vs RN component types
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    )
  }

  if (state.status === "error") {
    return (
      // @ts-expect-error React 19 vs RN component types
      <View style={styles.center}>
        {/* @ts-expect-error RN Text vs React 19 ReactNode */}
        <Text style={styles.errorText}>{state.message}</Text>
      </View>
    )
  }

  return (
    // @ts-expect-error React 19 vs RN component types
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {state.data.sections.map((section, index) => (
        // @ts-expect-error React 19 vs RN component types
        <View key={`${section.id}-${index}`}>
          <SectionDispatcher section={section} />
        </View>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: "#666",
  },
  errorText: {
    fontSize: 14,
    color: "red",
    paddingHorizontal: 24,
    textAlign: "center",
  },
})
