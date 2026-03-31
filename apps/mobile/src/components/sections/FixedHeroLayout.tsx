import { useCallback, useMemo, useRef, useState } from "react"
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native"
import {
  ScrollContext,
  useScrollHandle,
} from "../../contexts/ScrollOffsetContext"
import type { ExperienceSection } from "../../lib/sectionModels"
import { VolumeOffIcon, VolumeOnIcon } from "../icons/VolumeIcons"
import { SectionNavContext, type SectionNavValue } from "./SectionNavContext"
import { SectionDispatcher } from "./SectionDispatcher"
import { HeroSectionContext } from "./HeroSectionContext"
import {
  DEFAULT_ESTIMATED_HEIGHT,
  ESTIMATED_HEIGHTS,
  LazySection,
  MOUNT_BUFFER_VH,
} from "./LazySection"
import { VideoHeroOverlay, VideoHeroRenderer } from "./VideoHeroRenderer"

/**
 * Returns which sections should be initially mounted based on cumulative
 * estimated heights and the viewport size.
 */
function computeInitialMountState(
  sections: ExperienceSection[],
  viewportHeight: number,
  heroSpacerHeight: number,
): boolean[] {
  const mountThreshold = viewportHeight + viewportHeight * MOUNT_BUFFER_VH
  let cumulativeY = heroSpacerHeight

  return sections.map((section) => {
    const sectionTop = cumulativeY
    const estimatedHeight =
      ESTIMATED_HEIGHTS[section.kind] ?? DEFAULT_ESTIMATED_HEIGHT
    cumulativeY += estimatedHeight
    // Mount if the section top is within the initial mount threshold
    return sectionTop < mountThreshold
  })
}

/** Scroll distance over which the blur/dim effect reaches full intensity. */
const BLUR_DISTANCE = 400

/** Duration (ms) for the smooth scroll animation on nav carousel tap. */
const SCROLL_DURATION = 800

/** Ease-in-out cubic easing function. */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

interface FixedHeroLayoutProps {
  sections: ExperienceSection[]
}

/**
 * Renders an experience's sections with a fixed video hero layout when the
 * first section is a `videoHero`. The video fills the viewport and stays
 * pinned via position:absolute. The overlay and content sections scroll
 * normally over the video via a transparent ScrollView.
 *
 * When no video hero is present, renders a standard scrollable list.
 */
