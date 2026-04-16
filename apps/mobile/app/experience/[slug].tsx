import { useEffect } from "react"
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native"
import { useLocalSearchParams, useNavigation } from "expo-router"

import { useExperience } from "../../src/hooks/useExperience"
import { ExperienceProvider } from "../../src/contexts/ExperienceProvider"
import { SectionDispatcher } from "../../src/components/sections/SectionDispatcher"
import { ACCENT, BG_COLOR, TEXT_PRIMARY } from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"

export default function ExperienceBySlugScreen() {
  const { slug: rawSlug } = useLocalSearchParams<{ slug: string }>()

  let slug: string | null = null
  try {
    slug = rawSlug ? decodeURIComponent(rawSlug) : null
  } catch {
    slug = null
  }

  const { experience, loading, error, refetch } = useExperience({
    slug: slug ?? "",
  })

  const navigation = useNavigation()

  useEffect(() => {
    if (experience?.title) {
      navigation.setOptions({ headerTitle: experience.title })
    }
  }, [navigation, experience?.title])

  if (slug == null) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>Invalid link</Text>
        <Text style={text.errorMessage}>
          Could not decode the experience URL.
        </Text>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={layout.centered}>
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    )
  }

  if (error || !experience) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>{error ?? "Experience not found"}</Text>
        <Pressable
          onPress={refetch}
          accessibilityRole="button"
          accessibilityLabel="Retry loading"
          style={{
            marginTop: 16,
            paddingHorizontal: 20,
            paddingVertical: 10,
            backgroundColor: ACCENT,
            borderRadius: 8,
          }}
        >
          <Text
            style={{ color: TEXT_PRIMARY, fontFamily: "System", fontSize: 15 }}
          >
            Try again
          </Text>
        </Pressable>
      </View>
    )
  }

  return (
    <ExperienceProvider
      experience={experience}
      loading={false}
      error={null}
      refetch={refetch}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: BG_COLOR }}
        contentContainerStyle={{ paddingBottom: 48 }}
        showsVerticalScrollIndicator={false}
      >
        {experience.sections.map((section, index) => (
          <SectionDispatcher
            key={`${section.kind}-${section.id ?? index}`}
            section={section}
          />
        ))}
      </ScrollView>
    </ExperienceProvider>
  )
}
