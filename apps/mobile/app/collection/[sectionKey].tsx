import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import { useLocalSearchParams, useNavigation } from "expo-router"
import { Image } from "expo-image"
import { VideoView } from "expo-video"
import Ionicons from "@expo/vector-icons/Ionicons"

import { useSectionByKey } from "../../src/contexts/ExperienceProvider"
import { useManagedVideoPlayer } from "../../src/hooks/useManagedVideoPlayer"
import { useAutostartPlayback } from "../../src/hooks/useAutostartPlayback"
import { PlayerLoadingVeil } from "../../src/components/watch/PlayerLoadingVeil"
import { deriveMuxThumbnailUrl } from "../../src/lib/muxThumbnail"
import {
  ACCENT,
  BLACK,
  SURFACE_COLOR,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "../../src/lib/color"
import { layout, text } from "../../src/styles/shared"
import { useEndSessionOnViewerInitiatedPlayback } from "../../src/hooks/useEndSessionOnViewerInitiatedPlayback"
import { pictureInPictureViewProps } from "../../src/lib/miniPlayer/pictureInPicture"
import { resolveImageUrl } from "../../src/lib/resolveImageUrl"
import { blockStreamingUrl } from "../../src/lib/blockVideoDub"
import { validateStreamingUrl } from "../../src/lib/validateUrl"
import { parseSectionKey } from "../../src/lib/parseSectionKey"
import { useTypography } from "../../src/hooks/useTypography"
import type { AdminBlock } from "../../src/lib/queries"

// ── Types ───────────────────────────────────────────────────────────────────

type CollectionItem = {
  videoId?: string | null
  // Admin resolves the playable dub live into `videoDub`; it exposes no bare
  // `streamingUrl` on an item. Always read through `blockStreamingUrl`.
  videoDub?: {
    hls?: string | null
    dash?: string | null
    share?: string | null
  } | null
  streamingUrl?: string | null
  imageUrl?: string | null
  titleOverride?: string | null
  backgroundColor?: string | null
}

/** The item's playable url, from the dub admin actually sends. */
function itemStreamUrl(item: CollectionItem | undefined): string | null {
  return item == null ? null : blockStreamingUrl(item)
}

// ── Constants ───────────────────────────────────────────────────────────────

const THUMBNAIL_ASPECT_RATIO = 16 / 9
const ROW_HEIGHT = 72
const HORIZONTAL_PADDING = 16

// ── Component ───────────────────────────────────────────────────────────────

export default function CollectionPlayerScreen() {
  const { sectionKey, index } = useLocalSearchParams<{
    sectionKey: string
    index?: string
  }>()
  const typography = useTypography()

  const decodedKey = parseSectionKey(sectionKey)

  const section = useSectionByKey(decodedKey ?? "")

  if (decodedKey == null || section == null) {
    return (
      <View style={layout.centered}>
        <Text style={text.errorTitle}>Collection not found</Text>
        <Text style={text.errorMessage}>
          {decodedKey == null
            ? "Invalid collection identifier."
            : `No collection found for "${decodedKey}".`}
        </Text>
      </View>
    )
  }

  const initialIndex = Math.max(0, parseInt(index ?? "0", 10) || 0)

  return (
    <CollectionPlayerContent
      section={section}
      initialIndex={initialIndex}
      typography={typography}
    />
  )
}

// ── CollectionPlayerContent ─────────────────────────────────────────────────

function CollectionPlayerContent({
  section,
  initialIndex,
  typography,
}: {
  section: AdminBlock
  initialIndex: number
  typography: ReturnType<typeof useTypography>
}) {
  const navigation = useNavigation()
  const { width: screenWidth } = useWindowDimensions()
  const playerHeight = Math.round(screenWidth * (9 / 16))

  const s = section as Record<string, unknown>
  const vcTitle = s.title as string | null | undefined
  const vcSubtitle = s.subtitle as string | null | undefined
  const vcDescription = (s.carouselDescription ?? s.description) as
    | string
    | null
    | undefined
  const rawItems = (s.items as CollectionItem[] | undefined) ?? []

  const items = rawItems

  // Derive playable indices once
  const playableIndices = useMemo(
    () =>
      items.reduce<number[]>((acc, item, i) => {
        if (validateStreamingUrl(itemStreamUrl(item))) {
          acc.push(i)
        }
        return acc
      }, []),
    [items],
  )

  // Clamp initial index to a playable item
  const safeInitialIndex = useMemo(() => {
    if (playableIndices.length === 0) return -1
    if (playableIndices.includes(initialIndex)) return initialIndex
    return playableIndices[0]
  }, [playableIndices, initialIndex])

  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex)

  // The active playable source; the shared adapter freezes the first value as
  // the creation source and swaps (replaceAsync + Mux-ID compare) on change.
  const activeStreamingUrl = useMemo(() => {
    if (currentIndex < 0 || currentIndex >= items.length) return null
    const url = itemStreamUrl(items[currentIndex])
    return url && validateStreamingUrl(url) ? url : null
  }, [currentIndex, items])

  // Authored art wins; the Mux still is the fallback, matching the video route.
  const activePosterUrl = useMemo(() => {
    const item = items[currentIndex]
    if (item == null) return null
    return (
      resolveImageUrl(item.imageUrl) ??
      resolveImageUrl(deriveMuxThumbnailUrl(itemStreamUrl(item)))
    )
  }, [currentIndex, items])

  const activeVideoId = items[currentIndex]?.videoId ?? null
  const { player, isPlaying } = useManagedVideoPlayer(
    activeStreamingUrl,
    undefined,
    {
      // KTD5 opt-in: identity re-keys with the active pager item, flushing
      // the departing episode inside the adapter.
      progress: activeVideoId ? { videoId: activeVideoId } : null,
    },
  )

  // Autostarts behind a poster + spinner, the same as every other player
  // surface. Opening this screen IS the viewer asking to watch, so it must not
  // sit on the native transport waiting for a second tap.
  const { awaitingAutostart } = useAutostartPlayback(
    player,
    activeStreamingUrl,
    isPlaying,
  )

  useEndSessionOnViewerInitiatedPlayback(isPlaying)

  const flatListRef = useRef<FlatList<CollectionItem>>(null)

  // Pause when screen loses focus (stack navigator keeps screens mounted)
  useEffect(() => {
    const unsubBlur = navigation.addListener("blur", () => {
      try {
        player.pause()
      } catch {
        // Released
      }
    })
    return unsubBlur
  }, [navigation, player])

  // playToEnd listener for auto-advance
  useEffect(() => {
    if (playableIndices.length === 0) return

    const subscription = player.addListener("playToEnd", () => {
      setCurrentIndex((prev) => {
        const currentPlayablePos = playableIndices.indexOf(prev)
        const nextPlayablePos =
          (currentPlayablePos + 1) % playableIndices.length
        return playableIndices[nextPlayablePos]
      })
    })

    return () => subscription.remove()
  }, [player, playableIndices])

  // Auto-scroll playlist to active item
  useEffect(() => {
    if (currentIndex >= 0 && flatListRef.current) {
      try {
        flatListRef.current.scrollToIndex({
          index: currentIndex,
          viewPosition: 0.5,
          animated: true,
        })
      } catch {
        // FlatList not yet laid out
      }
    }
  }, [currentIndex])

  const handleItemPress = useCallback(
    (itemIndex: number) => {
      if (itemIndex === currentIndex) return
      setCurrentIndex(itemIndex)
    },
    [currentIndex],
  )

  const renderItem = useCallback(
    ({ item, index: idx }: { item: CollectionItem; index: number }) => {
      const isActive = idx === currentIndex
      const isPlayable = validateStreamingUrl(itemStreamUrl(item))
      const title =
        (item.titleOverride != null && item.titleOverride !== ""
          ? item.titleOverride
          : null) ?? "Untitled"
      const thumbnailUrl = resolveImageUrl(item.imageUrl)

      return (
        <Pressable
          style={({ pressed }) => [
            styles.row,
            isActive && styles.rowActive,
            !isPlayable && styles.rowDisabled,
            pressed && isPlayable && Platform.OS === "ios" && styles.rowPressed,
          ]}
          android_ripple={
            isPlayable
              ? { color: "rgba(255, 255, 255, 0.1)", foreground: true }
              : undefined
          }
          onPress={isPlayable ? () => handleItemPress(idx) : undefined}
          disabled={!isPlayable}
          accessibilityRole="button"
          accessibilityLabel={`${isActive ? "Now playing: " : ""}${title}`}
          accessibilityState={{ disabled: !isPlayable, selected: isActive }}
        >
          {/* Thumbnail */}
          <View style={styles.thumbnailContainer}>
            {thumbnailUrl != null ? (
              <Image
                source={thumbnailUrl}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                recyclingKey={`coll-thumb-${idx}`}
              />
            ) : (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    backgroundColor: item.backgroundColor ?? SURFACE_COLOR,
                  },
                ]}
              />
            )}
            {isActive && (
              <View style={styles.nowPlayingBadge}>
                <Ionicons
                  name="play"
                  size={12}
                  color={ACCENT}
                  style={{ marginLeft: 1 }}
                />
              </View>
            )}
          </View>

          {/* Title */}
          <View style={styles.rowTextContainer}>
            <Text
              style={[
                styles.rowTitle,
                typography.bodySmall,
                isActive && styles.rowTitleActive,
              ]}
              numberOfLines={2}
            >
              {title}
            </Text>
          </View>

          {/* Active indicator bar */}
          {isActive && <View style={styles.activeBar} />}
        </Pressable>
      )
    },
    [currentIndex, handleItemPress, typography],
  )

  const hasSubtitle = vcSubtitle != null && vcSubtitle !== ""
  const hasTitle = vcTitle != null && vcTitle !== ""
  const hasDescription = vcDescription != null && vcDescription !== ""
  const hasHeader = hasSubtitle || hasTitle || hasDescription

  // No playable items fallback
  if (playableIndices.length === 0) {
    return (
      <View style={layout.screenContainer}>
        <View style={[styles.playerContainer, { height: playerHeight }]}>
          <View style={[StyleSheet.absoluteFill, styles.fallback]}>
            <Text style={styles.noVideoText}>No playable videos</Text>
          </View>
        </View>
        {hasHeader && (
          <View style={styles.headerContainer}>
            {hasSubtitle && (
              <Text
                style={[
                  text.sectionSubtitle,
                  styles.subtitleExtra,
                  typography.bodySmall,
                ]}
              >
                {vcSubtitle}
              </Text>
            )}
            {hasTitle && (
              <Text
                style={[text.sectionHeading, typography.heading]}
                accessibilityRole="header"
              >
                {vcTitle}
              </Text>
            )}
            {hasDescription && (
              <Text style={[styles.description, typography.body]}>
                {vcDescription}
              </Text>
            )}
          </View>
        )}
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(_item, idx) => `coll-${idx}`}
          contentContainerStyle={styles.listContent}
        />
      </View>
    )
  }

  return (
    <View style={layout.screenContainer}>
      {/* Sticky 16:9 player */}
      <View style={[styles.playerContainer, { height: playerHeight }]}>
        <VideoView
          player={player}
          style={StyleSheet.absoluteFill}
          nativeControls
          fullscreenOptions={{ enable: true }}
          // Android SurfaceView composites outside the RN tree and punches
          // through the poster and veil below. No-op on iOS.
          surfaceType={Platform.OS === "android" ? "textureView" : undefined}
          // Native controls carry a picture-in-picture button on iOS, so this
          // view feeds the same latch the host does. `automatic` is the host's
          // alone — expo-video elects only one view.
          {...pictureInPictureViewProps({ automatic: false })}
          contentFit="contain"
        />
        {/* Poster and veil share ONE predicate. Gating the poster on
            `!hasStarted` instead would leave it covering the native controls
            after a failed or timed-out load — visible controls are the
            recovery affordance, so both must clear together. */}
        {awaitingAutostart && activePosterUrl != null && (
          <Image
            source={activePosterUrl}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            pointerEvents="none"
            recyclingKey={`sdui-collection-poster-${currentIndex}`}
            accessibilityLabel="Video thumbnail"
          />
        )}
        {awaitingAutostart && <PlayerLoadingVeil />}
      </View>

      {/* Sticky header */}
      {hasHeader && (
        <View style={styles.headerContainer}>
          {hasSubtitle && (
            <Text
              style={[
                text.sectionSubtitle,
                styles.subtitleExtra,
                typography.bodySmall,
              ]}
            >
              {vcSubtitle}
            </Text>
          )}
          {hasTitle && (
            <Text
              style={[text.sectionHeading, typography.heading]}
              accessibilityRole="header"
            >
              {vcTitle}
            </Text>
          )}
          {hasDescription && (
            <Text style={[styles.description, typography.body]}>
              {vcDescription}
            </Text>
          )}
        </View>
      )}

      {/* Scrollable playlist */}
      <FlatList
        ref={flatListRef}
        data={items}
        renderItem={renderItem}
        keyExtractor={(_item, idx) => `coll-${idx}`}
        getItemLayout={(_data, idx) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * idx,
          index: idx,
        })}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={(info) => {
          flatListRef.current?.scrollToOffset({
            offset: info.averageItemLength * info.index,
            animated: true,
          })
        }}
      />
    </View>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  playerContainer: {
    width: "100%",
    backgroundColor: BLACK,
  },
  fallback: {
    backgroundColor: SURFACE_COLOR,
    justifyContent: "center",
    alignItems: "center",
  },
  noVideoText: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    fontFamily: "System",
  },
  listContent: {
    paddingBottom: 48,
  },
  headerContainer: {
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingTop: 16,
    paddingBottom: 8,
  },
  subtitleExtra: {
    marginBottom: 2,
  },
  description: {
    color: TEXT_SECONDARY,
    fontFamily: "System",
    marginTop: 6,
    lineHeight: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: HORIZONTAL_PADDING,
    paddingVertical: 8,
    minHeight: ROW_HEIGHT,
  },
  rowActive: {
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  rowDisabled: {
    opacity: 0.4,
  },
  rowPressed: {
    opacity: 0.7,
  },
  thumbnailContainer: {
    width: 96,
    height: Math.round(96 / THUMBNAIL_ASPECT_RATIO),
    borderRadius: 6,
    overflow: "hidden",
    backgroundColor: SURFACE_COLOR,
  },
  nowPlayingBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
  },
  rowTextContainer: {
    flex: 1,
    marginLeft: 12,
    justifyContent: "center",
  },
  rowTitle: {
    fontWeight: "500",
    color: TEXT_SECONDARY,
    fontFamily: "System",
  },
  rowTitleActive: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
  },
  activeBar: {
    width: 3,
    height: 36,
    borderRadius: 1.5,
    backgroundColor: ACCENT,
    position: "absolute",
    left: 0,
    alignSelf: "center",
  },
})
