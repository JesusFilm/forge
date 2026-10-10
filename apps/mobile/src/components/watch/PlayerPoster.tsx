import { StyleSheet, View, useWindowDimensions } from "react-native"
import { Image } from "expo-image"

import { SURFACE_COLOR } from "../../lib/color"
import { PLAYER_HEIGHT_RATIO } from "../../lib/playerLayout"
import { PlayerLoadingVeil } from "./PlayerLoadingVeil"

type PlayerPosterProps = {
  posterUrl: string | null
  /** Per-side inset the parent dock applies, so this matches the real player. */
  horizontalInset?: number
  /** True while a stream is still being resolved. A null source ALSO means
   *  "resolved, nothing playable" (no variant in this language), and a spinner
   *  there would promise a stream that is never coming. */
  loading?: boolean
}

/**
 * Player-shaped poster for when there is no stream to play yet. Transport chrome
 * would be a lie here (nothing to scrub), but the seed's artwork is real — so a
 * seeded navigation still paints instantly instead of dropping to a skeleton.
 */
export function PlayerPoster({
  posterUrl,
  horizontalInset = 0,
  loading = false,
}: PlayerPosterProps) {
  const { width: screenWidth } = useWindowDimensions()
  const width = screenWidth - horizontalInset * 2
  const height = Math.round(width * PLAYER_HEIGHT_RATIO)

  return (
    <View style={[styles.container, { width, height }]}>
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
      {loading && <PlayerLoadingVeil />}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: SURFACE_COLOR,
    overflow: "hidden",
  },
})
