/**
 * The projector sequence (U4): its geometry, its beat ordering, and the still
 * frame a Reduce Motion viewer gets instead of the motion.
 *
 * `expo-image` and `expo-linear-gradient` are mocked to nothing, so every
 * assertion below reads the ANIMATED wrappers this component owns rather than
 * a vendor's internals.
 */

jest.mock("expo-image", () => {
  const Image = () => null
  Image.prefetch = () => Promise.resolve(true)
  return { __esModule: true, Image }
})
jest.mock("expo-linear-gradient", () => ({
  __esModule: true,
  LinearGradient: () => null,
}))

import { act } from "react"
import { Animated } from "react-native"

import {
  MARK_ASPECT,
  MARK_BOTTOM_LEFT_Y,
  MARK_CENTROID_X,
  MARK_CENTROID_Y,
  WORD_RISE_FROM_CENTROID,
  WORD_SHIFT_LEFT_OF_CENTROID,
  MARK_WIDTH_RATIO,
  RAY_APEX_Y_RATIO,
  SPLASH_BLOOM_RISE_MS,
  SPLASH_BLOOM_SETTLE_MS,
  SPLASH_CRIMSON_DELAY_MS,
  SPLASH_CRIMSON_MS,
  SPLASH_RAY_DELAY_MS,
  SPLASH_SEQUENCE_MS,
  SPLASH_WORD_DELAY_MS,
  SPLASH_WORD_MS,
  SplashSequence,
  splashGeometry,
} from "../SplashSequence"
// The pair below is the invariant: the hold is stated in the session, the
// sequence's length here, and neither file can see the other's constant.
import {
  SPLASH_HOLD_MS,
  SPLASH_MOUNT_LAG_ALLOWANCE_MS,
} from "../../../lib/splash/splashSession"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const PHONE = { width: 390, height: 844 }
const TABLET = { width: 1024, height: 1366 }

/** The mark's corners, re-derived here rather than read back off the helper. */
function expectedCorners(frame: { width: number; height: number }) {
  const width = frame.width * 0.55
  const height = width / (48.194 / 35.2077)
  const left = (frame.width - width) / 2
  const top = (frame.height - height) / 2
  return {
    bottomLeft: { x: left, y: top + height * (22.4957 / 35.2077) },
    topRight: { x: left + width, y: top },
  }
}

/** Where an edge of the beam is after running `distance` from the apex. */
function march(
  apex: { x: number; y: number },
  angleDeg: number,
  travelled: number,
) {
  const radians = (angleDeg * Math.PI) / 180
  return {
    x: apex.x + Math.cos(radians) * travelled,
    y: apex.y + Math.sin(radians) * travelled,
  }
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * The HOST node for a testID. Both the animated composite and its host carry
 * the id, and only the host's style has the animated values resolved to
 * numbers, so the last match is the one worth reading.
 */
function styleOf(
  renderer: TestInstance,
  testID: string,
): Record<string, unknown> {
  const matches = renderer.root.findAll(
    (node: RenderedNode) => node.props.testID === testID,
  )
  expect(matches.length).toBeGreaterThan(0)
  const raw = matches[matches.length - 1].props.style
  const flat = Array.isArray(raw)
    ? Object.assign({}, ...raw.filter(Boolean))
    : raw
  return (flat ?? {}) as Record<string, unknown>
}

function scaleOf(style: Record<string, unknown>): number | undefined {
  const transform = style.transform as { scale?: number }[] | undefined
  return transform?.find((entry) => entry.scale !== undefined)?.scale
}

/**
 * The `Animated.Value` a beat drives, taken off the timing's own call. Driving
 * that value and reading the rendered style back is what proves a beat reaches
 * its layer — a call-shape assertion cannot, which is how the Fabric defect
 * shipped green.
 */
function valueDrivenBy(
  timing: jest.SpyInstance,
  matches: (config: { delay?: number }) => boolean,
): Animated.Value {
  const call = timing.mock.calls.find(([, config]) => matches(config))
  expect(call).toBeDefined()
  return call![0] as Animated.Value
}

let mounted: TestInstance | null = null

async function render(props: {
  reduceMotion: boolean
  onFirstFrame?: () => void
}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<SplashSequence {...props} />)
  })
  mounted = renderer
  return renderer
}

/** Flushes the `requestAnimationFrame` the first-frame signal waits on. */
async function flushFrame() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

