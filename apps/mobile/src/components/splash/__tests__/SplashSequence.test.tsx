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
import { Animated, Dimensions } from "react-native"

import {
  MARK_ASPECT,
  MARK_BOTTOM_LEFT_Y,
  MARK_CENTROID_X,
  MARK_CENTROID_Y,
  WORD_RISE_FROM_CENTROID,
  WORD_SHIFT_LEFT_OF_CENTROID,
  MARK_WIDTH_RATIO,
  RAY_APEX_X_RATIO,
  RAY_BAND_COUNT,
  RAY_BAND_PROFILE,
  RAY_DISSOLVE_DEPTH_RATIO,
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
import { BG_COLOR, TEXT_ON_OVERLAY, hexToRgba } from "../../../lib/color"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const PHONE = { width: 390, height: 844 }
/** Wider than the 5.37:1 ratio at which the angular sweep crosses atan2's
 *  branch cut. Both other fixtures are portrait and cannot reach it. */
const WIDE = { width: 1200, height: 220 }
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

function degreesOf(x: number, y: number) {
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** Into (-180, 180], so two angles can be compared without a wrap artefact. */
function normalizeDeg(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180
}

/** A rendered node's style array, collapsed to one object. */
function flatten(raw: unknown): Record<string, unknown> {
  const merged = Array.isArray(raw)
    ? Object.assign({}, ...raw.filter(Boolean))
    : raw
  return (merged ?? {}) as Record<string, unknown>
}

/** Where a beam edge crosses into the frame, and how far it ran to get there. */
function crossRightEdge(
  apex: { x: number; y: number },
  angleDeg: number,
  frameWidth: number,
) {
  const travelled = (frameWidth - apex.x) / Math.cos((angleDeg * Math.PI) / 180)
  return { travelled, ...march(apex, angleDeg, travelled) }
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
  it("puts the apex PAST the right edge, four fifths of the way down", () => {
    // On the edge, the bands converge to a point of light the viewer can see.
    expect(RAY_APEX_X_RATIO).toBeGreaterThan(1)
    for (const frame of [PHONE, TABLET]) {
      const { apex } = splashGeometry(frame)
      expect(apex).toEqual({
        x: frame.width * RAY_APEX_X_RATIO,
        y: frame.height * RAY_APEX_Y_RATIO,
      })
      expect(apex.x).toBeGreaterThan(frame.width)
    }
  })

  it.each([
    ["a phone", PHONE],
    ["a tablet", TABLET],
  ])("crosses into %s as a band, never as a point", (_label, frame) => {
    const geometry = splashGeometry(frame)
    const edges = [geometry.bottomLeftAngleDeg, geometry.topRightAngleDeg].map(
      (angleDeg) => crossRightEdge(geometry.apex, angleDeg, frame.width),
    )

    for (const edge of edges) {
      // Both edges run left OUT of the apex and arrive on the right edge, so
      // the beam enters through that edge rather than round the bottom corner.
      expect(edge.travelled).toBeGreaterThan(0)
      expect(edge.x).toBeCloseTo(frame.width, 6)
      expect(edge.y).toBeGreaterThan(0)
      expect(edge.y).toBeLessThan(frame.height)
    }

    // The gap between them is the beam's width where a viewer first sees it.
    // At the apex it is zero, which is the pinch this requirement removes.
    expect(Math.abs(edges[0].y - edges[1].y) / frame.height).toBeGreaterThan(
      0.1,
    )
  })

  it("fades every band out at BOTH of its own edges", () => {
    // This is the whole reason a viewer cannot count the bands. A band that is
    // uniform across its thickness puts a step at each edge, and the steps add
    // up into visible streaks inside the beam.
    const profile: number[] = [...RAY_BAND_PROFILE]
    expect(profile.length).toBeGreaterThanOrEqual(5)
    expect(profile[0]).toBe(0)
    expect(profile[profile.length - 1]).toBe(0)

    // Symmetric, so a band is not brighter on one side than the other.
    expect(profile).toEqual([...profile].reverse())

    // One peak in the middle, reached without a plateau or a second bump.
    const peak = Math.max(...profile)
    expect(peak).toBe(1)
    expect(profile.indexOf(peak)).toBe((profile.length - 1) / 2)
    const rising = profile.slice(0, (profile.length + 1) / 2)
    for (let i = 1; i < rising.length; i += 1) {
      expect(rising[i]).toBeGreaterThan(rising[i - 1])
    }

    // Its SLOPE also reaches zero at the edges, so the sum has no visible
    // kink: the first step in is smaller than the next one.
    expect(profile[1] - profile[0]).toBeLessThan(profile[2] - profile[1])
  })

  it.each([
    ["a phone", PHONE],
    ["a tablet", TABLET],
  ])("sizes band thickness off the far-end gap, on %s", (_label, frame) => {
    const geometry = splashGeometry(frame)
    // Derived here from the arc the cone subtends at its far end, in RADIANS.
    // Compared only against itself, a reinstated degrees-to-radians conversion
    // would leave the whole suite green while every band became hair-thin.
    const gapAtFarEnd =
      (geometry.rayLength * Math.abs((geometry.sweepDeg * Math.PI) / 180)) /
      (RAY_BAND_COUNT - 1)
    expect(geometry.bandThickness / gapAtFarEnd).toBeCloseTo(4, 6)
    // Sanity on the unit itself: a degrees-denominated step would be ~57x too
    // small, so pin the thickness to a real fraction of the frame.
    expect(geometry.bandThickness).toBeGreaterThan(frame.width * 0.04)
  })

  it.each([
    ["a phone", PHONE],
    ["a tablet", TABLET],
  ])("squares the dissolve onto the corner line, on %s", (_label, frame) => {
    const geometry = splashGeometry(frame)
    const corners = expectedCorners(frame)
    const { dissolve } = geometry

    // Its gradient runs along the corner line's NORMAL. Any other angle and the
    // bands' ends fade on different schedules, which is a visible edge again.
    const lineAngle = degreesOf(
      corners.topRight.x - corners.bottomLeft.x,
      corners.topRight.y - corners.bottomLeft.y,
    )
    const perpendicular = Math.abs(
      normalizeDeg(dissolve.angleDeg - lineAngle) % 180,
    )
    expect(perpendicular).toBeCloseTo(0, 6)

    // The dissolve is measured square to the corner line, so the share of the
    // DEPTH it covers is the same on every frame. Scale it off a band's length
    // instead and this reads 0.56 on a phone against 0.66 on a tablet.
    const apexToLine = {
      x: corners.bottomLeft.x - geometry.apex.x,
      y: corners.bottomLeft.y - geometry.apex.y,
    }
    const span = {
      x: corners.topRight.x - corners.bottomLeft.x,
      y: corners.topRight.y - corners.bottomLeft.y,
    }
    const spanLength = Math.hypot(span.x, span.y)
    const lineDepth = Math.abs(
      (apexToLine.x * -span.y + apexToLine.y * span.x) / spanLength,
    )
    expect((dissolve.stop * dissolve.height) / lineDepth).toBeCloseTo(
      RAY_DISSOLVE_DEPTH_RATIO,
      6,
    )

    expect(dissolve.height).toBeGreaterThan(0)
    // It has to be wider than the beam is at that depth, or it clips the sides.
    expect(dissolve.width).toBeGreaterThan(
      distance(corners.bottomLeft, corners.topRight),
    )
    // Fully opaque BEFORE its own far edge, so nothing shows past the line.
    expect(dissolve.stop).toBeGreaterThan(0)
    expect(dissolve.stop).toBeLessThan(1)
    // And that tail has to be deep enough to cover the outermost band's own
    // half-thickness, which overhangs the corner line perpendicular to it.
    expect(dissolve.height * (1 - dissolve.stop)).toBeGreaterThan(
      geometry.bandThickness / 2,
    )

    // TESTING (#1): the position is derived here from the corners and the apex,
    // NOT read back off the helper. Every other assertion in this file compares
    // the dissolve's box to the same value production computed, so a sign flip
    // or an x/y swap in `dissolveCentre` would leave the whole suite green.
    const lineMiddle = {
      x: (corners.bottomLeft.x + corners.topRight.x) / 2,
      y: (corners.bottomLeft.y + corners.topRight.y) / 2,
    }
    const away = { x: -span.y / spanLength, y: span.x / spanLength }
    const facing = apexToLine.x * away.x + apexToLine.y * away.y < 0 ? -1 : 1
    const depthOfCentre =
      lineDepth * (1 - RAY_DISSOLVE_DEPTH_RATIO) + dissolve.height / 2
    const expected = {
      x:
        lineMiddle.x +
        away.x * facing * (depthOfCentre - lineDepth) -
        geometry.apex.x +
        geometry.rayLength,
      y:
        lineMiddle.y +
        away.y * facing * (depthOfCentre - lineDepth) -
        geometry.apex.y +
        geometry.rayLength,
    }
    expect(dissolve.left).toBeCloseTo(expected.x - dissolve.width / 2, 4)
    expect(dissolve.top).toBeCloseTo(expected.y - dissolve.height / 2, 4)
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

  it("opens the cone by about 29.4 degrees on a 390x844 frame", () => {
    const geometry = splashGeometry(PHONE)
    // Narrower than the 37.7 degrees the on-edge apex gave. Pinned on BOTH
    // sides: the cone stops reading as a cone at about 17 degrees, and stops
    // hiding its origin below about 1.09 of the frame's width.
    expect(geometry.sweepDeg).toBeCloseTo(29.4, 1)
  })

  it.each([
    ["a phone", PHONE],
    ["a tablet", TABLET],
  ])("stops the beam ON the two corners it lights, on %s", (_label, frame) => {
    const geometry = splashGeometry(frame)
    const corners = expectedCorners(frame)
    const bands = geometry.bands

    // The outermost bands END on the corners — they no longer run past them.
    const lower = march(geometry.apex, bands[0].angleDeg, bands[0].length)
    const upper = march(
      geometry.apex,
      bands[bands.length - 1].angleDeg,
      bands[bands.length - 1].length,
    )
    expect(lower.x).toBeCloseTo(corners.bottomLeft.x, 4)
    expect(lower.y).toBeCloseTo(corners.bottomLeft.y, 4)
    expect(upper.x).toBeCloseTo(corners.topRight.x, 4)
    expect(upper.y).toBeCloseTo(corners.topRight.y, 4)

    // And every band between them ends ON the segment joining those corners,
    // so the beam's far edge is that line rather than an arc past it.
    const span = {
      x: corners.topRight.x - corners.bottomLeft.x,
      y: corners.topRight.y - corners.bottomLeft.y,
    }
    for (const band of bands) {
      const end = march(geometry.apex, band.angleDeg, band.length)
      const along =
        ((end.x - corners.bottomLeft.x) * span.x +
          (end.y - corners.bottomLeft.y) * span.y) /
        (span.x * span.x + span.y * span.y)
      expect(along).toBeGreaterThanOrEqual(-1e-6)
      expect(along).toBeLessThanOrEqual(1 + 1e-6)
      const offLine = distance(end, {
        x: corners.bottomLeft.x + span.x * along,
        y: corners.bottomLeft.y + span.y * along,
      })
      expect(offLine).toBeLessThan(1e-6)
    }

    // The bands are NOT all one length: the upper edge is the shorter reach,
    // and drawing it to the longer one is what ran it past its corner.
    expect(bands[bands.length - 1].length).toBeLessThan(bands[0].length)
    expect(geometry.rayLength).toBeCloseTo(bands[0].length, 6)
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

  it("emits finite stops for a frame that has not been measured yet", () => {
    // The cover mounts on the first frame of a cold start, where the window can
    // still measure 0x0. The stops are a ratio now, so 0/0 would put NaN on the
    // locations array of all 28 native gradient views.
    for (const frame of [
      { width: 0, height: 0 },
      { width: 0, height: 844 },
      { width: 390, height: 0 },
      WIDE,
    ]) {
      const geometry = splashGeometry(frame)
      expect(geometry.bands).toHaveLength(RAY_BAND_COUNT)
      for (const band of geometry.bands) {
        expect(Number.isFinite(band.length)).toBe(true)
        expect(band.length).toBeGreaterThanOrEqual(0)
      }
      expect(Number.isFinite(geometry.bandThickness)).toBe(true)
      // Finiteness alone passed on a fan that swept the long way round the
      // circle. The cone is a narrow wedge, so bound the sweep and the reach.
      expect(Math.abs(geometry.sweepDeg)).toBeLessThan(90)
      expect(geometry.rayLength).toBeLessThanOrEqual(
        Math.hypot(frame.width, frame.height) * 2 + 1,
      )
      for (const value of [
        geometry.dissolve.left,
        geometry.dissolve.top,
        geometry.dissolve.width,
        geometry.dissolve.height,
        geometry.dissolve.angleDeg,
        geometry.dissolve.stop,
      ]) {
        expect(Number.isFinite(value)).toBe(true)
      }
    }
  })

  it("draws every band ACROSS its thickness, at its own length", async () => {
    const renderer = await render({ reduceMotion: true })
    const geometry = splashGeometry(Dimensions.get("window"))
    const drawn = renderer.root.findAll(
      (node) =>
        Array.isArray(node.props.locations) && node.props.testID === undefined,
    )
    expect(drawn).toHaveLength(RAY_BAND_COUNT)

    drawn.forEach((node, index) => {
      const band = geometry.bands[index]
      const style = flatten(node.props.style)

      // `start` and `end` sharing an x runs the gradient down the band's
      // THICKNESS. Along its length instead, every band is uniform across —
      // which is what let a viewer count them inside the beam.
      expect(node.props.start).toEqual({ x: 0.5, y: 0 })
      expect(node.props.end).toEqual({ x: 0.5, y: 1 })

      const colors = node.props.colors as string[]
      const locations = node.props.locations as number[]
      expect(colors).toHaveLength(RAY_BAND_PROFILE.length)
      expect(locations).toHaveLength(RAY_BAND_PROFILE.length)
      // Both edges fully transparent, the middle the brightest.
      expect(colors[0]).toBe(hexToRgba(TEXT_ON_OVERLAY, 0))
      expect(colors[colors.length - 1]).toBe(hexToRgba(TEXT_ON_OVERLAY, 0))
      expect(colors[(colors.length - 1) / 2]).not.toBe(colors[0])
      // Ascending across the whole band, so the profile is not skewed or clipped.
      expect(locations[0]).toBe(0)
      expect(locations[locations.length - 1]).toBe(1)
      locations.forEach((value, at) => {
        if (at > 0) expect(value).toBeGreaterThan(locations[at - 1])
      })

      expect(style.width).toBeCloseTo(band.length, 6)
      expect(style.height).toBeCloseTo(geometry.bandThickness, 6)
      // A band points LEFT out of the apex, so it is drawn half a turn back.
      const transform = style.transform as Record<string, unknown>[]
      const rotate = transform.find((entry) => entry.rotate !== undefined)
      expect(rotate?.rotate).toBe(`${band.angleDeg - 180}deg`)
    })

    // Not all one length — that is the whole point of the band list.
    const widths = drawn.map(
      (node) => flatten(node.props.style).width as number,
    )
    expect(Math.max(...widths)).toBeGreaterThan(Math.min(...widths))
  })

  it("lays the dissolve over the bands' shared far end", async () => {
    const renderer = await render({ reduceMotion: true })
    const geometry = splashGeometry(Dimensions.get("window"))
    // Paint order is the whole mechanism: the dissolve covers the bands only
    // because it is drawn AFTER them. Moved above `bands.map(...)` it would
    // render underneath, go inert, and every other assertion here would pass.
    const painted = renderer.root.findAll(
      (node) =>
        Array.isArray(node.props.locations) &&
        typeof node.props.start === "object",
    )
    expect(painted).toHaveLength(RAY_BAND_COUNT + 1)
    expect(painted[painted.length - 1].props.testID).toBe("splash-ray-dissolve")

    const found = renderer.root.findAll(
      (node) => node.props.testID === "splash-ray-dissolve",
    )
    expect(found.length).toBeGreaterThan(0)
    const node = found[found.length - 1]

    // Ground colour, transparent first and fully opaque by its own far edge —
    // so the bands' ends dissolve into the page instead of cutting.
    const colors = node.props.colors as string[]
    expect(colors[0]).toBe(hexToRgba(BG_COLOR, 0))
    expect(colors[colors.length - 1]).toBe(hexToRgba(BG_COLOR, 1))
    expect(node.props.locations).toEqual([0, geometry.dissolve.stop, 1])
    expect(node.props.start).toEqual({ x: 0.5, y: 0 })
    expect(node.props.end).toEqual({ x: 0.5, y: 1 })

    const style = flatten(node.props.style)
    expect(style.left).toBeCloseTo(geometry.dissolve.left, 6)
    expect(style.top).toBeCloseTo(geometry.dissolve.top, 6)
    expect(style.width).toBeCloseTo(geometry.dissolve.width, 6)
    expect(style.height).toBeCloseTo(geometry.dissolve.height, 6)
    const transform = style.transform as Record<string, unknown>[]
    const rotate = transform.find((entry) => entry.rotate !== undefined)
    expect(rotate?.rotate).toBe(`${geometry.dissolve.angleDeg}deg`)
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
