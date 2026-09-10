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
/**
 * How far ABOVE the centroid the word sits, as a fraction of the mark's tile.
 * The centroid weights the sloped tail, which is not part of the screen a
 * viewer reads text on, so anchoring there alone sets the word visibly low.
 */
export const WORD_RISE_FROM_CENTROID = 0.108
/**
 * How far LEFT of the centroid the word sits, as a fraction of the mark's
 * width. The sliced bottom-left corner takes weight off that side, pulling the
 * centroid right of the box centre and leaving more red to the word's left
 * than to its right.
 */
export const WORD_SHIFT_LEFT_OF_CENTROID = 0.03
/** The beam's apex, in fractions of the frame. The x ratio is past 1 on
 *  purpose: on the edge, the bands converge to a point the viewer can see. */
export const RAY_APEX_X_RATIO = 1.3
export const RAY_APEX_Y_RATIO = 0.8

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
export const RAY_BAND_COUNT = 28
/** Band thickness as a multiple of the gap between neighbours at the FAR end.
 *  Raised from 2.6 when the bands gained soft edges: a bump needs wider
 *  neighbours to sum flat, and 4 measured smoothest at this band count. */
const RAY_BAND_OVERLAP = 4
/** Each band's alpha at its own centre line. The stack's brightness at a point
 *  is set by how many bands cover it, which falls with distance from the apex.
 *  Set so the beam measures the same on a device as it did with flat bands. */
const RAY_BAND_ALPHA = 0.076
/** The band's cross-section, sampled at eighths. A FLAT one steps at each band
 *  edge, and those steps let a viewer count the bands: measured at 1.0 cycles
 *  per band. Zero slope at the edges as well, so the sum has no kink. */
export const RAY_BAND_PROFILE = [
  0, 0.156, 0.5, 0.844, 1, 0.844, 0.5, 0.156, 0,
] as const
/** How much of the beam's DEPTH the dissolve covers, square to the corner line
 *  every band ends on. NOT a fraction of a band's length: that is the other
 *  axis, and it made the dissolve deeper on a tablet than on a phone. */
export const RAY_DISSOLVE_DEPTH_RATIO = 0.45

/** Precomputed: the profile never changes, and this is the cover's hot path.
 *  Both are spelled as non-empty tuples because that is how
 *  expo-linear-gradient types the two props. */
const RAY_BAND_SPAN = RAY_BAND_PROFILE.length - 1
const RAY_BAND_COLORS: readonly [string, string, ...string[]] = [
  hexToRgba(TEXT_ON_OVERLAY, RAY_BAND_ALPHA * RAY_BAND_PROFILE[0]),
  hexToRgba(TEXT_ON_OVERLAY, RAY_BAND_ALPHA * RAY_BAND_PROFILE[1]),
  ...RAY_BAND_PROFILE.slice(2).map((weight) =>
    hexToRgba(TEXT_ON_OVERLAY, RAY_BAND_ALPHA * weight),
  ),
]
const RAY_BAND_LOCATIONS: readonly [number, number, ...number[]] = [
  0,
  1 / RAY_BAND_SPAN,
  ...RAY_BAND_PROFILE.slice(2).map((_, index) => (index + 2) / RAY_BAND_SPAN),
]

const WORD = "Jesus"
const WORD_FAMILY = "NotoSerif-SemiBold"
const WORD_SIZE_RATIO = 0.28
const WORD_LINE_RATIO = 1.25

export type SplashPoint = { x: number; y: number }
export type SplashFrame = { width: number; height: number }

/** One of the rotated bands the beam is built from. */
export type SplashBand = {
  /** Its direction from the apex, in degrees. */
  angleDeg: number
  /** How far it runs: to the line joining the two corners the beam lights. */
  length: number
}

/** The one overlay that dissolves the beam's far end into the ground. Its
 *  gradient runs SQUARE at the line joining the two lit corners, so every
 *  band's end fades on one schedule and none of them shows an edge. */
