import { describe, expect, it } from "vitest"

import {
  SMART_CROP_PLANNER_VERSION,
  computeCropWindow,
  intentToKeyframes,
  type SmartCropPlannerIntent,
} from "./planner"

const HD_SOURCE = { width: 1920, height: 1080 }

function intent(
  overrides: Partial<SmartCropPlannerIntent> = {},
): SmartCropPlannerIntent {
  return {
    mode: "speaker",
    confidence: 0.9,
    subjectCenter: {
      start: { cx: 0.5, cy: 0.4 },
      end: { cx: 0.5, cy: 0.4 },
    },
    ...overrides,
  }
}

describe("smart crop planner", () => {
  it("pins the planner version literal", () => {
    expect(SMART_CROP_PLANNER_VERSION).toBe("smart-crop-planner-v1")
  })

  describe("computeCropWindow", () => {
    it("uses full source height and the largest even 9:16 width", () => {
      expect(computeCropWindow(HD_SOURCE)).toEqual({
        width: 606,
        height: 1080,
        y: 0,
      })
      expect(computeCropWindow({ width: 1280, height: 720 })).toEqual({
        width: 404,
        height: 720,
        y: 0,
      })
    })

    it("clamps the crop width to the source width and keeps it even", () => {
      expect(computeCropWindow({ width: 500, height: 1080 })).toEqual({
        width: 500,
        height: 1080,
        y: 0,
      })
      expect(computeCropWindow({ width: 501, height: 1080 })).toEqual({
        width: 500,
        height: 1080,
        y: 0,
      })
    })
  })

  describe("intentToKeyframes", () => {
    it("emits exactly two keyframes with even x clamped to the crop bounds", () => {
      const planned = intentToKeyframes(
        intent({
          mode: "action",
          subjectCenter: {
            start: { cx: 0, cy: 0.5 },
            end: { cx: 1, cy: 0.5 },
          },
        }),
        { start: 0, end: 60 },
        HD_SOURCE,
      )

      expect(planned.cropKeyframes).toHaveLength(2)
      expect(planned.cropKeyframes[0]).toEqual({
        progress: 0,
        x: 0,
        y: 0,
        width: 606,
        height: 1080,
      })
      // cx=1 clamps to source.width - cropW = 1314 (already even); pan over
      // 60s stays under the 240 px/s ceiling.
      expect(planned.cropKeyframes[1]).toEqual({
        progress: 1,
        x: 1314,
        y: 0,
        width: 606,
        height: 1080,
      })
    })

    it("falls back to a static centered crop below confidence 0.5", () => {
      const planned = intentToKeyframes(
        intent({
          confidence: 0.3,
          subjectCenter: {
            start: { cx: 0.2, cy: 0.5 },
            end: { cx: 0.8, cy: 0.5 },
          },
        }),
        { start: 0, end: 10 },
        HD_SOURCE,
      )

      expect(planned.mode).toBe("center_fallback")
      expect(planned.cropKeyframes[0].x).toBe(656)
      expect(planned.cropKeyframes[1].x).toBe(656)
    })

    it("prefers a visible face center over the broader subject center", () => {
      const planned = intentToKeyframes(
        intent({
          subjectCenter: {
            start: { cx: 0.45, cy: 0.5 },
            end: { cx: 0.45, cy: 0.5 },
          },
          faceVisible: true,
          faceCenter: {
            start: { cx: 0.75, cy: 0.22 },
            end: { cx: 0.76, cy: 0.22 },
          },
        }),
        { start: 0, end: 10 },
        HD_SOURCE,
      )

      // Face x0=1136, raw x1=1156, then dead zone collapses to static face x.
      expect(planned.cropKeyframes[0].x).toBe(1136)
      expect(planned.cropKeyframes[1].x).toBe(1136)
    })

    it("falls back to the subject center when no visible face anchor is present", () => {
      const planned = intentToKeyframes(
        intent({
          subjectCenter: {
            start: { cx: 0.5, cy: 0.5 },
            end: { cx: 0.5, cy: 0.5 },
          },
          faceVisible: false,
          faceCenter: {
            start: { cx: 0.75, cy: 0.22 },
            end: { cx: 0.75, cy: 0.22 },
          },
        }),
        { start: 0, end: 10 },
        HD_SOURCE,
      )

      expect(planned.cropKeyframes[0].x).toBe(656)
      expect(planned.cropKeyframes[1].x).toBe(656)
    })

    it("treats an explicit center_fallback intent as static centered", () => {
      const planned = intentToKeyframes(
        intent({
          mode: "center_fallback",
          confidence: 0.95,
          subjectCenter: {
            start: { cx: 0.1, cy: 0.5 },
            end: { cx: 0.9, cy: 0.5 },
          },
        }),
        { start: 0, end: 10 },
        HD_SOURCE,
      )

      expect(planned.mode).toBe("center_fallback")
      expect(planned.cropKeyframes[0].x).toBe(656)
      expect(planned.cropKeyframes[1].x).toBe(656)
    })

    it("collapses pans inside the 8% dead zone to a static crop", () => {
      const planned = intentToKeyframes(
        intent({
          subjectCenter: {
            start: { cx: 0.5, cy: 0.4 },
            end: { cx: 0.52, cy: 0.4 },
          },
        }),
        { start: 124.2, end: 139.8 },
        HD_SOURCE,
      )

      // x0=656, raw x1=694 -> |38| < 0.08 * 606 = 48.48 -> static.
      expect(planned.mode).toBe("speaker")
      expect(planned.cropKeyframes[0].x).toBe(656)
      expect(planned.cropKeyframes[1].x).toBe(656)
    })

    it("limits pan speed to 240 px/s at 1920 source width", () => {
      const planned = intentToKeyframes(
        intent({
          mode: "action",
          subjectCenter: {
            start: { cx: 0.2, cy: 0.5 },
            end: { cx: 0.8, cy: 0.5 },
          },
        }),
        { start: 10, end: 11 },
        HD_SOURCE,
      )

      // x0=80, raw x1=1232 -> 1152 px/s > 240 -> x1 = 80 + floorEven(240).
      expect(planned.cropKeyframes[0].x).toBe(80)
      expect(planned.cropKeyframes[1].x).toBe(320)
    })

    it("scales the max pan speed by source width", () => {
      const planned = intentToKeyframes(
        intent({
          mode: "action",
          subjectCenter: {
            start: { cx: 0.2, cy: 0.5 },
            end: { cx: 0.9, cy: 0.5 },
          },
        }),
        { start: 0, end: 1 },
        { width: 960, height: 540 },
      )

      // cropW=302, x0=40, raw x1 clamps to 658; maxPan = 240 * 960/1920 = 120.
      expect(planned.cropKeyframes[0].x).toBe(40)
      expect(planned.cropKeyframes[1].x).toBe(160)
    })

    it("keeps slide_aware static centered for full text safety", () => {
      const planned = intentToKeyframes(
        intent({
          mode: "slide_aware",
          confidence: 0.92,
          subjectCenter: {
            start: { cx: 0.1, cy: 0.5 },
            end: { cx: 0.9, cy: 0.5 },
          },
        }),
        { start: 0, end: 10 },
        HD_SOURCE,
      )

      expect(planned.mode).toBe("slide_aware")
      expect(planned.cropKeyframes[0].x).toBe(656)
      expect(planned.cropKeyframes[1].x).toBe(656)
    })

    it("keeps a zero-length shot static", () => {
      const planned = intentToKeyframes(
        intent({
          mode: "action",
          subjectCenter: {
            start: { cx: 0.2, cy: 0.5 },
            end: { cx: 0.8, cy: 0.5 },
          },
        }),
        { start: 10, end: 10 },
        HD_SOURCE,
      )

      expect(planned.cropKeyframes[0].x).toBe(80)
      expect(planned.cropKeyframes[1].x).toBe(80)
    })
  })
})
