import { useCallback, useMemo, useRef, useState } from "react"
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
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
import { SectionNavContext, type SectionNavValue } from "./SectionNavContext"
import { SectionDispatcher } from "./SectionDispatcher"
import { VideoHeroOverlay, VideoHeroRenderer } from "./VideoHeroRenderer"

/** Scroll distance over which the blur/dim effect reaches full intensity. */
const BLUR_DISTANCE = 400

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
  const sectionRefs = useRef(new Map<string, View>())

  const sectionNav: SectionNavValue = useMemo(
    () => ({
      scrollToSection(sectionKey: string) {
        const view = sectionRefs.current.get(sectionKey)
        if (!view) {
          if (__DEV__) {
            console.warn(
              `[SectionNav] No section registered for key: "${sectionKey}"`,
            )
          }
          return
        }

        // Measure the view's absolute screen position, then compute
        // the scroll-content-relative Y using the current scroll offset.
        view.measureInWindow((_x, windowY) => {
          const targetY = scrollOffsetRef.current + windowY
          isProgrammaticScroll.current = true
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ y: targetY, animated: true })
            setTimeout(() => {
              isProgrammaticScroll.current = false
            }, 400)
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
            scrollEventThrottle={16}
          >
            {sections.map((section, index) => (
              <View
                key={`${section.id}-${index}`}
                ref={(ref) => {
                  if (section.sectionKey) {
                    sectionNav.registerSectionRef(section.sectionKey, ref)
                  }
                }}
              >
                <SectionDispatcher section={section} />
              </View>
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
              <VideoHeroOverlay section={heroSection} />
            </View>

            {remainingSections.map((section, index) => (
              <View
                key={`${section.id}-${index}`}
                style={styles.opaqueSection}
                ref={(ref) => {
                  if (section.sectionKey) {
                    sectionNav.registerSectionRef(section.sectionKey, ref)
                  }
                }}
              >
                <SectionDispatcher section={section} />
              </View>
            ))}
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
  opaqueSection: {
    backgroundColor: "#1a1a1a",
  },
})