export type SplashDissolve = {
  /** Its box, in the ray group's own coordinates. */
  left: number
  top: number
  width: number
  height: number
  /** Its rotation, which puts its gradient square at that line. */
  angleDeg: number
  /** How far down its own height the ground colour becomes fully opaque. */
  stop: number
}

export type SplashGeometry = {
  /** The projector screen's tile, in frame coordinates. */
  mark: { left: number; top: number; width: number; height: number }
  /** Where the word is centred, in frame coordinates. */
  wordCenter: SplashPoint
  /** The word's type size, rounded — sub-pixel sizes are blurry on Android. */
  fontSize: number
  /** Its line box, which is what has to stay inside the screen. */
  lineHeight: number
  /** The beam's apex, in frame coordinates. */
  apex: SplashPoint
  /** Direction from the apex to the mark's bottom-left corner, in degrees. */
  bottomLeftAngleDeg: number
  /** Direction from the apex to the mark's top-right corner, in degrees. */
  topRightAngleDeg: number
  /** The bands the beam is drawn from, from its lower edge to its upper one. */
  bands: SplashBand[]
  /** The overlay that fades their shared far end out. */
  dissolve: SplashDissolve
  /** Every band's thickness. One value, so neighbours overlap everywhere. */
  bandThickness: number
  /** The longest band, which is what the group's box has to hold. */
  rayLength: number
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI
}

