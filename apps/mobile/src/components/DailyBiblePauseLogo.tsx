import { useMemo } from "react"
import { Animated, Easing, StyleSheet, View } from "react-native"

import { TEXT_BODY } from "../lib/color"

type Point = { x: number; y: number }

/** Stroke centrelines traced from the 702 x 388 px logo artwork, listed from
 *  the top outer corner. The right panel mirrors the left one. */
const ART_LOGO_PANEL: Point[] = [
  { x: 294, y: 83 },
  { x: 294, y: 187 },
  { x: 337, y: 181 },
  { x: 337, y: 93 },
]
/** The same panel as a pause bar: the inner side as long as the outer one. */
const ART_PAUSE_PANEL: Point[] = [
  { x: 294, y: 83 },
  { x: 294, y: 187 },
  { x: 337, y: 187 },
  { x: 337, y: 83 },
]
const ART_MIRROR_X = 351.75
const ART_ORIGIN: Point = { x: 294, y: 83 }
const ART_ICON_WIDTH = 115.5
const ART_ICON_HEIGHT = 104
const ART_STROKE = 4.5
const ART_CORNER_RADIUS = 4
const ART_TEXT_GAP = 76
const ART_CAP_HEIGHT = 36

const ICON_HEIGHT = 56
const SCALE = ICON_HEIGHT / ART_ICON_HEIGHT
const STROKE = ART_STROKE * SCALE
const CORNER_STEPS = 4

const TITLE = "DAILY BIBLE PAUSE"
// SF Pro's cap height is about 0.7 em.
const FONT_SIZE = Math.round((ART_CAP_HEIGHT * SCALE) / 0.7)
const TRACKING = 4
const SPACE_WIDTH = 8
// The title's line box starts about 7 pt above its caps (iPhone 17, measured).
const TITLE_LEADING = 7

/** Four pens draw the pause bars, then each bar's inner side shrinks. */
export const LOGO_DRAW_MS = 700
export const LOGO_MORPH_MS = 300
export const LOGO_DURATION_MS = LOGO_DRAW_MS + LOGO_MORPH_MS

// Phases of the logo's own 0..1 clock. The title shows only during the morph.
const DRAW_END = LOGO_DRAW_MS / LOGO_DURATION_MS
const PEN_WINDOW = [0, DRAW_END] as const
const MORPH_WINDOW = [DRAW_END, 1] as const
const LETTER_FADE = 150 / LOGO_DURATION_MS
const PEN_TOUCH_DOWN = 0.0005
const MORPH_SAMPLES = 8

const penEase = Easing.bezier(0.37, 0, 0.63, 1)
const morphEase = Easing.bezier(0.42, 0, 0.58, 1)

const mirrored = (panel: Point[]): Point[] =>
  panel.map((p) => ({ x: 2 * ART_MIRROR_X - p.x, y: p.y }))

/** The pen's eased clock, inverted: when has it covered this share of the path? */
function timeForShare(share: number): number {
  let low = 0
  let high = 1
  for (let i = 0; i < 30; i += 1) {
    const mid = (low + high) / 2
    if (penEase(mid) < share) low = mid
    else high = mid
  }
  return (low + high) / 2
}

function toward(from: Point, to: Point, distance: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  return {
    x: from.x + ((to.x - from.x) / length) * distance,
    y: from.y + ((to.y - from.y) / length) * distance,
  }
}

/** Two pen paths round a rounded polygon. Both start at the middle of the
 *  first corner and meet at the middle of the opposite corner. */
