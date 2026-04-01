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

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { experience, loading, error, refetch } = useExperienceContext()

  if (loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color="#CB333B" />
        <Text style={styles.loadingText}>Loading experience...</Text>
      </View>
    )
  }

  if (error != null) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.errorTitle}>Something went wrong</Text>
        <Text style={styles.errorMessage}>{error}</Text>
        <Pressable
          style={({ pressed }) => [
            styles.retryButton,
            pressed && styles.retryButtonPressed,
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
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.emptyText}>No content available</Text>
      </View>
    )
  }

  return <CuratedHomeLayout />
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    backgroundColor: "#1c1917",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  loadingText: {
    color: "#a8a29e",
    fontSize: 17,
    fontFamily: "System",
    marginTop: 12,
  },
  errorTitle: {
    color: "#f5f5f4",
    fontSize: 22,
    fontWeight: "bold",
    fontFamily: "System",
    marginBottom: 8,
  },
  errorMessage: {
    color: "#a8a29e",
    fontSize: 15,
    fontFamily: "System",
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: "#CB333B",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryText: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "600",
    fontFamily: "System",
  },
  emptyText: {
    color: "#a8a29e",
    fontSize: 17,
    fontFamily: "System",
  },
})