function cross(a: SplashPoint, b: SplashPoint): number {
  return a.x * b.y - a.y * b.x
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
  const apex = {
    x: frame.width * RAY_APEX_X_RATIO,
    y: frame.height * RAY_APEX_Y_RATIO,
  }

  const bottomLeftAngle = Math.atan2(
    bottomLeft.y - apex.y,
    bottomLeft.x - apex.x,
  )
  const topRightAngle = Math.atan2(topRight.y - apex.y, topRight.x - apex.x)
  const step = (topRightAngle - bottomLeftAngle) / (RAY_BAND_COUNT - 1)

  // The beam's far end is the LINE joining the two corners it lights, so each
  // band stops where its own direction meets that line. Drawing them all to one
  // length instead ran the shorter upper edge well past its corner.
  const cornerLine = {
    x: topRight.x - bottomLeft.x,
    y: topRight.y - bottomLeft.y,
  }
  const apexToCorner = { x: bottomLeft.x - apex.x, y: bottomLeft.y - apex.y }

  const bands: SplashBand[] = Array.from(
    { length: RAY_BAND_COUNT },
    (_, index) => {
      const angle = bottomLeftAngle + step * index
      const direction = { x: Math.cos(angle), y: Math.sin(angle) }
      // Zero only on a frame with no size, which a cold start can measure
      // before layout: 0/0 is NaN, and NaN would reach 28 native gradient views.
      const closingRate = cross(direction, cornerLine)
      return {
        angleDeg: degrees(angle),
        length:
          closingRate === 0
            ? 0
            : Math.max(0, cross(apexToCorner, cornerLine) / closingRate),
      }
    },
  )

  const rayLength = bands.reduce((longest, band) => {
    return band.length > longest ? band.length : longest
  }, 0)

  // The dissolve sits SQUARE at the corner line: its own height runs along that
  // line's normal, so its gradient reaches the line everywhere at once.
  const cornerLineLength = Math.hypot(cornerLine.x, cornerLine.y)
  const normal =
    cornerLineLength > 0
      ? {
          x: -cornerLine.y / cornerLineLength,
          y: cornerLine.x / cornerLineLength,
        }
      : { x: 1, y: 0 }
  const facing =
    apexToCorner.x * normal.x + apexToCorner.y * normal.y < 0 ? -1 : 1
  const away = { x: normal.x * facing, y: normal.y * facing }
  const lineDepth = apexToCorner.x * away.x + apexToCorner.y * away.y

  const dissolveStart = Math.max(0, lineDepth * (1 - RAY_DISSOLVE_DEPTH_RATIO))
  const dissolveHeight = Math.max(rayLength - dissolveStart, 0)
  // Centred on the corner line's own MIDPOINT, not on the foot of the apex's
  // perpendicular — those are far apart, and the foot leaves the beam's lower
  // side uncovered.
  const lineMiddle = {
    x: (bottomLeft.x + topRight.x) / 2,
    y: (bottomLeft.y + topRight.y) / 2,
  }
  const depthOfCentre = dissolveStart + dissolveHeight / 2
  const dissolveCentre = {
    x: lineMiddle.x + away.x * (depthOfCentre - lineDepth) - apex.x + rayLength,
    y: lineMiddle.y + away.y * (depthOfCentre - lineDepth) - apex.y + rayLength,
  }
  // Twice the corner line, so the bands' soft edges cannot reach past its ends.
  const dissolveWidth = cornerLineLength * 2
  const dissolve: SplashDissolve = {
    left: dissolveCentre.x - dissolveWidth / 2,
    top: dissolveCentre.y - dissolveHeight / 2,
    width: dissolveWidth,
    height: dissolveHeight,
    // Its local +y must point along `away`, so its local +x is a quarter turn back.
    angleDeg: degrees(Math.atan2(away.y, away.x)) - 90,
    stop:
      dissolveHeight > 0
        ? Math.min(Math.max((lineDepth - dissolveStart) / dissolveHeight, 0), 1)
        : 1,
  }

  const fontSize = Math.round(width * WORD_SIZE_RATIO)

  return {
    mark: { left, top, width, height },
    wordCenter: {
      x: left + width * (MARK_CENTROID_X - WORD_SHIFT_LEFT_OF_CENTROID),
      y: top + height * (MARK_CENTROID_Y - WORD_RISE_FROM_CENTROID),
    },
    fontSize,
    lineHeight: Math.round(fontSize * WORD_LINE_RATIO),
    apex,
    bottomLeftAngleDeg: degrees(bottomLeftAngle),
    topRightAngleDeg: degrees(topRightAngle),
    bands,
    dissolve,
    // Taken from the LONGEST band, so neighbours still overlap where both run.
    bandThickness: rayLength * Math.abs(step) * RAY_BAND_OVERLAP,
    rayLength,
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
 * from beyond the right edge, the screen takes the brand crimson as the ray arrives,
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
  const layout = useMemo(
    () => splashGeometry({ width: frameWidth, height: frameHeight }),
    [frameWidth, frameHeight],
  )

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
    // Every beat is one timing with its own delay. No Animated.sequence may
    // appear here at all, looped or not — see the bloom's note above.
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
    bandThickness,
    bands,
    dissolve,
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
        {bands.map((band, index) => (
          <LinearGradient
            key={index}
            // ACROSS the band, not along it. A band that is uniform across its
            // thickness puts a step at each of its two edges, and those steps
            // are what make the individual bands visible inside the beam.
            colors={RAY_BAND_COLORS}
            locations={RAY_BAND_LOCATIONS}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={[
              styles.rayPart,
              {
                // `right` keeps every band's right edge on the apex, whatever
                // its own length is.
                right: rayLength,
                top: rayLength - bandThickness / 2,
                width: band.length,
                height: bandThickness,
                // Rotate about that right edge. A band points LEFT out of the
                // apex, so its rotation is its direction turned back half a turn.
                transform: [
                  { translateX: band.length / 2 },
                  { rotate: `${band.angleDeg - 180}deg` },
                  { translateX: -band.length / 2 },
                ],
              },
            ]}
          />
        ))}

        {/* Every band ENDS on the corner line, so their ends would read as one
            hard cut. This lays the ground colour over that line to dissolve
            them, and rides the same scale so it tracks the beam as it grows. */}
        <LinearGradient
          testID="splash-ray-dissolve"
          colors={[
            hexToRgba(BG_COLOR, 0),
            hexToRgba(BG_COLOR, 1),
            hexToRgba(BG_COLOR, 1),
          ]}
          locations={[0, dissolve.stop, 1]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[
            styles.rayPart,
            {
              left: dissolve.left,
              top: dissolve.top,
              width: dissolve.width,
              height: dissolve.height,
              transform: [{ rotate: `${dissolve.angleDeg}deg` }],
            },
          ]}
        />
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
  rayPart: {
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
