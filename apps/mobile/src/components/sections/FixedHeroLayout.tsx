import { useCallback, useState } from "react"
import {
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native"

import {
  ScrollContext,
  useScrollHandle,
} from "../../contexts/ScrollOffsetContext"
import type { ExperienceSection } from "../../lib/sectionModels"
import { SectionDispatcher } from "./SectionDispatcher"
import { VideoHeroOverlay, VideoHeroRenderer } from "./VideoHeroRenderer"

const VIEWPORT_HEIGHT = Dimensions.get("window").height

interface FixedHeroLayoutProps {
  sections: ExperienceSection[]
}

export function FixedHeroLayout({ sections }: FixedHeroLayoutProps) {
  const scrollHandle = useScrollHandle()
  const [scrolledAway, setScrolledAway] = useState(false)

  const heroSection = sections[0]?.kind === "videoHero" ? sections[0] : null
  const remainingSections = heroSection ? sections.slice(1) : sections

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollHandle.handleScroll(e)
      const y = e.nativeEvent.contentOffset.y
      // Pause when user scrolls at all; resume only at the very top
      setScrolledAway(y > 0)
    },
    [scrollHandle],
  )

  // No hero — render standard scrollable list
  if (!heroSection) {
    return (
      <ScrollContext.Provider value={scrollHandle}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          onScroll={scrollHandle.handleScroll}
          scrollEventThrottle={16}
        >
          {sections.map((section, index) => (
            <View key={`${section.id}-${index}`}>
              <SectionDispatcher section={section} />
            </View>
          ))}
        </ScrollView>
      </ScrollContext.Provider>
    )
  }

  return (
    <ScrollContext.Provider value={scrollHandle}>
      <View style={styles.root}>
        <View style={styles.heroContainer} pointerEvents="box-none">
          <VideoHeroRenderer
            section={heroSection}
            heroHeight={VIEWPORT_HEIGHT}
            hideOverlay
            paused={scrolledAway}
          />
        </View>

        <ScrollView
          style={styles.scrollTransparent}
          contentContainerStyle={styles.content}
          bounces={false}
          overScrollMode="never"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          scrollIndicatorInsets={
            Platform.OS === "ios" ? { top: VIEWPORT_HEIGHT } : undefined
          }
        >
          <View style={styles.overlaySpacerContainer} pointerEvents="box-none">
            <VideoHeroOverlay section={heroSection} />
          </View>

          {remainingSections.map((section, index) => (
            <View key={`${section.id}-${index}`} style={styles.opaqueSection}>
              <SectionDispatcher section={section} />
            </View>
          ))}
        </ScrollView>
      </View>
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
    height: VIEWPORT_HEIGHT,
    justifyContent: "flex-end",
  },
  opaqueSection: {
    backgroundColor: "#1a1a1a",
  },
})
