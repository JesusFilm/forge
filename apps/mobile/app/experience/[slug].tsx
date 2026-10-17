import { useEffect, type ReactNode } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { Stack, useLocalSearchParams } from "expo-router"

import { CuratedHomeLayout } from "../../src/components/sections/CuratedHomeLayout"
import { FloatingBackButton } from "../../src/components/ui/FloatingBackButton"
import { useExperienceContext } from "../../src/contexts/ExperienceProvider"
import { useExperienceSelection } from "../../src/contexts/ExperienceSelectionProvider"
import { useT } from "../../src/i18n/useT"
import { TEXT_SECONDARY } from "../../src/lib/color"
import { button, layout, text } from "../../src/styles/shared"

// Experience detail screen. Points the root ExperienceProvider at this slug, then
// renders its SDUI layout — so /video/[sectionKey] and /collection/[sectionKey],
// which read the same root provider, keep working when pushed from here.
export default function ExperienceScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const decodedSlug = slug ? decodeURIComponent(slug) : ""

  const { currentSlug, selectExperience } = useExperienceSelection()
  const { experience, loading, error, refetch } = useExperienceContext()
  const t = useT("Sections")

  // Make this the active experience. Guarded so re-renders (and revisits to
  // an already-active experience) don't re-trigger selection/persistence.
  useEffect(() => {
    if (decodedSlug !== "" && currentSlug !== decodedSlug) {
      selectExperience(decodedSlug)
    }
  }, [decodedSlug, currentSlug, selectExperience])

  const hasThisExperience =
    experience != null && experience.slug === decodedSlug

  let content: ReactNode
  if (hasThisExperience) {
    content = <CuratedHomeLayout hideHeader />
  } else if (currentSlug === decodedSlug && error != null) {
    content = (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>{t("errorTitle")}</Text>
        <Text style={text.errorMessage}>{t("loadErrorMessage")}</Text>
        <Pressable
          onPress={refetch}
          style={[button.accent, styles.retryButton]}
          accessibilityRole="button"
          accessibilityLabel={t("retryExperienceAriaLabel")}
          {...{ "dd-action-name": "experience-retry" }}
        >
          <Text style={button.accentText}>{t("tryAgain")}</Text>
        </Pressable>
      </View>
    )
  } else if (currentSlug === decodedSlug && !loading && experience == null) {
    // Terminal empty state: slug resolved but admin returned no experience
    // (deleted, unpublished, or bogus deep link). loading is false and error
    // is null — without this branch the spinner would never clear.
    content = (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>{t("noContent")}</Text>
        <Pressable
          onPress={refetch}
          style={[button.accent, styles.retryButton]}
          accessibilityRole="button"
          accessibilityLabel={t("tryAgainExperienceAriaLabel")}
          {...{ "dd-action-name": "experience-empty-retry" }}
        >
          <Text style={button.accentText}>{t("tryAgain")}</Text>
        </Pressable>
      </View>
    )
  } else {
    content = (
      <View style={layout.centered}>
        <ActivityIndicator size="small" color={TEXT_SECONDARY} />
      </View>
    )
  }

  return (
    <>
      {/* Full-bleed: the hero runs edge-to-edge under the status bar with a
          floating back button, suppressing the native nav bar for every entry
          point (search, library, deep link). */}
      <Stack.Screen options={{ headerShown: false }} />
      {content}
      <FloatingBackButton />
    </>
  )
}

const styles = StyleSheet.create({
  retryButton: {
    marginTop: 16,
  },
})