function penPaths(corners: Point[]): [Point[], Point[]] {
  const count = corners.length
  const arc = (index: number): Point[] => {
    const corner = corners[index]!
    const enter = toward(
      corner,
      corners[(index + count - 1) % count]!,
      ART_CORNER_RADIUS,
    )
    const exit = toward(
      corner,
      corners[(index + 1) % count]!,
      ART_CORNER_RADIUS,
    )
    const points: Point[] = []
    for (let step = 0; step <= CORNER_STEPS; step += 1) {
      const t = step / CORNER_STEPS
      points.push({
        x:
          (1 - t) ** 2 * enter.x + 2 * (1 - t) * t * corner.x + t ** 2 * exit.x,
        y:
          (1 - t) ** 2 * enter.y + 2 * (1 - t) * t * corner.y + t ** 2 * exit.y,
      })
    }
    return points
  }
  const half = CORNER_STEPS / 2
  const meetCorner = Math.floor(count / 2)
  const loop = arc(0).slice(half)
  let meet = 0
  for (let index = 1; index < count; index += 1) {
    if (index === meetCorner) meet = loop.length + half
    loop.push(...arc(index))
  }
  loop.push(...arc(0).slice(0, half + 1))
  return [loop.slice(0, meet + 1), loop.slice(meet).reverse()]
}

const toPoints = (path: Point[]): Point[] =>
  path.map((point) => ({
    x: (point.x - ART_ORIGIN.x) * SCALE,
    y: (point.y - ART_ORIGIN.y) * SCALE,
  }))

type Morph = {
  input: number[]
  translateX: number[]
  translateY: number[]
  rotate: string[]
  scaleX: number[]
}

export type Stroke = {
  key: string
  start: Point
  length: number
  penFrom: number
  penTo: number
  morph: Morph
}

/** One pen's segments. Each is drawn on the bar's geometry, then moved,
 *  turned and stretched onto the matching segment of the trapezium. */
function penStrokes(name: string, bar: Point[], logo: Point[]): Stroke[] {
  const from = toPoints(bar)
  const to = toPoints(logo)
  const lengths = from
    .slice(1)
    .map((point, i) => Math.hypot(point.x - from[i]!.x, point.y - from[i]!.y))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const [penBegin, penEnd] = PEN_WINDOW
  const [morphBegin, morphEnd] = MORPH_WINDOW
  let covered = 0

  return lengths.map((length, i) => {
    const penFrom =
      penBegin + (penEnd - penBegin) * timeForShare(covered / total)
    covered += length
    const penTo = penBegin + (penEnd - penBegin) * timeForShare(covered / total)

    const morph: Morph = {
      input: [],
      translateX: [],
      translateY: [],
      rotate: [],
      scaleX: [],
    }
    let previousAngle = 0
    for (let k = 0; k <= MORPH_SAMPLES; k += 1) {
      const m = morphEase(k / MORPH_SAMPLES)
      const lerp = (a: Point, b: Point): Point => ({
        x: a.x + (b.x - a.x) * m,
        y: a.y + (b.y - a.y) * m,
      })
      const start = lerp(from[i]!, to[i]!)
      const end = lerp(from[i + 1]!, to[i + 1]!)
      let angle = Math.atan2(end.y - start.y, end.x - start.x)
      // Unwrap, so a segment near ±180° never spins the long way round.
      if (k > 0) {
        while (angle - previousAngle > Math.PI) angle -= 2 * Math.PI
        while (angle - previousAngle < -Math.PI) angle += 2 * Math.PI
      }
      previousAngle = angle
      const span = Math.hypot(end.x - start.x, end.y - start.y)
      morph.input.push(
        morphBegin + ((morphEnd - morphBegin) * k) / MORPH_SAMPLES,
      )
      morph.translateX.push(start.x - from[i]!.x)
      morph.translateY.push(start.y - from[i]!.y)
      morph.rotate.push(`${(angle * 180) / Math.PI}deg`)
      morph.scaleX.push((span + STROKE / 2) / (length + STROKE / 2))
    }

    return {
      key: `${name}-${i}`,
      start: from[i]!,
      length,
      penFrom,
      penTo: Math.max(penTo, penFrom + 2 * PEN_TOUCH_DOWN),
      morph,
    }
  })
}

function panelStrokes(name: string, bar: Point[], logo: Point[]): Stroke[] {
  const [barA, barB] = penPaths(bar)
  const [logoA, logoB] = penPaths(logo)
  return [
    ...penStrokes(`${name}-a`, barA, logoA),
    ...penStrokes(`${name}-b`, barB, logoB),
  ]
}