// Unmounting is not tidiness: a real delayed timing holds a setTimeout that
// reaches for a native tag after the environment tears down, and only the
// layer's own cleanup stops it.
afterEach(async () => {
  const renderer = mounted
  mounted = null
  if (renderer) {
    await act(async () => {
      renderer.unmount()
    })
  }
  jest.restoreAllMocks()
})

describe("the beam's geometry (R9)", () => {
  it("puts the apex on the right edge, four fifths of the way down", () => {
    expect(splashGeometry(PHONE).apex).toEqual({
      x: PHONE.width,
      y: PHONE.height * RAY_APEX_Y_RATIO,
    })
    expect(splashGeometry(TABLET).apex).toEqual({
      x: TABLET.width,
      y: TABLET.height * RAY_APEX_Y_RATIO,
    })
  })

  it.each([
    ["a phone", PHONE],
    ["a tablet", TABLET],
  ])("lands both edges on the screen's corners on %s", (_label, frame) => {
    const geometry = splashGeometry(frame)
    const corners = expectedCorners(frame)

    const lower = march(
      geometry.apex,
      geometry.bottomLeftAngleDeg,
      distance(geometry.apex, corners.bottomLeft),
    )
    const upper = march(
      geometry.apex,
      geometry.topRightAngleDeg,
      distance(geometry.apex, corners.topRight),
    )

    expect(lower.x).toBeCloseTo(corners.bottomLeft.x, 6)
    expect(lower.y).toBeCloseTo(corners.bottomLeft.y, 6)
    expect(upper.x).toBeCloseTo(corners.topRight.x, 6)
    expect(upper.y).toBeCloseTo(corners.topRight.y, 6)
  })

  it("opens the cone by about 37.7 degrees on a 390x844 frame", () => {
    const geometry = splashGeometry(PHONE)
    expect(geometry.topRightAngleDeg - geometry.bottomLeftAngleDeg).toBeCloseTo(
      37.7,
      1,
    )
  })

  it("runs the beam past the far corner, so it does not stop on the mark", () => {
    const geometry = splashGeometry(PHONE)
    const corners = expectedCorners(PHONE)
    expect(geometry.rayLength).toBeGreaterThan(
      distance(geometry.apex, corners.bottomLeft),
    )
  })

  it("sets the word off the mark's alpha centroid, not its box centre", () => {
    const geometry = splashGeometry(PHONE)
    // Left of it: the sliced bottom-left corner pulls the centroid right, so
    // anchoring there leaves more red to the word's left than to its right.
    expect(geometry.wordCenter.x).toBeCloseTo(
      geometry.mark.left +
        geometry.mark.width * (MARK_CENTROID_X - WORD_SHIFT_LEFT_OF_CENTROID),
      6,
    )
    // Above it: the centroid weights the sloped tail, which is not part of the
    // screen a viewer reads text on.
    expect(geometry.wordCenter.y).toBeCloseTo(
      geometry.mark.top +
        geometry.mark.height * (MARK_CENTROID_Y - WORD_RISE_FROM_CENTROID),
      6,
    )
    expect(WORD_RISE_FROM_CENTROID).toBeGreaterThan(0)
    expect(WORD_SHIFT_LEFT_OF_CENTROID).toBeGreaterThan(0)
    // The centroid is off both axes, so it is not the box centre either way.
    expect(MARK_CENTROID_X).not.toBe(0.5)
    expect(MARK_CENTROID_Y).not.toBe(0.5)
  })

  it.each([
    ["a phone", PHONE],
    ["a tablet", TABLET],
  ])("keeps the word's line box inside the screen on %s", (_label, frame) => {
    const geometry = splashGeometry(frame)
    const boxTop = geometry.wordCenter.y - geometry.lineHeight / 2
    const boxBottom = geometry.wordCenter.y + geometry.lineHeight / 2

    // The real constraint, replacing an earlier proxy that floored the word at
    // the left edge's mid-height: the LINE BOX must clear the mark's top edge
    // and stay above the point where the left edge ends, or the word reads as
    // falling off the screen rather than set on it.
    expect(boxTop).toBeGreaterThan(geometry.mark.top)
    expect(boxBottom).toBeLessThan(
      geometry.mark.top + geometry.mark.height * MARK_BOTTOM_LEFT_Y,
    )
    // Still above the centroid it is measured from, in the direction the lift
    // is named for.
    expect(geometry.wordCenter.y).toBeLessThan(
      geometry.mark.top + geometry.mark.height * MARK_CENTROID_Y,
    )

    const across =
      (geometry.wordCenter.x - geometry.mark.left) / geometry.mark.width
    // Between the box centre and the centroid: the shift corrects the lean the
    // sliced corner causes without carrying the word past the middle.
    expect(across).toBeGreaterThan(0.5)
    expect(across).toBeLessThan(MARK_CENTROID_X)
  })

  it("keeps the mark's own proportions on both frames", () => {
    for (const frame of [PHONE, TABLET]) {
      const { mark } = splashGeometry(frame)
      expect(mark.width).toBeCloseTo(frame.width * MARK_WIDTH_RATIO, 6)
      expect(mark.width / mark.height).toBeCloseTo(MARK_ASPECT, 6)
      expect(MARK_BOTTOM_LEFT_Y).toBeCloseTo(22.4957 / 35.2077, 6)
    }
  })
})

