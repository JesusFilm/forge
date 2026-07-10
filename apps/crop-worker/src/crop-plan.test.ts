import { describe, expect, it } from "vitest"
import {
  cropPlanArtifactTypeSchema,
  parseCropPlan,
  parseTimelineMap,
  remapSegments,
  renderArtifactSuffixSchema,
  samplePreviewSegments,
  type CropPlan,
  type TimelineMap,
} from "./crop-plan.js"
import type { RenderSegment } from "./types.js"

function buildPlan(overrides: Partial<CropPlan> = {}): CropPlan {
  return parseCropPlan({
    version: 1,
    kind: "smart-crop-canonical-plan",
    assetId: "asset123",
    muxAssetId: "mux_abc",
    playbackId: "pb_abc",
    source: { width: 1920, height: 1080, durationSeconds: 7200.04 },
    target: { aspectRatio: "9:16", width: 1080, height: 1920 },
    strategy: {
      cropMode: "auto",
      plannerVersion: "smart-crop-planner-v1",
      model: "qwen/qwen2.5-vl-72b-instruct",
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
          { progress: 1, x: 560, y: 0, width: 606, height: 1080 },
        ],
      },
      {
        shotId: "shot_00002",
        canonicalStart: 10,
        canonicalEnd: 25,
        mode: "group",
        confidence: 0.9,
        cropKeyframes: [
          { progress: 0, x: 100, y: 0, width: 606, height: 1080 },
          { progress: 1, x: 100, y: 0, width: 606, height: 1080 },
        ],
      },
    ],
    usage: { inputTokens: 0, outputTokens: 0 },
    qa: { status: "draft" },
    generatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  })
}

function buildTimelineMap(
  segments: TimelineMap["segments"],
  overrides: Partial<TimelineMap> = {},
): TimelineMap {
  return parseTimelineMap({
    version: 1,
    kind: "smart-crop-timeline-map",
    canonicalAssetId: "asset123",
    localizedAssetId: "asset456",
    language: "uk",
    mappingMethod: "shot-sequence",
    overallConfidence: 0.97,
    unmappedDurationPercent: 1.8,
    maxConsecutiveUnmappedSeconds: 4.2,
    segments,
    gate: { passed: true, failures: [] },
    warnings: [],
    generatedAt: "2026-06-09T00:00:00.000Z",
    ...overrides,
  })
}

describe("parseCropPlan", () => {
  it("accepts the documented shape and tolerates extra fields", () => {
    const plan = buildPlan({
      futureField: "tolerated",
    } as unknown as Partial<CropPlan>)
    expect(plan.kind).toBe("smart-crop-canonical-plan")
    expect(plan.segments).toHaveLength(2)
  })

  it("rejects a wrong kind literal", () => {
    expect(() =>
      buildPlan({ kind: "smart-crop-plan" } as unknown as Partial<CropPlan>),
    ).toThrow()
  })

  it("rejects an unknown segment mode", () => {
    expect(() =>
      parseCropPlan({
        ...buildPlan(),
        segments: [
          {
            shotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 10,
            mode: "freestyle",
            confidence: 0.9,
            cropKeyframes: [
              { progress: 0, x: 0, y: 0, width: 606, height: 1080 },
            ],
          },
        ],
      }),
    ).toThrow()
  })
})

describe("attempt artifact validators", () => {
  it("accepts the legacy plan artifact type and three-digit attempt plan types", () => {
    expect(cropPlanArtifactTypeSchema.parse("smart-crop-plan-9x16-v1")).toBe(
      "smart-crop-plan-9x16-v1",
    )
    expect(
      cropPlanArtifactTypeSchema.parse("smart-crop-plan-9x16-attempt-001-v1"),
    ).toBe("smart-crop-plan-9x16-attempt-001-v1")
  })

  it("rejects malformed attempt plan artifact types", () => {
    expect(() =>
      cropPlanArtifactTypeSchema.parse("smart-crop-plan-9x16-attempt-1-v1"),
    ).toThrow()
    expect(() =>
      cropPlanArtifactTypeSchema.parse("smart-crop-plan-9x16-attempt-001"),
    ).toThrow()
  })

  it("accepts only three-digit render artifact suffixes", () => {
    expect(renderArtifactSuffixSchema.parse("attempt-001")).toBe("attempt-001")
    expect(() => renderArtifactSuffixSchema.parse("attempt-1")).toThrow()
    expect(() => renderArtifactSuffixSchema.parse("preview-001")).toThrow()
  })
})

describe("parseTimelineMap", () => {
  it("accepts the documented shape", () => {
    const map = buildTimelineMap([
      {
        canonicalShotId: "shot_00001",
        canonicalStart: 0,
        canonicalEnd: 10,
        localizedStart: 1,
        localizedEnd: 11.5,
        confidence: 0.98,
      },
    ])
    expect(map.mappingMethod).toBe("shot-sequence")
  })

  it("rejects an unknown mapping method", () => {
    expect(() =>
      buildTimelineMap([], {
        mappingMethod: "dtw",
      } as unknown as Partial<TimelineMap>),
    ).toThrow()
  })
})

