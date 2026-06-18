import { describe, expect, it } from "vitest"

import {
  buildSmartCropQaMarkers,
  buildSmartCropBoxPercent,
  clampSmartCropBoxPercent,
  findActiveSmartCropSegment,
  formatSmartCropTime,
  interpolateSmartCropKeyframe,
  isSmartCropAttemptSelectableForReview,
  parseSmartCropQaIssuesForPlayer,
  parseSmartCropPlanForPlayer,
  type SmartCropPlanForPlayer,
} from "./smart-crop-plan-player"

const plan: SmartCropPlanForPlayer = {
  playbackId: "pb_123",
  source: {
    width: 1920,
    height: 1080,
    durationSeconds: 20,
  },
  segments: [
    {
      shotId: "shot_00001",
      canonicalStart: 0,
      canonicalEnd: 10,
      mode: "speaker",
      primarySubject: "Jesus",
      confidence: 0.94,
      cropKeyframes: [
        { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
        { progress: 1, x: 620, y: 0, width: 606, height: 1080 },
      ],
    },
    {
      shotId: "shot_00002",
      canonicalStart: 10,
      canonicalEnd: 20,
      mode: "group",
      primarySubject: "disciples",
      confidence: 0.8,
      cropKeyframes: [
        { progress: 0, x: 100, y: 0, width: 606, height: 1080 },
        { progress: 0.5, x: 300, y: 0, width: 606, height: 1080 },
        { progress: 1, x: 500, y: 0, width: 606, height: 1080 },
      ],
    },
  ],
}

describe("smart crop plan player helpers", () => {
  it("parses the plan fields needed by the original crop guide", () => {
    const parsed = parseSmartCropPlanForPlayer({
      kind: "smart-crop-canonical-plan",
      playbackId: "pb_123",
      source: { width: 1920, height: 1080, durationSeconds: 20 },
      segments: [
        {
          shotId: "shot_00001",
          canonicalStart: 0,
          canonicalEnd: 10,
          mode: "speaker",
          primarySubject: "Jesus",
          confidence: 0.94,
          cropKeyframes: [
            { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
          ],
        },
      ],
    })

    expect(parsed).toMatchObject({
      playbackId: "pb_123",
      source: { width: 1920, height: 1080, durationSeconds: 20 },
      segments: [
        {
          shotId: "shot_00001",
          mode: "speaker",
          primarySubject: "Jesus",
        },
      ],
    })
  })

  it("rejects malformed plans instead of guessing at missing playback data", () => {
    expect(
      parseSmartCropPlanForPlayer({
        source: { width: 1920, height: 1080, durationSeconds: 20 },
        segments: plan.segments,
      }),
    ).toBeNull()
  })

  it("rejects segments without a usable crop keyframe", () => {
    expect(
      parseSmartCropPlanForPlayer({
        playbackId: "pb_123",
        source: { width: 1920, height: 1080, durationSeconds: 20 },
        segments: [
          {
            shotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 10,
            mode: "speaker",
            cropKeyframes: [
              { progress: 0, x: 520, y: 0, width: -606, height: 1080 },
            ],
          },
        ],
      }),
    ).toBeNull()
  })

  it("finds the active shot and interpolates the crop keyframe", () => {
    const active = findActiveSmartCropSegment(plan.segments, 5)

    expect(active?.shotId).toBe("shot_00001")
    expect(interpolateSmartCropKeyframe(active!, 5)).toMatchObject({
      progress: 0.5,
      x: 570,
      y: 0,
      width: 606,
      height: 1080,
    })
  })

  it("honors piecewise keyframe progress values", () => {
    const active = findActiveSmartCropSegment(plan.segments, 12.5)

    expect(active?.shotId).toBe("shot_00002")
    expect(interpolateSmartCropKeyframe(active!, 12.5)?.x).toBe(200)
  })

  it("projects the crop box into source-video percentages", () => {
    expect(
      buildSmartCropBoxPercent(
        { progress: 0, x: 480, y: 0, width: 960, height: 1080 },
        plan.source,
      ),
    ).toEqual({
      left: 25,
      top: 0,
      width: 50,
      height: 100,
    })
  })

  it("clamps crop box percentages to the visible source frame", () => {
    expect(
      clampSmartCropBoxPercent({
        left: 90,
        top: -10,
        width: 30,
        height: 120,
      }),
    ).toEqual({
      left: 90,
      top: 0,
      width: 10,
      height: 100,
    })
  })

  it("formats timeline labels without leaking decimals", () => {
    expect(formatSmartCropTime(65.8)).toBe("1:05")
  })

  it("only treats review-ready attempts as selectable for approval", () => {
    expect(isSmartCropAttemptSelectableForReview("complete")).toBe(true)
    expect(isSmartCropAttemptSelectableForReview("qa_unavailable")).toBe(true)
    expect(isSmartCropAttemptSelectableForReview("approved")).toBe(true)
    expect(isSmartCropAttemptSelectableForReview("planned")).toBe(false)
    expect(isSmartCropAttemptSelectableForReview("previewed")).toBe(false)
    expect(isSmartCropAttemptSelectableForReview("failed")).toBe(false)
  })

  it("parses QA report issues for the player overlay", () => {
    expect(
      parseSmartCropQaIssuesForPlayer({
        kind: "smart-crop-qa-report",
        issues: [
          {
            severity: "info",
            description: "Crop is acceptable but a little tight.",
            atSeconds: 4.5,
            shotId: "shot_00001",
          },
          { severity: "debug", description: "ignored" },
          { severity: "critical" },
        ],
      }),
    ).toEqual([
      {
        severity: "info",
        description: "Crop is acceptable but a little tight.",
        atSeconds: 4.5,
        shotId: "shot_00001",
      },
    ])
  })

  it("places QA markers by timestamp or shot midpoint", () => {
    const markers = buildSmartCropQaMarkers(
      plan.segments,
      [
        {
          severity: "info",
          description: "Shot note",
          shotId: "shot_00001",
        },
        {
          severity: "warning",
          description: "Frame warning",
          atSeconds: 12,
          shotId: "shot_00002",
        },
        {
          severity: "critical",
          description: "Global issue without placement",
        },
      ],
      plan.source.durationSeconds,
    )

    expect(markers).toHaveLength(2)
    expect(markers[0]).toMatchObject({
      severity: "info",
      seconds: 5,
      percent: 25,
      shotId: "shot_00001",
      segment: { shotId: "shot_00001" },
    })
    expect(markers[1]).toMatchObject({
      severity: "warning",
      seconds: 12,
      percent: 60,
      shotId: "shot_00002",
      segment: { shotId: "shot_00002" },
    })
  })
})