describe("beat ordering (R10)", () => {
  it("finishes the crimson crossfade before the word starts to fade in", () => {
    expect(SPLASH_CRIMSON_DELAY_MS + SPLASH_CRIMSON_MS).toBeLessThanOrEqual(
      SPLASH_WORD_DELAY_MS,
    )
  })

  it("leaves the hold room for the cover's own mount lag", () => {
    // The session owns the hold; this is the floor its hold has to cover.
    expect(SPLASH_SEQUENCE_MS).toBe(SPLASH_WORD_DELAY_MS + SPLASH_WORD_MS)

    // Not `<= SPLASH_HOLD_MS`: the hold starts when the session turns the
    // cover visible, and the cover takes time to mount and paint after that.
    // Measured at ~200ms on the iPhone 17 Pro Max simulator from a Release
    // build; spend the margin and the exit fade clips the word's fade-in.
    expect(SPLASH_HOLD_MS - SPLASH_SEQUENCE_MS).toBeGreaterThanOrEqual(
      SPLASH_MOUNT_LAG_ALLOWANCE_MS,
    )
  })

  it("wires those constants into the animation it starts", async () => {
    const timing = jest.spyOn(Animated, "timing")
    await render({ reduceMotion: false })

    const configs = timing.mock.calls.map(([, config]) => config)
    expect(configs).toContainEqual(
      expect.objectContaining({
        delay: SPLASH_CRIMSON_DELAY_MS,
        duration: SPLASH_CRIMSON_MS,
        useNativeDriver: true,
      }),
    )
    expect(configs).toContainEqual(
      expect.objectContaining({
        delay: SPLASH_WORD_DELAY_MS,
        duration: SPLASH_WORD_MS,
        useNativeDriver: true,
      }),
    )
  })
})

describe("the word (R11)", () => {
  it.each([
    ["while it animates", false],
    ["on the still frame", true],
  ])("carries no transform %s", async (_label, reduceMotion) => {
    const renderer = await render({ reduceMotion })
    const style = styleOf(renderer, "splash-word")

    expect(style.transform).toBeUndefined()
    expect(style.opacity).toBeDefined()
  })
})

describe("Reduce Motion (R13)", () => {
  it("renders the finished frame and starts no animation", async () => {
    const timing = jest.spyOn(Animated, "timing")
    const parallel = jest.spyOn(Animated, "parallel")

    const renderer = await render({ reduceMotion: true })

    expect(timing).not.toHaveBeenCalled()
    expect(parallel).not.toHaveBeenCalled()
    expect(scaleOf(styleOf(renderer, "splash-mark"))).toBe(1)
    expect(scaleOf(styleOf(renderer, "splash-ray"))).toBe(1)
    expect(styleOf(renderer, "splash-mark-crimson").opacity).toBe(1)
    expect(styleOf(renderer, "splash-word").opacity).toBe(1)
  })

  it("starts the sequence when it is off", async () => {
    const start = jest.fn()
    jest
      .spyOn(Animated, "parallel")
      .mockReturnValue({ start, stop: jest.fn() } as never)

    const renderer = await render({ reduceMotion: false })

    expect(start).toHaveBeenCalledTimes(1)
    // The still frame's end values are NOT where the motion path begins.
    expect(scaleOf(styleOf(renderer, "splash-mark"))).toBe(0)
    expect(scaleOf(styleOf(renderer, "splash-ray"))).toBe(0)
    expect(styleOf(renderer, "splash-mark-crimson").opacity).toBe(0)
    expect(styleOf(renderer, "splash-word").opacity).toBe(0)
  })

  it("stops the animation when the layer unmounts", async () => {
    const stop = jest.fn()
    jest
      .spyOn(Animated, "parallel")
      .mockReturnValue({ start: jest.fn(), stop } as never)

    const renderer = await render({ reduceMotion: false })
    await act(async () => {
      renderer.unmount()
    })

    expect(stop).toHaveBeenCalled()
  })
})

