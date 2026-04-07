import { useCallback, useMemo, useRef, useState } from "react"
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  View,
  useWindowDimensions,
  type ViewToken,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { LinearGradient } from "expo-linear-gradient"

import { useExperienceContext } from "../../contexts/ExperienceProvider"
import type { NormalizedBlock } from "../../lib/normalizer"
import { BG_COLOR, hexToRgba } from "../../lib/color"
import { HomeHeader } from "../ui/HomeHeader"
import { classifySection, SectionDispatcher } from "./SectionDispatcher"
import { VideoHeroRenderer } from "./VideoHeroRenderer"
import { NavigationCarouselRenderer } from "./NavigationCarouselRenderer"

// ── Types ───────────────────────────────────────────────────────────────────

type FeedItem = {
  section: NormalizedBlock
  classification: "videoCard" | "standard"
}

// ── Component ───────────────────────────────────────────────────────────────

export function CuratedHomeLayout() {
  const { experience } = useExperienceContext()
  const { width: screenWidth } = useWindowDimensions()
  const heroHeight = screenWidth * 1.2

  const [heroPaused, setHeroPaused] = useState(false)
  const [heroBlurOpacity, setHeroBlurOpacity] = useState(0)

  const sections = experience?.sections ?? []

  // Extract hero if first section is videoHero
  const heroSection =
    sections.length > 0 && sections[0].kind === "videoHero" ? sections[0] : null

  const remainingSections = heroSection ? sections.slice(1) : sections

  // Find navigationCarousel in remaining sections
  const navCarouselIndex = remainingSections.findIndex(
    (s) => s.kind === "navigationCarousel",
  )
  const navCarousel =
    navCarouselIndex >= 0 ? remainingSections[navCarouselIndex] : null

  // Build feed: navCarousel first (if found), then everything else
  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []

    // Navigation carousel always first in feed
    if (navCarousel) {
      items.push({
        section: navCarousel,
        classification: "standard",
      })
    }

    for (let i = 0; i < remainingSections.length; i++) {
      const section = remainingSections[i]
      // Skip if this is the navCarousel we already added
      if (i === navCarouselIndex) continue

      items.push({
        section,
        classification: classifySection(section),
      })
    }

    return items
  }, [remainingSections, navCarousel, navCarouselIndex])

  // Viewability config for potential video play/pause
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current

  const onViewableItemsChanged = useCallback(
    (_info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      // Future: pause/play videos based on visibility
    },
    [],
  )

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      const { section, classification } = item
      const isFirst = index === 0

      const content =
        section.kind === "navigationCarousel" ? (
          <NavigationCarouselRenderer section={section} />
        ) : (
          <SectionDispatcher
            section={section}
            asVideoCard={classification === "videoCard"}
          />
        )

      return (
        <View style={styles.feedItemBackground}>
          {isFirst && (
            <LinearGradient
              colors={[hexToRgba(BG_COLOR, 0), hexToRgba(BG_COLOR, 0.8)]}
              style={styles.feedFeather}
            />
          )}
          {content}
        </View>
      )
    },
    [],
  )

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const scrollY = e.nativeEvent.contentOffset.y
      setHeroPaused(scrollY > heroHeight * 0.7)
      setHeroBlurOpacity(Math.min(1, scrollY / (heroHeight * 0.5)))
    },
    [heroHeight],
  )

  const keyExtractor = useCallback(
    (item: FeedItem, index: number) =>
      `${item.section.kind}-${item.section.id as string}-${index}`,
    [],
  )

  return (
    <View style={styles.container}>
      {/* Floating header */}
      <HomeHeader />

      {/* Layer 1: VideoHero absolutely positioned behind */}
      {heroSection != null && (
        <View style={[styles.heroLayer, { height: heroHeight }]}>
          <VideoHeroRenderer
            section={heroSection}
            heroHeight={heroHeight}
            paused={heroPaused}
            blurOpacity={heroBlurOpacity}
          />
        </View>
      )}

      {/* Layer 2: FlashList on top with padding to reveal hero */}
      <FlashList
        data={feedItems}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingTop: heroSection != null ? heroHeight : 0,
          paddingBottom: 48,
        }}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        showsVerticalScrollIndicator={false}
      />

      {/* Layer 3: pointer pass-through for hero interactive elements */}
      {heroSection != null && (
        <View
          style={[styles.heroInteractiveLayer, { height: heroHeight }]}
          pointerEvents="box-none"
        />
      )}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1c1917",
  },
  heroLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 0,
  },
  heroInteractiveLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
  },
  feedItemBackground: {
    backgroundColor: hexToRgba(BG_COLOR, 0.8),
  },
  feedFeather: {
    height: 48,
    marginTop: -48,
  },
})
