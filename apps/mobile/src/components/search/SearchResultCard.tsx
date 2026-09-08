import { memo, useCallback, useEffect, useRef } from "react"
import { Animated, Pressable, StyleSheet, Text, View } from "react-native"
import { Image } from "expo-image"

import type { SearchResult } from "../../lib/queries"
import { SURFACE_COLOR } from "../../lib/color"
import { card as cardStyle } from "../../styles/shared"
import { useTypography } from "../../hooks/useTypography"
import { buildMetaLabel } from "../../lib/watchHome/model"
import { isSeriesSearchResult } from "../../lib/isSeriesRecord"
import { resolveImageUrl } from "../../lib/resolveImageUrl"
import { ExperienceFallback } from "./ExperienceFallback"
import { SearchPreviewImage } from "./SearchPreviewImage"
import { WatchProgressBar } from "../watch/WatchProgressBar"
import { ENTRANCE_DURATION_MS } from "./searchEntrance"
import {
  SEARCH_CARD_GAP_X,
  SEARCH_CARD_GAP_Y,
  SEARCH_CARD_RADIUS,
  SEARCH_CARD_TEXT_HEIGHT,
  SEARCH_CARD_TITLE_MAX_SCALE,
  SEARCH_THUMB_ASPECT,
} from "./searchCardLayout"

type SearchResultCardProps = {
  result: SearchResult
  /** Entrance stagger in ms — see `./searchEntrance`. Owned by the caller. */
  entranceDelay?: number
  onSelect: (result: SearchResult) => void
  /** Fired on touch-down to warm the detail query before navigation. */
  onPressIn?: (result: SearchResult) => void
  /** Fired once this card has been laid out, so the caller knows it is on screen. */
  onAppear?: () => void
  /** True while this card holds the grid's single preview turn. */
  previewActive?: boolean
}

export const SearchResultCard = memo(function SearchResultCard({
  result,
  entranceDelay = 0,
  onSelect,
  onPressIn,
  onAppear,
  previewActive = false,
}: SearchResultCardProps) {
  const validatedImageUrl = resolveImageUrl(result.imageUrl)
  const typography = useTypography()
  // Two rules here. Empty `label`: a search chip shows a duration or an
  // episode count and nothing else. childCount only counts for a real series
  // — a feature film owns its chapter clips (JESUS has 61, and would
  // otherwise read "61 episodes" instead of its runtime).
  const metaLabel =
    buildMetaLabel({
      label: "",
      durationSeconds: result.durationSeconds,
      childCount: isSeriesSearchResult(result) ? (result.childCount ?? 0) : 0,
    }) || null
  const opacity = useRef(new Animated.Value(0)).current
  const scale = useRef(new Animated.Value(0.92)).current
  // Pinned at mount: appending a later page shifts this card's position, and a
  // re-derived delay would restart an entrance the user has already watched.
  const delayRef = useRef(entranceDelay)
  const appearedRef = useRef(false)

  const handleLayout = useCallback(() => {
    if (appearedRef.current) return
    appearedRef.current = true
    onAppear?.()
  }, [onAppear])

  useEffect(() => {
    const delay = delayRef.current
    const anim = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: ENTRANCE_DURATION_MS,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        delay,
        useNativeDriver: true,
        tension: 80,
        friction: 9,
      }),
    ])
    anim.start()
    return () => anim.stop()
  }, [opacity, scale])

  return (
    <Animated.View
      style={[styles.cardOuter, { opacity, transform: [{ scale }] }]}
      onLayout={onAppear ? handleLayout : undefined}
    >
      <Pressable
        onPress={() => onSelect(result)}
        onPressIn={onPressIn ? () => onPressIn(result) : undefined}
        accessibilityRole="button"
        accessibilityLabel={[result.title, metaLabel]
          .filter(Boolean)
          .join(", ")}
        // KTD10: a stable RUM action name so trackInteractions doesn't derive it
        // from accessibilityLabel (which would leak the title into telemetry).
        {...{ "dd-action-name": "search-result" }}
        style={({ pressed }) => (pressed ? styles.cardPressed : undefined)}
      >
        <View style={styles.thumbnailContainer}>
          {validatedImageUrl ? (
            <Image
              source={validatedImageUrl}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={`search-${result.id}`}
            />
          ) : result.type === "EXPERIENCE" ? (
            <ExperienceFallback slug={result.slug} />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
              <Text style={styles.placeholderIcon}>▶</Text>
            </View>
          )}

          {/* Always mounted, renders null until its turn: the component owns
              its own fade-out, so a conditional mount would cut it short. */}
          <SearchPreviewImage
            playbackId={result.playbackId}
            recyclingKey={`search-preview-${result.id}`}
            active={previewActive}
          />

          {result.type === "VIDEO" ? (
            <WatchProgressBar videoId={result.id} />
          ) : null}

          {metaLabel != null && (
            <View style={cardStyle.badge}>
              <Text style={[cardStyle.badgeText, typography.caption]}>
                {metaLabel}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.textBlock}>
          <Text
            style={styles.title}
            numberOfLines={2}
            maxFontSizeMultiplier={SEARCH_CARD_TITLE_MAX_SCALE}
          >
            {result.title}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  )
})

const styles = StyleSheet.create({
  cardOuter: {
    flex: 1,
    marginHorizontal: SEARCH_CARD_GAP_X,
    marginVertical: SEARCH_CARD_GAP_Y,
  },
  cardPressed: {
    opacity: 0.85,
  },
  // The thumbnail is the only surface: it carries the rounding and the
  // clip, so the title below sits on the page background.
  thumbnailContainer: {
    aspectRatio: SEARCH_THUMB_ASPECT,
    width: "100%",
    borderRadius: SEARCH_CARD_RADIUS,
    overflow: "hidden",
    backgroundColor: SURFACE_COLOR,
  },
  placeholder: {
    backgroundColor: SURFACE_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  placeholderIcon: {
    fontSize: 32,
    color: "rgba(255,255,255,0.3)",
  },
  textBlock: {
    height: SEARCH_CARD_TEXT_HEIGHT,
    paddingTop: 8,
  },
  title: {
    color: "#ffffff",
    fontFamily: "System",
    fontWeight: "700",
    fontSize: 14,
    // Paired with SEARCH_CARD_TEXT_HEIGHT — raising this without raising that
    // clips the second line's descenders against the fixed block.
    lineHeight: 20,
  },
})
