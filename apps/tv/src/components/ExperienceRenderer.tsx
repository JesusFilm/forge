// SDUI renderer for one Experience — the /experience/[slug] detail screen.
// Uses WATCH_THEME (near-black) to match Video Details + Home; Crimson Gallery
// COLORS remain for series + legacy surfaces only.
import { useQuery } from "@apollo/client/react"
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native"
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native"

import { ScreenStateView } from "./ScreenStateView"
import { SectionDispatcher } from "./sections/SectionDispatcher"
import { ExperienceProvider } from "../contexts/ExperienceProvider"
import { HeroVisibilityProvider } from "./sections/heroVisibility"
import { HERO_PEEK, WATCH_THEME } from "./watch/watchDetailTheme"
import {
  blockKey,
  normalizeExperience,
  type NormalizedBlock,
} from "../lib/normalizer"
import { GET_WATCH_EXPERIENCE } from "../lib/queries"
import { GET_WATCH_HOME_VIDEOS } from "../lib/watchHome/homeQueries"
import {
  buildVideoByCoreId,
  collectMediaCollectionCoreIds,
} from "../lib/experienceHydration"
import { reportDatadogError } from "../lib/datadog"
import { scale } from "../lib/scale"

const { height: SCREEN_HEIGHT } = Dimensions.get("window")
// INVARIANT: one videoHero, authored FIRST (y≈0 when visible) — this top-anchored
// threshold + the shared heroOnScreen boolean assume it; a non-first/second hero would
// invert the pause or double audio. 60% margin so the first-card reveal-scroll won't trip it.
const HERO_OFFSCREEN_THRESHOLD = (SCREEN_HEIGHT - HERO_PEEK) * 0.6

type Props = {
  /** Experience slug to load via the public experienceBySlug query. */
  slug: string
  /**
   * Optional STICKY first child of the ScrollView (home's nav header). Must stay
   * inside the same ScrollView: tvOS focus can't cross a parent-View boundary, so
   * a sibling header makes D-pad-up a no-op (docs/solutions/best-practices/tv-focus-driven-hero-patterns-20260420.md).
   */
  header?: ReactNode
}

/** Renders one Experience's blocks; `header` (if given) is the sticky first child. */
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
    return normalizeExperience(rawExperience)
  }, [rawExperience])

  // MediaCollection cards carry no usable title/image, so hydrate them by coreId
  // through the same query the Home rail uses. Skipped until the experience (and
  // thus its coreIds) resolves; the map defaults empty so cards never wait on it.
  const coreIds = useMemo(
    () => collectMediaCollectionCoreIds(experience?.sections),
    [experience],
  )
  const { data: hydrationData, error: hydrationError } = useQuery(
    GET_WATCH_HOME_VIDEOS,
    {
      variables: { coreIds, locale: "en", languageSlug: null },
      skip: coreIds.length === 0,
    },
  )
  const videoByCoreId = useMemo(
    () => buildVideoByCoreId(hydrationData?.watchHomeVideos),
    [hydrationData],
  )

  // Never-silent: a hydration failure degrades every MediaCollection card to its
  // authored fallback ("Untitled" / gradient), so surface it instead of hiding it.
  useEffect(() => {
    if (!hydrationError) return
    if (__DEV__) {
      console.warn(
        "[experience] MediaCollection hydration failed",
        hydrationError,
      )
    }
    reportDatadogError(hydrationError, {
      event: "experience_hydration_failed",
      slug,
      coreIds: coreIds.length,
    })
  }, [hydrationError, slug, coreIds.length])

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
      const key = blockKey(section)
      if (key) {
        sectionPositions.current.set(key, y)
        sectionKeyToIndex.current.set(key, index)
      }
    },
    [],
  )

  /**
   * Register a nested block's absolute Y: its offsetWithinSection plus the
   * parent section View's own Y (from handleSectionLayout).
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

      const key = blockKey(block)
      if (key) {
        sectionPositions.current.set(key, absoluteY)
        sectionKeyToIndex.current.set(key, parentIndex)
      }
      // Also index container slot children at the container's Y
      if (block.kind === "container") {
        for (const slot of block.slots) {
          for (const child of slot.slotContent) {
            const childKey = blockKey(child)
            if (childKey) {
              sectionPositions.current.set(childKey, absoluteY)
              sectionKeyToIndex.current.set(childKey, parentIndex)
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
    // Subtract sticky header height (0 on detail) so the section top clears the
    // pinned header. sectionPositions' Y already includes the header height, so
    // without this the pinned overlay occludes the target's top by ~headerHeight.
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

  // Hero scroll-off pause (R10), read via HeroVisibilityProvider. onScroll firing
  // during tvOS focus-scroll is unproven — if the sim shows it doesn't, derive
  // on-screen from the focused-section index instead (U8 fallback).
  const [heroOnScreen, setHeroOnScreen] = useState(true)
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = e.nativeEvent.contentOffset.y < HERO_OFFSCREEN_THRESHOLD
      setHeroOnScreen((prev) => (prev === next ? prev : next))
    },
    [],
  )

  if (loading) {
    return (
      <StateScreen header={header}>
        <ScreenStateView kind="loading" accent={WATCH_THEME.accent} />
      </StateScreen>
    )
  }

  if (errorMessage) {
    // The "press menu to go back" hint only applies to the pushed detail
    // screen — the home screen (which passes a header) is the root, so
    // suppress it there.
    return (
      <StateScreen header={header}>
        <ScreenStateView
          kind="error"
          message={errorMessage}
          onRetry={handleRefetch}
          accent={WATCH_THEME.accent}
          hint={header == null ? "Press menu to go back" : undefined}
        />
      </StateScreen>
    )
  }

  if (!experience || experience.sections.length === 0) {
    return (
      <StateScreen header={header}>
        <ScreenStateView kind="empty" message="No content available" />
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
      videoByCoreId={videoByCoreId}
      refetch={handleRefetch}
    >
      <HeroVisibilityProvider value={heroOnScreen}>
        <ScrollView
          ref={scrollViewRef}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          onScroll={handleScroll}
          scrollEventThrottle={100}
          // Header (when present) is the sticky first child, prepended outside
          // the section .map(), so scroll-to-section indices stay 0-based.
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
              key={`${section.kind}-${blockKey(section) ?? "block"}-${index}`}
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
      </HeroVisibilityProvider>
    </ExperienceProvider>
  )
}

/**
 * Centered status screen (loading / error / empty). A `header` (home) renders
 * above as a plain top row so nav + Search stay reachable while resolving;
 * detail passes none and gets the bare centered layout.
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: WATCH_THEME.below,
  },
  list: {
    flex: 1,
    backgroundColor: WATCH_THEME.below,
  },
  listContent: {
    // Lets the last section scroll fully to the viewport top; without it
    // scrollToSection stops short, the focus anchor stays off-screen, and
    // tvOS can't transfer focus to the target section.
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
    color: WATCH_THEME.text,
    fontSize: 20,
    fontFamily: "System",
  },
})
