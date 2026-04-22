import { useQuery } from "@apollo/client/react"
import { useLocalSearchParams } from "expo-router"
import React, { useCallback, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SectionDispatcher } from "../../src/components/sections/SectionDispatcher"
import { ExperienceProvider } from "../../src/contexts/ExperienceProvider"
import {
  normalizeExperience,
  type NormalizedBlock,
} from "../../src/lib/normalizer"
import { GET_WATCH_EXPERIENCE } from "../../src/lib/queries"
import { scale } from "../../src/lib/scale"

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

  // ── Scroll-to-section infrastructure ──────────────────────────────────────
  // Hooks must come before any early returns (React rules of hooks).
  const scrollViewRef = useRef<ScrollView>(null)
  const sectionPositions = useRef<Map<string, number>>(new Map())
  const sectionKeyToIndex = useRef<Map<string, number>>(new Map())
  const focusAnchors = useRef<Map<number, React.ElementRef<typeof Pressable>>>(
    new Map(),
  )

  /** Register the Y position and index for a top-level section. */
  const handleSectionLayout = useCallback(
    (section: NormalizedBlock, index: number, y: number) => {
      const key =
        (section.sectionKey as string | undefined) ??
        (section.id as string | undefined)
      if (key) {
        sectionPositions.current.set(key, y)
        sectionKeyToIndex.current.set(key, index)
      }
    },
    [],
  )

  /**
   * Register the Y position for a nested block inside a sectionWrapper.
   * offsetWithinSection is the block's Y relative to the section View.
   * We add the section View's own Y (from handleSectionLayout) to get
   * the absolute Y within the ScrollView content.
   */
  const handleNestedLayout = useCallback(
    (
      block: NormalizedBlock,
      parentIndex: number,
      offsetWithinSection: number,
    ) => {
      // Look up the parent section View's Y within the ScrollView
      const parentKey = `__parentY_${parentIndex}`
      const parentY = sectionPositions.current.get(parentKey) ?? 0
      const absoluteY = parentY + offsetWithinSection

      const key =
        (block.sectionKey as string | undefined) ??
        (block.id as string | undefined)
      if (key) {
        sectionPositions.current.set(key, absoluteY)
        sectionKeyToIndex.current.set(key, parentIndex)
      }
      // Also index container slot children at the container's Y
      if (block.kind === "container" && Array.isArray(block.slots)) {
        for (const slot of block.slots as Array<{
          slotContent?: NormalizedBlock[]
        }>) {
          if (Array.isArray(slot.slotContent)) {
            for (const child of slot.slotContent) {
              const childKey =
                (child.sectionKey as string | undefined) ??
                (child.id as string | undefined)
              if (childKey) {
                sectionPositions.current.set(childKey, absoluteY)
                sectionKeyToIndex.current.set(childKey, parentIndex)
              }
            }
          }
        }
      }
    },
    [],
  )

  const scrollToSection = useCallback((key: string) => {
    const y = sectionPositions.current.get(key)
    if (y == null) return
    // On Android TV, add top padding so the target section doesn't sit
    // flush against the screen edge (particularly noticeable for the
    // first navigation card which scrolls to the topmost content section).
    const offset = Platform.OS === "android" ? Math.max(0, y - 24) : y
    scrollViewRef.current?.scrollTo({ y: offset, animated: true })

    // Delay focus transfer until the scroll animation is mostly complete.
    // Calling setNativeProps mid-scroll can be ignored by the focus engine
    // because the target element is still off-screen.
    const targetIndex = sectionKeyToIndex.current.get(key)
    if (targetIndex != null) {
      setTimeout(() => {
        const anchor = focusAnchors.current.get(targetIndex)
        if (anchor) {
          anchor.setNativeProps({ hasTVPreferredFocus: true })
        }
      }, 400)
    }
  }, [])

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
      scrollToSection={scrollToSection}
      registerNestedLayout={handleNestedLayout}
      refetch={handleRefetch}
    >
      <ScrollView
        ref={scrollViewRef}
        style={styles.list}
        contentContainerStyle={styles.listContent}
      >
        {experience.sections.map((section, index) => (
          <View
            key={`${section.kind}-${section.id}-${index}`}
            onLayout={(e) => {
              const y = e.nativeEvent.layout.y
              handleSectionLayout(section, index, y)
              // Store the Y so SectionWrapperRenderer can compute
              // absolute positions for nested children
              sectionPositions.current.set(`__parentY_${index}`, y)
            }}
          >
            {/* Invisible focus anchor — receives focus after scrollToSection
                so the next D-pad press starts from this section, not the
                NavigationCarousel card that triggered the scroll. */}
            <Pressable
              ref={(ref) => {
                if (ref) focusAnchors.current.set(index, ref)
                else focusAnchors.current.delete(index)
              }}
              style={styles.focusAnchor}
              accessible={false}
            />
            <SectionDispatcher section={section} parentIndex={index} />
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
    // Extra bottom padding ensures the last section can scroll fully to the
    // top of the viewport. Without this, scrollToSection for the last nav
    // card stops short and the invisible focus anchor remains off-screen,
    // preventing tvOS from transferring focus to the target section.
    paddingBottom: scale(600),
  },
  focusAnchor: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 48,
    opacity: 0,
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
