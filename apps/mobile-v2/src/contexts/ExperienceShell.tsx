/**
 * ExperienceShell — wraps the root layout to provide Experience data
 * to both (tabs) and video/[sectionKey] routes.
 *
 * Reads the active slug from ExperienceSelectionProvider.
 * On first launch (no persisted slug), resolves the default by querying
 * LIST_EXPERIENCES for the isHomepage experience or the first available.
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
import { LIST_EXPERIENCES } from "../lib/queries"
import { BG_COLOR, TEXT_PRIMARY, TEXT_SECONDARY, ACCENT } from "../lib/color"
import { ExperienceProvider } from "./ExperienceProvider"
import { useExperienceSelection } from "./ExperienceSelectionProvider"

export function ExperienceShell({ children }: { children: ReactNode }) {
  const { currentSlug, selectExperience, isReady } = useExperienceSelection()

  // Resolve default slug on first launch when no slug is persisted
  const needsDefault = isReady && currentSlug === null
  const {
    data: listData,
    loading: listLoading,
    error: listError,
    refetch: listRefetch,
  } = useQuery(LIST_EXPERIENCES, {
    variables: { locale: "en" },
    skip: !needsDefault,
    fetchPolicy: "cache-and-network",
  })

  // Guard against stale closure overwriting a user selection
  const resolvedRef = useRef(false)
  useEffect(() => {
    if (!needsDefault) {
      resolvedRef.current = false
      return
    }
    if (resolvedRef.current || !listData?.experiences) return
    const experiences = listData.experiences.filter(
      (e): e is NonNullable<typeof e> => e !== null,
    )
    const homepage = experiences.find((e) => e.isHomepage)
    const fallback = experiences[0]
    const resolved = homepage ?? fallback
    if (resolved) {
      resolvedRef.current = true
      selectExperience(resolved.slug)
    }
  }, [needsDefault, listData, selectExperience])

  // Block subtree until AsyncStorage resolves (~<10ms)
  if (!isReady) return null

  // First launch: show loading or error while resolving default slug
  if (currentSlug === null) {
    if (listError) {
      return (
        <View style={styles.center}>
          <Text style={styles.errorText}>Unable to load experiences</Text>
          <Pressable
            onPress={() => listRefetch()}
            style={styles.retryButton}
            accessibilityRole="button"
            accessibilityLabel="Retry loading experiences"
          >
            <Text style={styles.retryText}>Try Again</Text>
          </Pressable>
        </View>
      )
    }
    if (listLoading || needsDefault) {
      return (
        <View style={styles.center}>
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: BG_COLOR,
  },
  errorText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: ACCENT,
    borderRadius: 8,
  },
  retryText: {
    color: TEXT_PRIMARY,
    fontFamily: "System",
    fontSize: 16,
    fontWeight: "600",
  },
})
