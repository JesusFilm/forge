import { expect, it } from "vitest"
import { timelineZoomPresets } from "./timeline-zoom"
import { timelineScale } from "./timeline-scale"
import { applyTimelineWheelZoom } from "./timeline-wheel-zoom"
it.each([300, 3000, 36000])(
  "fits the entire %i-frame edit to the viewport",
  (frames) => {
    const presets = timelineZoomPresets(frames, 30, 1000)
    const scale = timelineScale(frames, 30, presets.fit, 1000)
    expect(scale.width).toBeCloseTo(1000)
    expect(scale.px * frames).toBeCloseTo(1000)
  },
)
it("shows ten seconds in detail and keeps short projects fitted", () => {
  const presets = timelineZoomPresets(3000, 30, 1000)
  expect(timelineScale(3000, 30, presets.detail, 1000).px * 300).toBeCloseTo(
    1000,
  )
  const short = timelineZoomPresets(150, 30, 1000)
  expect(short.detail).toBe(short.fit)
})
it("keeps custom zoom bounded and continuous when leaving a preset", () => {
  const presets = timelineZoomPresets(36000, 30, 1000)
  expect(
    applyTimelineWheelZoom(presets.fit, 1.1, presets.min, presets.max),
  ).toBeCloseTo(presets.fit * 1.1)
  expect(timelineScale(36000, 30, presets.max, 1000).width).toBe(20000)
  expect(
    applyTimelineWheelZoom(presets.min, 0.1, presets.min, presets.max),
  ).toBe(presets.min)
})