export function FixedHeroLayout({ sections }: FixedHeroLayoutProps) {
  const { height: viewportHeight } = useWindowDimensions()
  const scrollHandle = useScrollHandle()
  const scrollRef = useRef<ScrollView>(null)
  const isProgrammaticScroll = useRef(false)
  const scrollOffsetRef = useRef(0)
  const [isMuted, setIsMuted] = useState(true)
  const sectionRefs = useRef(new Map<string, View>())
  const activeAnimation = useRef<{ cancelled: boolean }>({ cancelled: false })

  // Lazy section gating: skip mount/unmount during programmatic scroll
  const [skipLazyGating, setSkipLazyGating] = useState(false)
  // Force-mount a specific section key (for scrollToSection pre-mount)
  const [forceMountKey, setForceMountKey] = useState<string | null>(null)

  const sectionNav: SectionNavValue = useMemo(
    () => ({
      scrollToSection(sectionKey: string) {
        // Force-mount the target section before measuring/animating.
        setForceMountKey(sectionKey)

        // Use requestAnimationFrame to allow the force-mounted section to
        // render and register its ref before we try to measure it.
        requestAnimationFrame(() => {
          const view = sectionRefs.current.get(sectionKey)
          if (!view) {
            if (__DEV__) {
              console.warn(
                `[SectionNav] No section registered for key: "${sectionKey}"`,
              )
            }
            setForceMountKey(null)
            return
          }

          // Measure the view's absolute screen position, then animate
          // to the scroll-content-relative Y with ease-in-out easing.
          view.measureInWindow((_x, windowY, _w, height) => {
            const cleanup = () => {
              isProgrammaticScroll.current = false
              setSkipLazyGating(false)
              setForceMountKey(null)
            }

            if (windowY == null || height === 0) {
              setForceMountKey(null)
              return
            }

            // Cancel any in-flight animation before starting a new one.
            activeAnimation.current.cancelled = true
            const animation = { cancelled: false }
            activeAnimation.current = animation

            const targetY = scrollOffsetRef.current + windowY - 100
            const startY = scrollOffsetRef.current
            const distance = targetY - startY
            if (Math.abs(distance) < 1) {
              setForceMountKey(null)
              return
            }

            isProgrammaticScroll.current = true
            setSkipLazyGating(true)
            const startTime = Date.now()

            const step = () => {
              if (animation.cancelled) {
                cleanup()
                return
              }
              const elapsed = Date.now() - startTime
              const progress = Math.min(elapsed / SCROLL_DURATION, 1)
              const easedY = startY + distance * easeInOutCubic(progress)
              scrollRef.current?.scrollTo({ y: easedY, animated: false })

              if (progress < 1) {
                requestAnimationFrame(step)
              } else {
                cleanup()
              }
            }
            requestAnimationFrame(step)
          })
        })
      },
      registerSectionRef(sectionKey: string, ref: View | null) {
        if (ref) {
          sectionRefs.current.set(sectionKey, ref)
        } else {
          sectionRefs.current.delete(sectionKey)
        }
      },
    }),
    [],
  )

  // Track scroll state for pause/resume and blur.
  // `paused` toggles only at the 0 boundary to avoid re-renders while scrolling.
  // `blurBracket` is a coarse 0–10 value (not raw offset) to limit re-renders
  // to ~10 discrete steps instead of 60fps continuous updates.
  const [paused, setPaused] = useState(false)
  const [blurBracket, setBlurBracket] = useState(0)
  const lastBracketRef = useRef(0)

  const heroSection = sections[0]?.kind === "videoHero" ? sections[0] : null
  const remainingSections = heroSection ? sections.slice(1) : sections

  // Compute which sections should be mounted on initial render based on
  // cumulative estimated heights. This avoids both mounting everything
  // (which crashes Android) and showing all placeholders (blank flash).
  // Computed once on mount — sections/viewportHeight are stable for the
  // lifetime of this component instance.
  const [initialMountState] = useState(() =>
    computeInitialMountState(
      remainingSections,
      viewportHeight,
      heroSection ? viewportHeight : 0,
    ),
  )

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollHandle.handleScroll(e)
      scrollOffsetRef.current = e.nativeEvent.contentOffset.y
      if (isProgrammaticScroll.current) return
      const y = e.nativeEvent.contentOffset.y

      // Pause: only update state at the 0 boundary
      setPaused((prev) => {
        const next = y > 0
        return prev === next ? prev : next
      })

      // Blur: quantize to 10 brackets (0.0, 0.1, 0.2, ... 1.0) to limit re-renders
      const bracket = Math.min(Math.round((y / BLUR_DISTANCE) * 10), 10)
      if (bracket !== lastBracketRef.current) {
        lastBracketRef.current = bracket
        setBlurBracket(bracket)
      }
    },
    [scrollHandle],
  )

  const blurOpacity = blurBracket / 10

  // No hero — render standard scrollable list
  if (!heroSection) {
    return (
      <ScrollContext.Provider value={scrollHandle}>
        <SectionNavContext.Provider value={sectionNav}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            onScroll={handleScroll}
            onMomentumScrollEnd={handleScroll}
            scrollEventThrottle={16}
          >
            {sections.map((section, index) => (
              <LazySection
                key={`${section.id}-${index}`}
                sectionKind={section.kind}
                scrollOffsetRef={scrollOffsetRef}
                initiallyMounted={initialMountState[index] ?? true}
                forceMount={
                  section.sectionKey != null &&
                  section.sectionKey === forceMountKey
                }
                skipLazyGating={skipLazyGating}
              >
                <View
                  ref={(ref) => {
                    if (section.sectionKey) {
                      sectionNav.registerSectionRef(section.sectionKey, ref)
                    }
                  }}
                >
                  <SectionDispatcher section={section} />
                </View>
              </LazySection>
            ))}
          </ScrollView>
        </SectionNavContext.Provider>
      </ScrollContext.Provider>
    )
  }

  return (
    <ScrollContext.Provider value={scrollHandle}>
      <SectionNavContext.Provider value={sectionNav}>
        <View style={styles.root}>
          <View style={styles.heroContainer} pointerEvents="box-none">
            <VideoHeroRenderer
              section={heroSection}
              heroHeight={viewportHeight}
              hideOverlay
              muted={isMuted}
              paused={paused}
              blurOpacity={blurOpacity}
            />
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.scrollTransparent}
            contentContainerStyle={styles.content}
            bounces={false}
            overScrollMode="never"
            onScroll={handleScroll}
            onMomentumScrollEnd={handleScroll}
            scrollEventThrottle={16}
            scrollIndicatorInsets={
              Platform.OS === "ios" ? { top: viewportHeight } : undefined
            }
          >
            <View
              style={[
                styles.overlaySpacerContainer,
                { height: viewportHeight },
              ]}
              pointerEvents="box-none"
            >
              <VideoHeroOverlay
                section={heroSection}
                trailingContent={
                  <Pressable
                    style={styles.muteButton}
                    onPress={() => setIsMuted((prev) => !prev)}
                    accessibilityRole="button"
                    accessibilityLabel={isMuted ? "Unmute video" : "Mute video"}
                  >
                    {isMuted ? <VolumeOffIcon /> : <VolumeOnIcon />}
                  </Pressable>
                }
              />
            </View>

            <HeroSectionContext.Provider value={true}>
              <View style={styles.translucentSection}>
                {remainingSections.map((section, index) => (
                  <LazySection
                    key={`${section.id}-${index}`}
                    sectionKind={section.kind}
                    scrollOffsetRef={scrollOffsetRef}
                    contentOffsetY={viewportHeight}
                    initiallyMounted={initialMountState[index] ?? true}
                    forceMount={
                      section.sectionKey != null &&
                      section.sectionKey === forceMountKey
                    }
                    skipLazyGating={skipLazyGating}
                  >
                    <View
                      ref={(ref) => {
                        if (section.sectionKey) {
                          sectionNav.registerSectionRef(section.sectionKey, ref)
                        }
                      }}
                    >
                      <SectionDispatcher section={section} />
                    </View>
                  </LazySection>
                ))}
              </View>
            </HeroSectionContext.Provider>
          </ScrollView>
        </View>
      </SectionNavContext.Provider>
    </ScrollContext.Provider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#000",
  },
  heroContainer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  scroll: {
    flex: 1,
    backgroundColor: "#fff",
  },
  scrollTransparent: {
    flex: 1,
    zIndex: 1,
    backgroundColor: "transparent",
  },
  content: {
    paddingBottom: 40,
  },
  overlaySpacerContainer: {
    justifyContent: "flex-end",
  },
  translucentSection: {
    backgroundColor: "rgba(0, 0, 0, 0.8)",
  },
  muteButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
})