describe("remapSegments", () => {
  it("uses canonical times when no timeline map is provided", () => {
    const { segments, warnings } = remapSegments(buildPlan(), null)

    expect(warnings).toEqual([])
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({
      shotId: "shot_00001",
      start: 0,
      end: 10,
      durationSeconds: 10,
    })
    expect(segments[0]!.keyframes).toEqual([
      { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
      { progress: 1, x: 560, y: 0, width: 606, height: 1080 },
    ])
  })

  it("uses localized times from the timeline map keyed by canonicalShotId", () => {
    const map = buildTimelineMap([
      {
        canonicalShotId: "shot_00001",
        canonicalStart: 0,
        canonicalEnd: 10,
        localizedStart: 2,
        localizedEnd: 13.5,
        confidence: 0.98,
      },
      {
        canonicalShotId: "shot_00002",
        canonicalStart: 10,
        canonicalEnd: 25,
        localizedStart: 13.5,
        localizedEnd: 30,
        confidence: 0.95,
      },
    ])

    const { segments, warnings } = remapSegments(buildPlan(), map)

    expect(warnings).toEqual([])
    expect(segments.map((segment) => [segment.start, segment.end])).toEqual([
      [2, 13.5],
      [13.5, 30],
    ])
  })

  it("skips unmapped shots and collects a warning", () => {
    const map = buildTimelineMap([
      {
        canonicalShotId: "shot_00002",
        canonicalStart: 10,
        canonicalEnd: 25,
        localizedStart: 13.5,
        localizedEnd: 30,
        confidence: 0.95,
      },
    ])

    const { segments, warnings } = remapSegments(buildPlan(), map)

    expect(segments.map((segment) => segment.shotId)).toEqual(["shot_00002"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("unmapped shot shot_00001")
  })

  it("drops zero/negative-duration segments with a warning", () => {
    const map = buildTimelineMap([
      {
        canonicalShotId: "shot_00001",
        canonicalStart: 0,
        canonicalEnd: 10,
        localizedStart: 5,
        localizedEnd: 5,
        confidence: 0.9,
      },
      {
        canonicalShotId: "shot_00002",
        canonicalStart: 10,
        canonicalEnd: 25,
        localizedStart: 13.5,
        localizedEnd: 30,
        confidence: 0.95,
      },
    ])

    const { segments, warnings } = remapSegments(buildPlan(), map)

    expect(segments.map((segment) => segment.shotId)).toEqual(["shot_00002"])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("shot_00001")
    expect(warnings[0]).toContain("non-positive duration")
  })
})

describe("samplePreviewSegments", () => {
  function segment(index: number, durationSeconds = 10): RenderSegment {
    return {
      shotId: `shot_${String(index + 1).padStart(5, "0")}`,
      start: index * durationSeconds,
      end: index * durationSeconds + durationSeconds,
      durationSeconds,
      keyframes: [{ progress: 0, x: 0, y: 0, width: 606, height: 1080 }],
    }
  }

  it("returns all segments when under the cap", () => {
    const segments = [segment(0), segment(1)]
    expect(
      samplePreviewSegments(segments, { maxSegments: 6, maxSeconds: 90 }),
    ).toEqual(segments)
  })

  it("samples evenly across the list, always including the first segment", () => {
    const segments = Array.from({ length: 12 }, (_, index) => segment(index, 1))
    const sampled = samplePreviewSegments(segments, {
      maxSegments: 6,
      maxSeconds: 90,
    })

    expect(sampled).toHaveLength(6)
    expect(sampled[0]!.shotId).toBe("shot_00001")
    expect(sampled.map((entry) => entry.shotId)).toEqual([
      "shot_00001",
      "shot_00003",
      "shot_00005",
      "shot_00007",
      "shot_00009",
      "shot_00011",
    ])
  })

  it("caps the summed duration, truncating the last included segment", () => {
    const segments = [segment(0, 40), segment(1, 40), segment(2, 40)]
    const sampled = samplePreviewSegments(segments, {
      maxSegments: 6,
      maxSeconds: 90,
    })

    expect(sampled).toHaveLength(3)
    expect(sampled[2]!.durationSeconds).toBe(10)
    expect(sampled[2]!.end).toBe(sampled[2]!.start + 10)
    expect(sampled.reduce((sum, entry) => sum + entry.durationSeconds, 0)).toBe(
      90,
    )
  })

  it("drops a segment entirely when the remaining budget is negligible", () => {
    const segments = [segment(0, 90), segment(1, 40)]
    const sampled = samplePreviewSegments(segments, {
      maxSegments: 6,
      maxSeconds: 90,
    })

    expect(sampled).toHaveLength(1)
  })

  it("returns an empty list for no segments", () => {
    expect(
      samplePreviewSegments([], { maxSegments: 6, maxSeconds: 90 }),
    ).toEqual([])
  })
})
