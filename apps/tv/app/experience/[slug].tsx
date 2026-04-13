import { useQuery } from "@apollo/client/react"
import { useLocalSearchParams } from "expo-router"
import { useMemo, useState } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SectionDispatcher } from "../../src/components/sections/SectionDispatcher"
import { ExperienceProvider } from "../../src/contexts/ExperienceProvider"
import { normalizeExperience } from "../../src/lib/normalizer"
import { GET_WATCH_EXPERIENCE } from "../../src/lib/queries"

export default function ExperienceDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = decodeURIComponent(slug ?? "")

  const { data, loading, error, refetch } = useQuery(GET_WATCH_EXPERIENCE, {
    variables: {
      locale: "en",
      filters: { slug: { eq: decodedSlug } },
    },
    skip: !decodedSlug,
  })

  const rawExperience = data?.experiences?.[0]

  const experience = useMemo(() => {
    if (!rawExperience) return null
    return normalizeExperience(rawExperience as Record<string, unknown>)
  }, [rawExperience])

  const errorMessage = error?.message ?? null

  const handleRefetch = useMemo(() => () => void refetch(), [refetch])

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#CB333B" />
      </View>
    )
  }

  if (errorMessage) {
    return <ErrorState message={errorMessage} onRetry={handleRefetch} />
  }

  if (!experience || experience.sections.length === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No content available</Text>
      </View>
    )
  }

  return (
    <ExperienceProvider
      experience={experience}
      loading={loading}
      error={errorMessage}
      refetch={handleRefetch}
    >
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}
      >
        {experience.sections.map((section, index) => (
          <View key={`${section.kind}-${section.id}-${index}`}>
            <SectionDispatcher section={section} />
          </View>
        ))}
      </ScrollView>
    </ExperienceProvider>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  const [focused, setFocused] = useState(false)

  return (
    <View style={styles.centered}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable
        onPress={onRetry}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        hasTVPreferredFocus
        style={[styles.retryButton, focused && styles.retryButtonFocused]}
      >
        <Text style={styles.retryButtonText}>Try Again</Text>
      </Pressable>
      <Text style={styles.backHint}>Press menu to go back</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#161311",
  },
  list: {
    flex: 1,
    backgroundColor: "#161311",
  },
  listContent: {
    paddingBottom: 80,
  },
  emptyText: {
    color: "#F5F5F4",
    fontSize: 20,
    fontFamily: "System",
  },
  errorText: {
    color: "#F5F5F4",
    fontSize: 20,
    fontFamily: "System",
    marginBottom: 24,
    textAlign: "center",
    paddingHorizontal: 40,
  },
  retryButton: {
    backgroundColor: "#CB333B",
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 24,
  },
  retryButtonFocused: {
    shadowColor: "#CB333B",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 8,
  },
  retryButtonText: {
    color: "#F5F5F4",
    fontSize: 18,
    fontFamily: "System",
    fontWeight: "600",
  },
  backHint: {
    color: "#A8A29E",
    fontSize: 14,
    fontFamily: "System",
    marginTop: 16,
  },
})
