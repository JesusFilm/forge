import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { useExperienceContext } from "../../src/contexts/ExperienceProvider"
import { CuratedHomeLayout } from "../../src/components/sections/CuratedHomeLayout"
import { ACCENT, TEXT_ON_OVERLAY, TEXT_SECONDARY } from "../../src/lib/color"
import { layout, text, feedback } from "../../src/styles/shared"

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { experience, loading, error, refetch } = useExperienceContext()

  if (loading) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={ACCENT} />
        <Text style={styles.loadingText}>Loading experience...</Text>
      </View>
    )
  }

  if (error != null) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top }]}>
        <Text style={text.errorTitle}>Something went wrong</Text>
        <Text style={[text.errorMessage, styles.errorMessageSpacing]}>
          {error}
        </Text>
        <Pressable
          style={({ pressed }) => [
            styles.retryButton,
            pressed && feedback.pressed,
          ]}
          onPress={refetch}
          accessibilityRole="button"
          accessibilityLabel="Retry loading"
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  if (experience == null) {
    return (
      <View style={[layout.centered, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>No content available</Text>
      </View>
    )
  }

  return <CuratedHomeLayout />
}

const styles = StyleSheet.create({
  loadingText: {
    color: TEXT_SECONDARY,
    fontSize: 17,
    fontFamily: "System",
    marginTop: 12,
  },
  errorMessageSpacing: {
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: ACCENT,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  retryText: {
    color: TEXT_ON_OVERLAY,
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "System",
  },
  emptyText: {
    color: TEXT_SECONDARY,
    fontSize: 17,
    fontFamily: "System",
  },
})
