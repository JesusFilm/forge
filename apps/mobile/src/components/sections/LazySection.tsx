import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { type LayoutChangeEvent, View, useWindowDimensions } from "react-native"

import { useScrollY } from "../../contexts/ScrollOffsetContext"
import type { ExperienceSection } from "../../lib/sectionModels"
import { LazySectionContext } from "./LazySectionContext"

/**
 * Mount buffer: sections mount when within this many viewport-heights of the
 * visible area. Kept tight to limit concurrent video decoder slots on Android.
 */
export const MOUNT_BUFFER_VH = 0.5

/**
 * Unmount buffer: sections unmount only when beyond this many viewport-heights.
 * The gap between mount and unmount buffers (hysteresis) prevents rapid
 * mount/unmount cycling at boundary edges.
 */
export const UNMOUNT_BUFFER_VH = 1.5

/** Per-section-kind estimated heights used before the first onLayout measurement. */
export const ESTIMATED_HEIGHTS: Partial<
  Record<ExperienceSection["kind"], number>
> = {
  text: 200,
  video: 220,
  mediaCollection: 350,
  sectionWrapper: 400,
  container: 350,
  bibleQuotesCarousel: 300,
  navigationCarousel: 280,
  relatedQuestions: 400,
  cta: 150,
  card: 250,
  quizButton: 100,
  easterDates: 200,
}

export const DEFAULT_ESTIMATED_HEIGHT = 300

interface LazySectionProps {
  children: React.ReactNode
  /** The section kind, used for estimated height lookup. */
  sectionKind: ExperienceSection["kind"]
  /** Ref-based scroll offset from FixedHeroLayout (updated on every scroll event). */
  scrollOffsetRef: React.RefObject<number>
  /**
   * Offset of the parent container within the ScrollView content.
   * `onLayout` gives Y relative to the immediate parent, not the scroll root.
   * In the hero path, this is `viewportHeight` (the hero spacer above
   * `translucentSection`). In the no-hero path, this is 0.
   */
  contentOffsetY?: number
  /** When true, the section is force-mounted regardless of scroll position. */
  forceMount?: boolean
  /** When true, mount/unmount decisions are skipped (e.g. during programmatic scroll). */
  skipLazyGating?: boolean
  /**
   * Whether this section should start mounted on the initial render.
   * Computed by the parent using cumulative estimated heights.
   */
  initiallyMounted?: boolean
}

/**
 * Viewport-gated lazy wrapper for experience sections.
 *
 * The outer wrapper View is always in the React tree so that:
 * - `onLayout` fires reliably and the Y offset is always known
 * - Section refs remain registered for `scrollToSection` navigation
 *
 * When the section is outside the mount buffer, children are replaced with a
 * height-preserving placeholder View. When inside, children render normally.
 *
 * Also tracks whether the section overlaps the actual viewport (0 buffer) and
 * exposes this via `LazySectionContext` so children (e.g. VideoRenderer) can
 * defer playback until truly visible.
 */
export function LazySection({
  children,
  sectionKind,
  scrollOffsetRef,
  contentOffsetY = 0,
  forceMount = false,
  skipLazyGating = false,
  initiallyMounted = true,
}: LazySectionProps) {
  const { height: viewportHeight } = useWindowDimensions()

  const [isMounted, setIsMounted] = useState(initiallyMounted || forceMount)
  const [isVisible, setIsVisible] = useState(false)

  // Y offset of the wrapper View relative to the ScrollView content.
  // Updated by onLayout — always available since the wrapper is always in the tree.
  const layoutYRef = useRef(0)

  // Cached height from the last time the child content was measured via onLayout.
  const measuredHeightRef = useRef<number | null>(null)

  // Clear cached height when viewport dimensions change (rotation, split-screen).
  useEffect(() => {
    measuredHeightRef.current = null
  }, [viewportHeight])

  // Whether onLayout has fired at least once (Y offset is known).
  const hasLayoutRef = useRef(false)

  // Track the wrapper View's Y offset within the scroll content.
  // After the first measurement, run an immediate visibility check so
  // sections that are already in the viewport get marked visible without
  // waiting for the next scroll event.
  const onWrapperLayout = useCallback(
    (e: LayoutChangeEvent) => {
      layoutYRef.current = e.nativeEvent.layout.y
      if (!hasLayoutRef.current) {
        hasLayoutRef.current = true
        // Immediate visibility check now that Y offset is known.
        const scrollY = scrollOffsetRef.current
        const sectionY = contentOffsetY + layoutYRef.current - scrollY
        const sectionHeight =
          measuredHeightRef.current ??
          ESTIMATED_HEIGHTS[sectionKind] ??
          DEFAULT_ESTIMATED_HEIGHT
        const sectionBottom = sectionY + sectionHeight
        const nowVisible = sectionBottom > 0 && sectionY < viewportHeight
        setIsVisible((prev) => (prev === nowVisible ? prev : nowVisible))
      }
    },
    [sectionKind, viewportHeight, contentOffsetY, scrollOffsetRef],
  )

  // Measure the actual child content height when it renders.
  const onChildLayout = useCallback((e: LayoutChangeEvent) => {
    measuredHeightRef.current = e.nativeEvent.layout.height
  }, [])

  // Subscribe to scroll events and check visibility.
  useScrollY(
    useCallback(
      (scrollY: number) => {
        // layoutYRef is relative to the parent View, not the scroll root.
        // Add contentOffsetY to get the true scroll-content position.
        const sectionY = contentOffsetY + layoutYRef.current - scrollY
        const sectionHeight =
          measuredHeightRef.current ??
          ESTIMATED_HEIGHTS[sectionKind] ??
          DEFAULT_ESTIMATED_HEIGHT
        const sectionBottom = sectionY + sectionHeight

        // Viewport visibility (0 buffer) — used by children to gate playback.
        const nowVisible = sectionBottom > 0 && sectionY < viewportHeight
        setIsVisible((prev) => (prev === nowVisible ? prev : nowVisible))

        if (forceMount || skipLazyGating) return

        setIsMounted((prev) => {
          if (!prev) {
            // Mount when section enters the mount buffer
            const mountBuffer = viewportHeight * MOUNT_BUFFER_VH
            if (
              sectionBottom > -mountBuffer &&
              sectionY < viewportHeight + mountBuffer
            ) {
              return true
            }
          } else {
            // Unmount when section exits the unmount buffer
            const unmountBuffer = viewportHeight * UNMOUNT_BUFFER_VH
            if (
              sectionBottom < -unmountBuffer ||
              sectionY > viewportHeight + unmountBuffer
            ) {
              return false
            }
          }
          return prev
        })
      },
      [forceMount, skipLazyGating, sectionKind, viewportHeight, contentOffsetY],
    ),
  )

  // Respond to forceMount changes (e.g. scrollToSection pre-mount).
  useEffect(() => {
    if (forceMount) {
      setIsMounted(true)
    }
  }, [forceMount])

  const placeholderHeight =
    measuredHeightRef.current ??
    ESTIMATED_HEIGHTS[sectionKind] ??
    DEFAULT_ESTIMATED_HEIGHT

  const contextValue = useMemo(() => ({ visible: isVisible }), [isVisible])

  return (
    <View onLayout={onWrapperLayout}>
      {isMounted ? (
        <LazySectionContext.Provider value={contextValue}>
          <View onLayout={onChildLayout}>{children}</View>
        </LazySectionContext.Provider>
      ) : (
        <View style={{ height: placeholderHeight }} />
      )}
    </View>
  )
}
