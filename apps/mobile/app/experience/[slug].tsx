import { useEffect } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams } from "expo-router"

import { CuratedHomeLayout } from "../../src/components/sections/CuratedHomeLayout"
import { useExperienceContext } from "../../src/contexts/ExperienceProvider"
import { useExperienceSelection } from "../../src/contexts/ExperienceSelectionProvider"
import { TEXT_SECONDARY } from "../../src/lib/color"
import { button, layout, text } from "../../src/styles/shared"

// Experience detail screen. Points the root ExperienceProvider at this slug
// via selectExperience, then renders the SDUI layout from that provider — so
// /video/[sectionKey] and /collection/[sectionKey] (which read the same root
// provider) keep working when pushed from here.
export default function ExperienceScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""

  const { currentSlug, selectExperience } = useExperienceSelection()
  const { experience, error, refetch } = useExperienceContext()

  // Make this the active experience. Guarded so re-renders (and revisits to
  // an already-active experience) don't re-trigger selection/persistence.
  useEffect(() => {
    if (decodedSlug !== "" && currentSlug !== decodedSlug) {
      selectExperience(decodedSlug)
    }
  }, [decodedSlug, currentSlug, selectExperience])

  const hasThisExperience =
    experience != null && experience.slug === decodedSlug

  if (hasThisExperience) {
    return <CuratedHomeLayout />
  }

  if (currentSlug === decodedSlug && error != null) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>Something went wrong</Text>
        <Text style={text.errorMessage}>{error}</Text>
        <Pressable
          onPress={refetch}
          style={[button.accent, styles.retryButton]}
          accessibilityRole="button"
          accessibilityLabel="Retry loading experience"
        >
          <Text style={button.accentText}>Try Again</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={layout.centered}>
      <ActivityIndicator size="small" color={TEXT_SECONDARY} />
    </View>
  )
}

const styles = StyleSheet.create({
  retryButton: {
    marginTop: 16,
  },
})
