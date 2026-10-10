import { useEffect, useRef, useState } from "react"
import { Animated, StyleSheet } from "react-native"
import { Image } from "expo-image"

import { muxAnimatedPreviewFromPlaybackId } from "../../lib/muxThumbnail"

/**
 * Long enough to read as a dissolve rather than a cut. The outgoing card fades
 * out while the incoming one fades in, so turns cross rather than snap.
 */
const CROSSFADE_MS = 420

type Props = {
  playbackId: string | null
  /** Recycling identity — must differ from the poster's, or expo-image reuses it. */
  recyclingKey: string
  /** True while this card holds the grid's preview turn. */
  active: boolean
}

/**
 * The looping Mux preview, crossfading over the card's poster. The poster is
 * never removed — this layer sits on top and animates its own opacity, so
 * fading in reveals the preview and fading out returns the poster.
 *
 * It stays mounted through the fade OUT and unmounts only once that finishes;
 * unmounting on `active` alone is what made the end of a turn a hard cut.
 * It is an animated webp drawn by expo-image, never a video view.
 */
export function SearchPreviewImage({
  playbackId,
  recyclingKey,
  active,
}: Props) {
  const url = muxAnimatedPreviewFromPlaybackId(playbackId)
  const opacity = useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = useState(false)
  // onLoad can land DURING the fade-out (a cold Mux transcode outruns the
  // hold). Fading in there interrupts the fade-out, whose callback then sees
  // finished:false and never unmounts — stranding a preview on a dead card.
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    if (active) {
      // Start transparent every turn: a cached webp can report onLoad
      // immediately, which would otherwise pop in at full opacity.
      opacity.setValue(0)
      setMounted(true)
      return
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: CROSSFADE_MS,
      useNativeDriver: true,
    }).start(({ finished }) => {
      // Only drop the layer once it is actually invisible. An interrupted fade
      // means a new turn took over, and that turn owns the mount.
      if (finished) setMounted(false)
    })
  }, [active, opacity])

  useEffect(() => () => opacity.stopAnimation(), [opacity])

  if (!url || !mounted) return null

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity }]}
      pointerEvents="none"
    >
      <Image
        source={url}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        recyclingKey={recyclingKey}
        // Fade only once it has decoded; fading an undecoded image shows the
        // poster blink out and back in.
        onLoad={() => {
          if (!activeRef.current) return
          Animated.timing(opacity, {
            toValue: 1,
            duration: CROSSFADE_MS,
            useNativeDriver: true,
          }).start()
        }}
      />
    </Animated.View>
  )
}