describe("the Fabric single-run defect (KTD9)", () => {
  it("never wraps a sequence in Animated.loop", async () => {
    const loop = jest.spyOn(Animated, "loop")
    await render({ reduceMotion: false })
    expect(loop).not.toHaveBeenCalled()
  })

  it("uses no Animated.sequence at all", async () => {
    // Observed on the Android release build, emulator API 35: the bloom was an
    // Animated.sequence nested in the Animated.parallel and simply never ran,
    // while its sibling plain timings did. Glide logged both mark rasters
    // decoded at 1024x748, so the images were fine — the scale stayed at 0 and
    // the projector screen never appeared. iOS ran the same code correctly.
    const sequence = jest.spyOn(Animated, "sequence")
    await render({ reduceMotion: false })
    expect(sequence).not.toHaveBeenCalled()
  })

  it("drives the bloom's overshoot by interpolation, not a second timing", async () => {
    const timing = jest.spyOn(Animated, "timing")
    await render({ reduceMotion: false })

    // One timing per beat and no more: bloom, ray, crimson, word.
    expect(timing).toHaveBeenCalledTimes(4)
    const bloomConfig = timing.mock.calls
      .map(([, config]) => config)
      .find((config) => config.toValue === 1 && config.delay === undefined)
    expect(bloomConfig?.duration).toBe(
      SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS,
    )
  })

  it("drives every beat's own layer, not just the timing config", async () => {
    // The defect this whole block exists for was a mark that never moved while
    // its sibling beats did, so the guards above — which read Animated CALLS —
    // could not see it. These assertions read the RENDERED style instead: wire
    // any layer to a static value and it stays at rest here while every
    // call-shape check stays green.
    const timing = jest.spyOn(Animated, "timing")
    jest
      .spyOn(Animated, "parallel")
      .mockReturnValue({ start: jest.fn(), stop: jest.fn() } as never)

    const renderer = await render({ reduceMotion: false })

    // The bloom is the only beat with no delay; the other three carry theirs.
    const bloom = valueDrivenBy(timing, (config) => config.delay === undefined)
    const ray = valueDrivenBy(
      timing,
      (config) => config.delay === SPLASH_RAY_DELAY_MS,
    )
    const crimson = valueDrivenBy(
      timing,
      (config) => config.delay === SPLASH_CRIMSON_DELAY_MS,
    )
    const word = valueDrivenBy(
      timing,
      (config) => config.delay === SPLASH_WORD_DELAY_MS,
    )

    await act(async () => {
      bloom.setValue(1)
      ray.setValue(1)
      crimson.setValue(1)
      word.setValue(1)
    })

    expect(scaleOf(styleOf(renderer, "splash-mark"))).toBe(1)
    expect(scaleOf(styleOf(renderer, "splash-ray"))).toBe(1)
    expect(styleOf(renderer, "splash-mark-crimson").opacity).toBe(1)
    expect(styleOf(renderer, "splash-word").opacity).toBe(1)
  })

  it("carries the bloom's overshoot on the way to that end state", async () => {
    const timing = jest.spyOn(Animated, "timing")
    jest
      .spyOn(Animated, "parallel")
      .mockReturnValue({ start: jest.fn(), stop: jest.fn() } as never)

    const renderer = await render({ reduceMotion: false })
    const bloom = valueDrivenBy(timing, (config) => config.delay === undefined)

    // R8's overshoot rides the interpolation now that the second timing is
    // gone. Without it the mark would rise straight to 1 and never spring.
    await act(async () => {
      bloom.setValue(
        SPLASH_BLOOM_RISE_MS / (SPLASH_BLOOM_RISE_MS + SPLASH_BLOOM_SETTLE_MS),
      )
    })

    expect(scaleOf(styleOf(renderer, "splash-mark"))).toBeGreaterThan(1)
  })
})

describe("the first-frame signal", () => {
  it.each([
    ["with the motion", false],
    ["on the still frame", true],
  ])("fires exactly once %s", async (_label, reduceMotion) => {
    const onFirstFrame = jest.fn()
    const renderer = await render({ reduceMotion, onFirstFrame })

    await flushFrame()
    expect(onFirstFrame).toHaveBeenCalledTimes(1)

    // A re-render must not fire it a second time.
    await act(async () => {
      renderer.update(
        <SplashSequence
          reduceMotion={reduceMotion}
          onFirstFrame={onFirstFrame}
        />,
      )
    })
    await flushFrame()
    expect(onFirstFrame).toHaveBeenCalledTimes(1)
  })
})
