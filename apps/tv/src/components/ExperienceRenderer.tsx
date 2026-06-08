// Shared Server-Driven-UI renderer for a single Experience.
//
// Both the home screen (apps/tv/app/index.tsx) and the experience-detail
// screen (apps/tv/app/experience/[slug].tsx) render an Experience the same
// way: fetch experienceBySlug (PUBLIC), normalize, then map blocks through
// SectionDispatcher inside a scroll-to-section-aware ScrollView. Keeping that
// logic in one place is deliberate — the home previously diverged onto the
// editor-gated Query.experiences and broke for the public TV app. The home
// passes a `header` slot (its sticky nav row); the detail screen passes none.
import { useQuery } from "@apollo/client/react"
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native"

import { SectionDispatcher } from "./sections/SectionDispatcher"
import { ExperienceProvider } from "../contexts/ExperienceProvider"
import { normalizeExperience, type NormalizedBlock } from "../lib/normalizer"
import { GET_WATCH_EXPERIENCE } from "../lib/queries"
import { scale } from "../lib/scale"

type Props = {
  /** Experience slug to load via the public experienceBySlug query. */
  slug: string
  /**
   * Optional node rendered as the STICKY first child of the ScrollView. The
   * home screen passes its nav header here so it pins to the top during
   * scroll while staying inside the same ScrollView — the tvOS focus engine
   * cannot traverse focus across a parent-View boundary, so a sibling header
   * makes D-pad-up from the first section a no-op (proven empirically; see
   * docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md).
   */
  header?: ReactNode
}

/**
 * Renders one Experience's blocks. `header`, when provided, becomes the
 * sticky first child; without it the screen is plain (detail screen).
 */
export function ExperienceRenderer({ slug, header }: Props) {
  const { data, loading, error, refetch } = useQuery(GET_WATCH_EXPERIENCE, {
    variables: {
      locale: "en",
      slug,
    },
    skip: !slug,
  })

  const rawExperience = data?.experienceBySlug

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
  // Measured height of the sticky header slot (0 when no header — i.e. the
  // detail screen). scrollToSection subtracts this so a scrolled-to section's
  // top clears the pinned header instead of landing behind it.
  const headerHeightRef = useRef(0)

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
    const base = Platform.OS === "android" ? Math.max(0, y - 24) : y
    // Subtract the sticky header height (0 on the detail screen, which has no
    // header) so the section top clears the pinned header rather than landing
    // behind it. sectionPositions stores Y within the ScrollView content,
    // which already includes the header's own height, so the pinned overlay
    // would otherwise occlude the target's top by ~headerHeight.
    const offset = Math.max(0, base - headerHeightRef.current)
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
      <StateScreen header={header}>
        <ActivityIndicator size="large" color="#CB333B" />
      </StateScreen>
    )
  }

  if (errorMessage) {
    // The "press menu to go back" hint only applies to the pushed detail
    // screen — the home screen (which passes a header) is the root, so
    // suppress it there.
    return (
      <ErrorState
        message={errorMessage}
        onRetry={handleRefetch}
        showBackHint={header == null}
        header={header}
      />
    )
  }

  if (!experience || experience.sections.length === 0) {
    return (
      <StateScreen header={header}>
        <Text style={styles.emptyText}>No content available</Text>
      </StateScreen>
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
        // When a header slot is present it is the sticky first child. The
        // section .map() index below stays 0-based regardless (the header
        // is prepended outside the map), so scroll-to-section indices are
        // unaffected by the header's presence.
        stickyHeaderIndices={header != null ? [0] : undefined}
      >
        {header != null ? (
          <View
            onLayout={(e) => {
              headerHeightRef.current = e.nativeEvent.layout.height
            }}
          >
            {header}
          </View>
        ) : null}
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

/**
 * Centered status screen (loading / error / empty). When a `header` slot is
 * present (the home), it is rendered above the centered content as a plain
 * (non-sticky) top row so the nav — and its Search chip — stays reachable
 * while the experience resolves; the detail screen passes no header and gets
 * the bare centered layout it had before.
 */
function StateScreen({
  header,
  children,
}: {
  header?: ReactNode
  children: ReactNode
}) {
  if (header == null) {
    return <View style={styles.centered}>{children}</View>
  }
  return (
    <View style={styles.screen}>
      {header}
      <View style={styles.centered}>{children}</View>
    </View>
  )
}

function ErrorState({
  message,
  onRetry,
  showBackHint,
  header,
}: {
  message: string
  onRetry: () => void
  showBackHint: boolean
  header?: ReactNode
}) {
  const [focused, setFocused] = useState(false)

  return (
    <StateScreen header={header}>
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
      {showBackHint ? (
        <Text style={styles.backHint}>Press menu to go back</Text>
      ) : null}
    </StateScreen>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#161311",
  },
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
