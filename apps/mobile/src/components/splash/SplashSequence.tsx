import { useEffect, useMemo, useRef } from "react"
import {
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native"
import { Image } from "expo-image"
import { LinearGradient } from "expo-linear-gradient"

import { BG_COLOR, TEXT_ON_OVERLAY, hexToRgba } from "../../lib/color"
import markCrimson from "../../../assets/splash-mark-crimson.png"
import markWhite from "../../../assets/splash-mark-white.png"

// ── The composition, in fractions of the frame and of the mark's own tile ──

/** The projector screen's width, as a fraction of the frame's width. */
export const MARK_WIDTH_RATIO = 0.55
/** The mark's own aspect ratio, taken from its path, not from its raster. */
export const MARK_ASPECT = 48.194 / 35.2077
/** Where the mark's left edge ends, as a fraction of its tile's height. */
export const MARK_BOTTOM_LEFT_Y = 22.4957 / 35.2077
/** The mark's alpha centroid. The sliced corner removes weight, so a
 *  box-centred word sags. */
export const MARK_CENTROID_X = 0.5388
export const MARK_CENTROID_Y = 0.4158
/** The beam's apex sits on the right edge, four fifths of the way down. */
export const RAY_APEX_Y_RATIO = 0.8
/** How far the beam runs past the mark, so it dissolves rather than stopping. */
const RAY_OVERSHOOT = 1.15

// ── The beats ──────────────────────────────────────────────────────────────

/** The screen's rise into its overshoot. */
export const SPLASH_BLOOM_RISE_MS = 460
/** Its settle back. Longer than the rise, so the screen does not snap. */
export const SPLASH_BLOOM_SETTLE_MS = 540
const BLOOM_OVERSHOOT_SCALE = 1.08
/** Where in the bloom's progress the overshoot sits, so ONE timing can carry
 *  both halves. A nested Animated.sequence does not run on Android/Fabric —
 *  the mark simply never appeared, while its sibling timings did. */
const BLOOM_OVERSHOOT_AT =
  SPLASH_BLOOM_RISE_MS / (SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS)
/** The beam starts while the screen is still settling. */
export const SPLASH_RAY_DELAY_MS = 380
export const SPLASH_RAY_MS = 620
/** The screen takes the beam's colour AS the beam arrives, not after it. */
export const SPLASH_CRIMSON_DELAY_MS = 560
export const SPLASH_CRIMSON_MS = 500
/** A pause on the settled crimson screen, then the word. */
export const SPLASH_WORD_DELAY_MS = 1400
export const SPLASH_WORD_MS = 700

/** How long the motion runs. The splash session owns the HOLD, and its hold
 *  must cover this, or the layer hands over mid-sequence. */
export const SPLASH_SEQUENCE_MS = Math.max(
  SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS,
  SPLASH_RAY_DELAY_MS + SPLASH_RAY_MS,
  SPLASH_CRIMSON_DELAY_MS + SPLASH_CRIMSON_MS,
  SPLASH_WORD_DELAY_MS + SPLASH_WORD_MS,
)

// ── The beam ───────────────────────────────────────────────────────────────

/** Rotated gradient bands stand in for a wedge this app has no renderer for.
 *  Their low alphas sum into a soft cone; the outermost two ARE R9's edges. */
const RAY_BAND_COUNT = 28
/** Band thickness as a multiple of the gap between neighbours at the FAR end,
 *  where the bands are furthest apart. Measured on the iPhone 17 Pro Max
 *  simulator: 14 bands at 1.7 read as separate streaks, these read as one cone. */
const RAY_BAND_OVERLAP = 2.6
/** Per-band, so the stack composites to about the same brightness as before:
 *  1 - (1 - 0.05)^28 is close to 1 - (1 - 0.09)^14. */
const RAY_APEX_ALPHA = 0.05
const RAY_MID_ALPHA = 0.028
const RAY_MID_STOP = 0.35

const WORD = "Jesus"
const WORD_FAMILY = "NotoSerif-SemiBold"
const WORD_SIZE_RATIO = 0.28
const WORD_LINE_RATIO = 1.25

export type SplashPoint = { x: number; y: number }
export type SplashFrame = { width: number; height: number }

export type SplashGeometry = {
  /** The projector screen's tile, in frame coordinates. */
  mark: { left: number; top: number; width: number; height: number }
  /** Where the word is centred, in frame coordinates. */
  wordCenter: SplashPoint
  /** The beam's apex, in frame coordinates. */
  apex: SplashPoint
  /** Direction from the apex to the mark's bottom-left corner, in degrees. */
  bottomLeftAngleDeg: number
  /** Direction from the apex to the mark's top-right corner, in degrees. */
  topRightAngleDeg: number
  /** How far the beam runs from its apex. */
  rayLength: number
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI
}

/**
 * The whole composition, derived from the measured frame. Everything is a
 * proportion, so a tablet's wider frame reads the same as a phone's.
 */
export function splashGeometry(frame: SplashFrame): SplashGeometry {
  const width = frame.width * MARK_WIDTH_RATIO
  const height = width / MARK_ASPECT
  const left = (frame.width - width) / 2
  const top = (frame.height - height) / 2

  const bottomLeft = { x: left, y: top + height * MARK_BOTTOM_LEFT_Y }
  const topRight = { x: left + width, y: top }
  const apex = { x: frame.width, y: frame.height * RAY_APEX_Y_RATIO }

  const reach = Math.max(
    Math.hypot(bottomLeft.x - apex.x, bottomLeft.y - apex.y),
    Math.hypot(topRight.x - apex.x, topRight.y - apex.y),
  )

  return {
    mark: { left, top, width, height },
    wordCenter: {
      x: left + width * MARK_CENTROID_X,
      y: top + height * MARK_CENTROID_Y,
    },
    apex,
    bottomLeftAngleDeg: degrees(
      Math.atan2(bottomLeft.y - apex.y, bottomLeft.x - apex.x),
    ),
    topRightAngleDeg: degrees(
      Math.atan2(topRight.y - apex.y, topRight.x - apex.x),
    ),
    rayLength: reach * RAY_OVERSHOOT,
  }
}

export type SplashSequenceProps = {
  /** Resolved before the first frame by the splash session (KTD7). */
  reduceMotion: boolean
  /** Fires once, after the layer has painted its first frame. */
  onFirstFrame?: () => void
}

/**
 * The projector sequence: a white screen blooms in, one ray of light reaches it
 * from the right edge, the screen takes the brand crimson as the ray arrives,
 * and the word settles on top. A Reduce Motion viewer gets the last frame of
 * that, held still.
 */
export function SplashSequence({
  reduceMotion,
  onFirstFrame,
}: SplashSequenceProps): React.JSX.Element {
  const { width: frameWidth, height: frameHeight } = useWindowDimensions()

  // Every number below is a pure function of the frame, and the cover
  // re-renders three times on a cold start — one of them from inside the
  // first-frame callback, the most latency-sensitive instant in the feature.
  const layout = useMemo(() => {
    const geometry = splashGeometry({ width: frameWidth, height: frameHeight })
    const spread = geometry.topRightAngleDeg - geometry.bottomLeftAngleDeg
    const step = spread / (RAY_BAND_COUNT - 1)
    const fontSize = Math.round(geometry.mark.width * WORD_SIZE_RATIO)
    return {
      ...geometry,
      // A band is drawn pointing LEFT out of the apex, so its rotation is its
      // direction in the frame turned back by half a turn.
      bandAngles: Array.from(
        { length: RAY_BAND_COUNT },
        (_, index) => geometry.bottomLeftAngleDeg + step * index - 180,
      ),
      bandThickness:
        geometry.rayLength *
        Math.abs((step * Math.PI) / 180) *
        RAY_BAND_OVERLAP,
      fontSize,
      lineHeight: Math.round(fontSize * WORD_LINE_RATIO),
    }
  }, [frameWidth, frameHeight])

  // Reduce Motion seeds every value at its END, so the finished frame is the
  // first frame and nothing has to animate to reach it.
  const rest = reduceMotion ? 1 : 0
  const bloom = useRef(new Animated.Value(rest)).current
  // The bloom's progress carries the overshoot through this interpolation
  // rather than through a second timing, so nothing here is a nested sequence.
  const bloomScale = useMemo(
    () =>
      bloom.interpolate({
        inputRange: [0, BLOOM_OVERSHOOT_AT, 1],
        outputRange: [0, BLOOM_OVERSHOOT_SCALE, 1],
      }),
    [bloom],
  )
  const rayGrow = useRef(new Animated.Value(rest)).current
  const crimson = useRef(new Animated.Value(rest)).current
  const wordFade = useRef(new Animated.Value(rest)).current

  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    // Setup re-schedules what cleanup cancels, so a StrictMode remount still
    // fires — and the latch is never touched in cleanup, so it fires once.
    const handle = requestAnimationFrame(() => {
      fired.current = true
      onFirstFrame?.()
    })
    return () => cancelAnimationFrame(handle)
  }, [onFirstFrame])

  useEffect(() => {
    if (reduceMotion) return
    // Every beat is one timing with its own delay. A looped Animated.sequence
    // runs only once on Fabric, so nothing here may be wrapped in a loop.
    const animation = Animated.parallel([
      Animated.timing(bloom, {
        toValue: 1,
        duration: SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS,
        // Decelerating, so the overshoot is reached early in wall-clock time
        // and the settle back takes the rest — R8's "settle slower than the
        // rise" expressed as one curve rather than two timings.
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rayGrow, {
        toValue: 1,
        delay: SPLASH_RAY_DELAY_MS,
        duration: SPLASH_RAY_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(crimson, {
        toValue: 1,
        delay: SPLASH_CRIMSON_DELAY_MS,
        duration: SPLASH_CRIMSON_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(wordFade, {
        toValue: 1,
        delay: SPLASH_WORD_DELAY_MS,
        duration: SPLASH_WORD_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ])
    animation.start()
    return () => animation.stop()
  }, [reduceMotion, bloom, rayGrow, crimson, wordFade])

  const {
    apex,
    bandAngles,
    bandThickness,
    fontSize,
    lineHeight,
    mark,
    rayLength,
    wordCenter,
  } = layout

  return (
    <View style={styles.root}>
      {/* The beam's box is centred ON the apex, so one uniform scale grows the
          whole cone out of it — a wedge is self-similar about its own apex. */}
      <Animated.View
        testID="splash-ray"
        style={[
          styles.rayGroup,
          {
            left: apex.x - rayLength,
            top: apex.y - rayLength,
            width: rayLength * 2,
            height: rayLength * 2,
            transform: [{ scale: rayGrow }],
          },
        ]}
      >
        {bandAngles.map((angle, index) => (
          <LinearGradient
            key={index}
            colors={[
              hexToRgba(TEXT_ON_OVERLAY, RAY_APEX_ALPHA),
              hexToRgba(TEXT_ON_OVERLAY, RAY_MID_ALPHA),
              hexToRgba(TEXT_ON_OVERLAY, 0),
            ]}
            locations={[0, RAY_MID_STOP, 1]}
            start={{ x: 1, y: 0.5 }}
            end={{ x: 0, y: 0.5 }}
            style={[
              styles.rayBand,
              {
                right: rayLength,
                top: rayLength - bandThickness / 2,
                width: rayLength,
                height: bandThickness,
                // Rotate about the band's RIGHT edge, which sits on the apex.
                transform: [
                  { translateX: rayLength / 2 },
                  { rotate: `${angle}deg` },
                  { translateX: -rayLength / 2 },
                ],
              },
            ]}
          />
        ))}
      </Animated.View>

      <Animated.View
        testID="splash-mark"
        style={[
          styles.mark,
          {
            left: mark.left,
            top: mark.top,
            width: mark.width,
            height: mark.height,
            transform: [{ scale: bloomScale }],
          },
        ]}
      >
        <Image
          // Static key: this layer is a singleton and is never recycled.
          recyclingKey="splash-mark-white"
          source={markWhite}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
        />
        <Animated.View
          testID="splash-mark-crimson"
          style={[StyleSheet.absoluteFill, { opacity: crimson }]}
        >
          <Image
            recyclingKey="splash-mark-crimson"
            source={markCrimson}
            style={StyleSheet.absoluteFill}
            contentFit="fill"
          />
        </Animated.View>
      </Animated.View>

      {/* Positioned, never transformed: R11 gives the word no movement and no
          scaling of its own. It sits OUTSIDE the bloom for the same reason. */}
      <Animated.Text
        testID="splash-word"
        style={[
          styles.word,
          {
            left: wordCenter.x - mark.width,
            top: wordCenter.y - lineHeight / 2,
            width: mark.width * 2,
            fontSize,
            lineHeight,
            opacity: wordFade,
          },
        ]}
      >
        {WORD}
      </Animated.Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BG_COLOR,
    overflow: "hidden",
  },
  rayGroup: {
    position: "absolute",
  },
  rayBand: {
    position: "absolute",
  },
  mark: {
    position: "absolute",
  },
  word: {
    position: "absolute",
    color: TEXT_ON_OVERLAY,
    fontFamily: WORD_FAMILY,
    textAlign: "center",
  },
})
