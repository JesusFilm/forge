/**
 * ExperienceShell — wraps the root layout to provide Experience data
 * to both (tabs) and video/[sectionKey] routes.
 *
 * Reads the active slug from ExperienceSelectionProvider.
 * On first launch (no persisted slug), resolves the homepage via
 * admin's watchSetting query.
 */
import { useEffect, useRef, type ReactNode } from "react"
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native"
import { useQuery } from "@apollo/client/react"
import { useExperience } from "../hooks/useExperience"
import { GET_WATCH_SETTING } from "../lib/queries"
import { TEXT_PRIMARY, TEXT_SECONDARY } from "../lib/color"
import { layout, button } from "../styles/shared"
import { ExperienceProvider } from "./ExperienceProvider"
import { useExperienceSelection } from "./ExperienceSelectionProvider"

export function ExperienceShell({ children }: { children: ReactNode }) {
  const { currentSlug, selectExperience, isReady } = useExperienceSelection()

  const needsDefault = isReady && currentSlug === null
  const {
    data: settingData,
    loading: settingLoading,
    error: settingError,
    refetch: settingRefetch,
  } = useQuery(GET_WATCH_SETTING, {
    variables: { locale: "en" },
    skip: !needsDefault,
    fetchPolicy: "cache-and-network",
  })

  const resolvedRef = useRef(false)
  useEffect(() => {
    if (!needsDefault) {
      resolvedRef.current = false
      return
    }
    if (resolvedRef.current) return
    const homepage = settingData?.watchSetting?.homepageExperience
    if (homepage?.slug) {
      resolvedRef.current = true
      selectExperience(homepage.slug)
    }
  }, [needsDefault, settingData, selectExperience])

  if (!isReady) return null

  if (currentSlug === null) {
    if (settingError) {
      return (
        <View style={layout.centered}>
          <Text style={styles.errorText}>Unable to load experiences</Text>
          <Pressable
            onPress={() => settingRefetch()}
            style={button.accent}
            accessibilityRole="button"
            accessibilityLabel="Retry loading experiences"
          >
            <Text style={button.accentText}>Try Again</Text>
          </Pressable>
        </View>
      )
    }
    if (settingLoading || needsDefault) {
      return (
        <View style={layout.centered}>
          <ActivityIndicator size="small" color={TEXT_SECONDARY} />
        </View>
      )
    }
    return null
  }

  return (
    <ExperienceShellInner slug={currentSlug}>{children}</ExperienceShellInner>
  )
}

function ExperienceShellInner({
  slug,
  children,
}: {
  slug: string
  children: ReactNode
}) {
  const { experience, loading, error, refetch } = useExperience({ slug })

  return (
    <ExperienceProvider
      experience={experience}
      loading={loading}
      error={error}
      refetch={refetch}
    >
      {children}
    </ExperienceProvider>
  )
}

const styles = StyleSheet.create({
  errorText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    marginBottom: 16,
  },
})
