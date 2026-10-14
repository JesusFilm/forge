import { pauseSizes } from "../theme"
import {
  RUN_BAR_CLEARANCE,
  RUN_TOP_ROW_HEIGHT,
  runVideoLayout,
} from "../videoFrame"

/** iPhone 17: 402 x 874 points, 62 at the top, 34 at the bottom. */
const IPHONE_17 = { width: 402, height: 874, insets: { top: 62, bottom: 34 } }
/** iPhone 17 Pro Max: 440 x 956 points. */
const IPHONE_PRO_MAX = {
  width: 440,
  height: 956,
  insets: { top: 62, bottom: 34 },
}
/** iPhone SE: 375 x 667 points, 20 at the top, none at the bottom. */
const IPHONE_SE = { width: 375, height: 667, insets: { top: 20, bottom: 0 } }

function layoutOf(device: typeof IPHONE_17) {
  return runVideoLayout(device.width, device.height, device.insets)
}

// The owner, 2026-10-14: the bands above and below the picture were too
// large. The picture now fills the height, and its sides are trimmed instead.
describe("the run's video layout", () => {
  it("fills the height from the screen's top edge down to the bar", () => {
    const { frame, barTop } = layoutOf(IPHONE_17)
    expect(frame.top).toBe(0)
    expect(barTop + pauseSizes.progressBarHeight).toBe(frame.height)
  })

  it("keeps the bar's touch strip above the home indicator", () => {
    for (const device of [IPHONE_17, IPHONE_PRO_MAX, IPHONE_SE]) {
      const { barTop } = layoutOf(device)
      const stripBottom =
        barTop + pauseSizes.progressBarHeight + RUN_BAR_CLEARANCE
      expect(stripBottom).toBe(device.height - device.insets.bottom)
    }
  })

  it("keeps the video's shape and trims its sides evenly", () => {
    for (const device of [IPHONE_17, IPHONE_PRO_MAX]) {
      const { frame } = layoutOf(device)
      expect(frame.width / frame.height).toBeCloseTo(1080 / 1920, 5)
      expect(frame.width).toBeGreaterThan(device.width)
      expect(frame.left * 2 + frame.width).toBeCloseTo(device.width, 5)
    }
  })

  // The burned-in captions sit inside the middle of the frame.
  it("trims less than a tenth from each side", () => {
    for (const device of [IPHONE_17, IPHONE_PRO_MAX]) {
      const { frame } = layoutOf(device)
      expect(-frame.left / frame.width).toBeLessThan(0.1)
    }
  })

  it("trims nothing on a short phone, where the picture is narrower", () => {
    const { frame } = layoutOf(IPHONE_SE)
    expect(frame.width).toBeLessThanOrEqual(375)
    expect(frame.left).toBeGreaterThanOrEqual(0)
  })

  it("keeps the marker row below the island, over the picture, far from the bar", () => {
    const { barTop, rowTop, frame } = layoutOf(IPHONE_17)
    // Right at the safe area's edge, as the close is on the other steps.
    expect(rowTop).toBe(62)
    expect(rowTop).toBeGreaterThan(frame.top)
    expect(rowTop + RUN_TOP_ROW_HEIGHT).toBeLessThan(barTop - 200)
  })
})
