import { StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"

import { SURFACE_COLOR } from "../../lib/color"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"

type PlayerPosterProps = {
  posterUrl: string | null
  /** Per-side inset the parent dock applies, so this matches the real player. */
  horizontalInset?: number
}

/**
 * Player-shaped poster for when there is no stream to play yet. Transport chrome
 * would be a lie here (nothing to scrub), but the seed's artwork is real — so a
 * seeded navigation still paints instantly instead of dropping to a skeleton.
 */
export function PlayerPoster({
  posterUrl,
  horizontalInset = 0,
}: PlayerPosterProps) {
  const { width: screenWidth } = useWindowDimensions()
  const width = screenWidth - horizontalInset * 2
  const height = Math.round(width * PLAYER_HEIGHT_RATIO)

  return (
    <View
      style={[styles.container, { width, height }]}
      accessibilityLabel="Loading video"
      accessibilityRole="progressbar"
    >
      {posterUrl ? (
        <Image
          source={posterUrl}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={posterUrl}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: SURFACE_COLOR,
    overflow: "hidden",
  },
})
