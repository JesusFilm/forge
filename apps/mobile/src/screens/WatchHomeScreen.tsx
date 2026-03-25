import { ActivityIndicator, StyleSheet, Text, View } from "react-native"

import { FixedHeroLayout } from "../components/sections"
import { useExperience } from "../hooks/useExperience"
import { useTypography } from "../hooks/useTypography"

const DEFAULT_LOCALE = "en"
const FALLBACK_SLUG = "easter"

export function WatchHomeScreen() {
  const typography = useTypography()
  const state = useExperience({
    fallbackSlug: FALLBACK_SLUG,
    locale: DEFAULT_LOCALE,
  })

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={[styles.loadingText, typography.bodySmall]}>Loading…</Text>
      </View>
    )
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={[styles.errorText, typography.bodySmall]}>
          {state.message}
        </Text>
      </View>
    )
  }

  return <FixedHeroLayout sections={state.data.sections} />
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 12,
    color: "#666",
  },
  errorText: {
    color: "red",
    paddingHorizontal: 24,
    textAlign: "center",
  },
})