/** Every segment of the mark, keyed `<panel>-<pen>-<index>`, in pen order. */
export function logoStrokes(): Stroke[] {
  return [
    ...panelStrokes("left", ART_PAUSE_PANEL, ART_LOGO_PANEL),
    ...panelStrokes(
      "right",
      mirrored(ART_PAUSE_PANEL),
      mirrored(ART_LOGO_PANEL),
    ),
  ]
}

/** The Daily Bible Pause mark as `draw` runs 0 to 1: pens draw two pause
 *  bars, then each bar's inner side shrinks into the logo's trapezium. */
export function DailyBiblePauseLogo({ draw }: { draw: Animated.Value }) {
  const strokes = useMemo(logoStrokes, [])

  const at = (input: number[], output: number[] | string[]) =>
    draw.interpolate({
      inputRange: input,
      outputRange: output,
      extrapolate: "clamp",
    })

  const letters = useMemo(() => {
    const [begin, end] = MORPH_WINDOW
    const stagger = (end - begin - LETTER_FADE) / (TITLE.length - 1)
    return [...TITLE].map((char, index) => {
      const from = begin + stagger * index
      return {
        char,
        opacity: draw.interpolate({
          inputRange: [from, from + LETTER_FADE],
          outputRange: [0, 1],
          extrapolate: "clamp",
        }),
      }
    })
  }, [draw])

  // A slow push toward the viewer through both phases.
  const scale = draw.interpolate({
    inputRange: [0, 1],
    outputRange: [0.97, 1],
    extrapolate: "clamp",
  })

  return (
    <Animated.View style={[styles.lockup, { transform: [{ scale }] }]}>
      <View
        style={{
          width: ART_ICON_WIDTH * SCALE,
          height: ART_ICON_HEIGHT * SCALE,
        }}
      >
        {strokes.map((stroke) => (
          // The track carries a round cap past each end, so joints overlap.
          <Animated.View
            key={stroke.key}
            style={[
              styles.track,
              {
                left: stroke.start.x - STROKE / 2,
                top: stroke.start.y - STROKE / 2,
                width: stroke.length + STROKE,
                transformOrigin: [STROKE / 2, STROKE / 2, 0],
                transform: [
                  {
                    translateX: at(stroke.morph.input, stroke.morph.translateX),
                  },
                  {
                    translateY: at(stroke.morph.input, stroke.morph.translateY),
                  },
                  { rotate: at(stroke.morph.input, stroke.morph.rotate) },
                  { scaleX: at(stroke.morph.input, stroke.morph.scaleX) },
                ],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.ink,
                {
                  width: stroke.length + STROKE,
                  transform: [
                    {
                      // Hidden until the pen arrives; then its round cap
                      // touches down and the line runs to the next point.
                      translateX: at(
                        [
                          stroke.penFrom,
                          stroke.penFrom + PEN_TOUCH_DOWN,
                          stroke.penTo,
                        ],
                        [-(stroke.length + STROKE), -stroke.length, 0],
                      ),
                    },
                  ],
                },
              ]}
            />
          </Animated.View>
        ))}
      </View>
      <View style={styles.title}>
        {letters.map(({ char, opacity }, index) =>
          char === " " ? (
            <View key={index} style={styles.space} />
          ) : (
            <Animated.Text
              key={index}
              style={[
                styles.letter,
                index < TITLE.length - 1 && styles.tracked,
                { opacity },
              ]}
            >
              {char}
            </Animated.Text>
          ),
        )}
      </View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  // Balances the empty line box under the caps, so the visible mark centres.
  lockup: { alignItems: "center", paddingTop: TITLE_LEADING },
  track: {
    position: "absolute",
    height: STROKE,
    borderRadius: STROKE / 2,
    overflow: "hidden",
  },
  ink: {
    height: STROKE,
    borderRadius: STROKE / 2,
    backgroundColor: TEXT_BODY,
  },
  title: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: ART_TEXT_GAP * SCALE - TITLE_LEADING,
  },
  letter: {
    color: TEXT_BODY,
    fontFamily: "System",
    fontSize: FONT_SIZE,
    fontWeight: "300",
  },
  tracked: { marginRight: TRACKING },
  space: { width: SPACE_WIDTH },
})
