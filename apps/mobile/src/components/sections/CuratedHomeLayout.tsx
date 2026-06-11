import { useCallback, useEffect, useMemo, useState } from "react"
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native"
import { FlashList } from "@shopify/flash-list"
import { useNavigation } from "expo-router"
import { LinearGradient } from "expo-linear-gradient"

import { useExperienceContext } from "../../contexts/ExperienceProvider"
import type { AdminBlock } from "../../lib/queries"
import { BG_COLOR, hexToRgba } from "../../lib/color"
import { layout } from "../../styles/shared"
import { HomeHeader } from "../ui/HomeHeader"
import { classifySection, SectionDispatcher } from "./SectionDispatcher"
import { VideoHeroRenderer } from "./VideoHeroRenderer"
import { NavigationCarouselRenderer } from "./NavigationCarouselRenderer"

// ── Types ───────────────────────────────────────────────────────────────────

type FeedItem = {
  section: AdminBlock
  classification: "videoCard" | "standard"
}

type Props = {
  // When true, suppresses the absolute HomeHeader (search/profile chrome).
  // Use on routes that supply their own native navigation header (e.g.
  // experience/[slug]) to avoid doubled safe-area offsets.
  hideHeader?: boolean
}

// ── Component ───────────────────────────────────────────────────────────────

export function CuratedHomeLayout({ hideHeader = false }: Props) {
  const { experience } = useExperienceContext()
  const { width: screenWidth } = useWindowDimensions()
  const heroHeight = screenWidth * 1.2

  const [heroPaused, setHeroPaused] = useState(false)
  const [heroBlurOpacity, setHeroBlurOpacity] = useState(0)
  const [titleOpacity, setTitleOpacity] = useState(0)
  const [muted, setMuted] = useState(true)
  const [muteButtonRect, setMuteButtonRect] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)

  const navigation = useNavigation()
  useEffect(() => {
    return navigation.addListener("blur", () => {
      setMuted(true)
    })
  }, [navigation])

  const blocks = (experience?.blocks ?? []).filter(
    (b) => b != null,
  ) as AdminBlock[]

  const heroSection =
    blocks.length > 0 && blocks[0].__typename === "VideoHeroBlock"
      ? blocks[0]
      : null

  const handleMuteToggle = useCallback(() => setMuted((m) => !m), [])

  const handleMuteButtonLayout = useCallback(
    (x: number, y: number, w: number, h: number) => {
      setMuteButtonRect({ x, y, w, h })
    },
    [],
  )

  const remainingSections = heroSection ? blocks.slice(1) : blocks

  const navCarouselIndex = remainingSections.findIndex(
    (s) => s.__typename === "NavigationCarouselBlock",
  )
  const navCarousel =
    navCarouselIndex >= 0 ? remainingSections[navCarouselIndex] : null

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = []

    if (navCarousel) {
      items.push({
        section: navCarousel,
        classification: "standard",
      })
    }

    for (let i = 0; i < remainingSections.length; i++) {
      const section = remainingSections[i]
      if (i === navCarouselIndex) continue

      items.push({
        section,
        classification: classifySection(section),
      })
    }

    return items
  }, [remainingSections, navCarousel, navCarouselIndex])

  const renderItem = useCallback(
    ({ item, index }: { item: FeedItem; index: number }) => {
      const { section, classification } = item
      const isFirst = index === 0

      const content =
        section.__typename === "NavigationCarouselBlock" ? (
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
              colors={[hexToRgba(BG_COLOR, 0), hexToRgba(BG_COLOR, 0.9)]}
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
      const fadeStart = heroHeight * 0.6
      const fadeEnd = heroHeight * 0.75
      setTitleOpacity(
        Math.min(1, Math.max(0, (scrollY - fadeStart) / (fadeEnd - fadeStart))),
      )
    },
    [heroHeight],
  )

  const keyExtractor = useCallback(
    (_item: FeedItem, index: number) => `feed-${index}`,
    [],
  )

  return (
    <View style={layout.screenContainer}>
      {heroSection != null && (
        <View style={[styles.heroLayer, { height: heroHeight }]}>
          <VideoHeroRenderer
            section={heroSection}
            heroHeight={heroHeight}
            paused={heroPaused}
            blurOpacity={heroBlurOpacity}
            muted={muted}
            onMuteToggle={handleMuteToggle}
            onMuteButtonLayout={handleMuteButtonLayout}
          />
        </View>
      )}

      {!hideHeader && (
        <HomeHeader
          title={experience?.title ?? null}
          titleOpacity={titleOpacity}
        />
      )}

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
        showsVerticalScrollIndicator={false}
      />

      {heroSection != null && (
        <View
          style={[styles.heroInteractiveLayer, { height: heroHeight }]}
          pointerEvents="box-none"
        >
          {muteButtonRect != null && (
            <Pressable
              style={{
                position: "absolute",
                left: muteButtonRect.x,
                top: muteButtonRect.y,
                width: muteButtonRect.w,
                height: muteButtonRect.h,
              }}
              onPress={handleMuteToggle}
              accessibilityLabel={muted ? "Unmute video" : "Mute video"}
              accessibilityRole="button"
            />
          )}
        </View>
      )}
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
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
    backgroundColor: hexToRgba(BG_COLOR, 0.9),
  },
  feedFeather: {
    height: 48,
    marginTop: -48,
  },
})
