import { expect, it } from "vitest"
import {
  applyTimelineWheelZoom,
  bindTimelineWheelZoom,
} from "./timeline-wheel-zoom"

class WheelGesture extends Event {
  constructor(
    public deltaY: number,
    public ctrlKey = false,
    public metaKey = false,
    public deltaMode = 0,
  ) {
    super("wheel", { cancelable: true })
  }
}
function fixture() {
  const target = Object.assign(new EventTarget(), { clientHeight: 300 })
  let zoom = 1
  const stop = bindTimelineWheelZoom(target, (factor) => {
    zoom = applyTimelineWheelZoom(zoom, factor)
  })
  return { target, stop, zoom: () => zoom }
}
it("leaves regular scrolling and zero-delta gestures alone", () => {
  const f = fixture()
  for (const event of [new WheelGesture(100), new WheelGesture(0, true)]) {
    f.target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  }
  expect(f.zoom()).toBe(1)
})
it("handles both Cmd and Ctrl with scroll up zooming in and scroll down out", () => {
  for (const [ctrl, meta] of [
    [true, false],
    [false, true],
  ]) {
    const f = fixture()
    const up = new WheelGesture(-50, ctrl, meta)
    f.target.dispatchEvent(up)
    expect(up.defaultPrevented).toBe(true)
    expect(f.zoom()).toBeGreaterThan(1)
    const down = new WheelGesture(50, ctrl, meta)
    f.target.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    expect(f.zoom()).toBeCloseTo(1)
  }
})
it("normalizes line/page deltas and bounds large wheel jumps", () => {
  const pixel = fixture(),
    line = fixture(),
    page = fixture(),
    capped = fixture()
  pixel.target.dispatchEvent(new WheelGesture(16, true))
  line.target.dispatchEvent(new WheelGesture(1, true, false, 1))
  expect(line.zoom()).toBeCloseTo(pixel.zoom())
  page.target.dispatchEvent(new WheelGesture(1, true, false, 2))
  capped.target.dispatchEvent(new WheelGesture(100, true))
  expect(page.zoom()).toBeCloseTo(capped.zoom())
})
it("respects zoom bounds and removes the gesture handler", () => {
  const f = fixture()
  expect(applyTimelineWheelZoom(3.9, 2)).toBe(4)
  expect(applyTimelineWheelZoom(0.31, 0.5)).toBe(0.3)
  f.stop()
  const event = new WheelGesture(-100, true)
  f.target.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(false)
  expect(f.zoom()).toBe(1)
})
