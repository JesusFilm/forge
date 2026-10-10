import { useEffect, useRef, useState } from "react"
import { Animated } from "react-native"
import type { VideoPlayer } from "expo-video"

/** How long the poster takes to cover the last frame. */
const FADE_MS = 300
/** How often a paused player is checked for a seek away from the end. */
const SEEK_WATCH_MS = 500
/** Distance from the end that still counts as "at the end". */
const END_EPSILON = 0.5

export type EndedPosterFade = {
  /** True while playback sits at the end — the poster covers the last frame. */
  ended: boolean
  /** Opacity for the poster layer: 1 for the pre-start/cast states, and a
   *  0 -> 1 ramp when `ended` latches. */
  posterFade: Animated.Value
}

/**
 * Ended-playback poster state. The last frame is often black, so reaching the
 * end covers it with the video's poster instead of leaving a dead rectangle
 * under the Replay control.
 *
 * The fade is an OWNED Animated value, not expo-image's `transition`: that
 * prop is skipped for a memory-cached source, and the pre-start render has
 * already cached this exact poster.
 */
export function useEndedPosterFade(
  player: VideoPlayer,
  isPlaying: boolean,
): EndedPosterFade {
  const [ended, setEnded] = useState(false)
  const posterFade = useRef(new Animated.Value(1)).current
  // Render-time mirror so the listener can tell a real transition from a
  // repeat event (see below).
  const endedRef = useRef(ended)
  endedRef.current = ended

  useEffect(() => {
    const sub = player.addListener("playToEnd", () => {
      // Zero synchronously, BEFORE the state flip that mounts the overlay:
      // a passive effect would run after the same commit paints, so the
      // poster would flash one frame at full opacity.
      //
      // ONLY on the false -> true transition. Both platforms re-emit
      // playToEnd for an item already at its end, and `setEnded(true)` then
      // bails out as a same-value write — so the [ended] effect never re-runs
      // and nothing would ramp the value back up. An unconditional zero would
      // leave the overlay mounted at opacity 0, showing the black last frame
      // this hook exists to cover.
      if (!endedRef.current) posterFade.setValue(0)
      setEnded(true)
    })
    return () => {
      try {
        sub.remove()
      } catch {
        // player already released
      }
    }
  }, [player, posterFade])

  useEffect(() => {
    if (isPlaying) setEnded(false)
  }, [isPlaying])

  useEffect(() => {
    if (!ended) {
      // Solid for the pre-start/cast poster states.
      posterFade.setValue(1)
      return
    }
    posterFade.setValue(0)
    const anim = Animated.timing(posterFade, {
      toValue: 1,
      duration: FADE_MS,
      useNativeDriver: true,
    })
    anim.start()
    return () => anim.stop()
  }, [ended, posterFade])

  // A scrub/skip while ended stays paused (no playingChange), so watch the
  // position while ended and drop the poster once it leaves the end.
  useEffect(() => {
    if (!ended) return
    const t = setInterval(() => {
      // Same release guard as the sibling watchdog in useManagedVideoPlayer:
      // these getters throw once the native player is released, and this
      // interval can outlive it by up to one tick.
      try {
        const d = player.duration
        if (
          Number.isFinite(d) &&
          d > 0 &&
          player.currentTime < d - END_EPSILON
        ) {
          setEnded(false)
        }
      } catch {
        // player already released — leave `ended` as-is
      }
    }, SEEK_WATCH_MS)
    return () => clearInterval(t)
  }, [ended, player])

  return { ended, posterFade }
}
