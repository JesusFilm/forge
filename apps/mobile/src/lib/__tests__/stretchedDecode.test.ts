import { MIN_OVERSCAN, stretchedDecodeStyle } from "../stretchedDecode"

type Box = {
  position: string
  left: number
  top: number
  width: number
  height: number
  transform: { scale: number }[]
}

function box(
  frameWidth: number,
  frameHeight: number,
  shrink: number,
  pixelRatio: number,
): Box & { scale: number } {
  const style = stretchedDecodeStyle(
    frameWidth,
    frameHeight,
    shrink,
    pixelRatio,
  ) as Box
  return { ...style, scale: style.transform[0].scale }
}

// The two production sites (feat-784): the Watch ambient wash (shrink 64) and
// a Search topic card (shrink 15), on a 1080 px phone, a 480 px wide Android
// Go phone, and a tablet. Sizes are in dp.
const FRAMES = [
  ["the wash on a 1080 px phone", 1080 / 2.625, 440, 64, 2.625],
  ["the wash on a 480 px Android Go phone", 320, 400, 64, 1.5],
  ["the wash on a tablet", 800, 700, 64, 2],
  ["a topic card on a 1080 px phone", 183, 183 / 1.05, 15, 2.625],
  ["a topic card on a 480 px Android Go phone", 138, 138 / 1.05, 15, 1.5],
] as const

describe("stretchedDecodeStyle", () => {
  it.each(FRAMES)(
    "%s: a small centered box whose stretch covers the frame",
    (_name, frameWidth, frameHeight, shrink, pixelRatio) => {
      const b = box(frameWidth, frameHeight, shrink, pixelRatio)

      // Glide decodes to the view's size, so the box sets the bitmap size.
      expect(b.position).toBe("absolute")
      expect(b.width).toBeCloseTo(frameWidth / shrink)
      expect(b.height).toBeCloseTo(frameHeight / shrink)
      // The scale grows from the view's center, so the box sits at the frame's.
      expect(b.left + b.width / 2).toBeCloseTo(frameWidth / 2)
      expect(b.top + b.height / 2).toBeCloseTo(frameHeight / 2)

      // Worst rounding: the box loses one pixel and moves half a pixel. The
      // stretched box must still reach past each edge of the frame.
      const pixel = 1 / pixelRatio
      expect((b.width - pixel) * b.scale).toBeGreaterThanOrEqual(
        frameWidth + pixel,
      )
      expect((b.height - pixel) * b.scale).toBeGreaterThanOrEqual(
        frameHeight + pixel,
      )
      // Each bitmap pixel spans `scale` screen pixels, at least the planned size.
      expect(b.scale).toBeGreaterThanOrEqual(shrink * MIN_OVERSCAN)
    },
  )

  it("stretches each wash bitmap pixel over at least 70 px on a 1080 px phone", () => {
    const b = box(1080 / 2.625, 440, 64, 2.625)
    expect(b.scale).toBeCloseTo(70.4)
    // About 17 bitmap pixels across the screen.
    expect(b.width * 2.625).toBeCloseTo(1080 / 64)
  })

  it("stretches further where one rounded pixel is a large part of the box", () => {
    // Anti-vacuous: on the Android Go phone the planned 1.1 would leave a seam,
    // so the cover term, not the floor, must set the scale there.
    const b = box(320, 400, 64, 1.5)
    expect(b.scale).toBeGreaterThan(64 * MIN_OVERSCAN)
  })
})
