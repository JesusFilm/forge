import { describe, expect, it } from "vitest"
import {
  assemblePlanArtifact,
  buildPlanSummary,
  buildQaArtifact,
  buildQaFrameTimes,
  buildShotBatches,
  buildShotFrameUrls,
  buildTimelineMapArtifact,
  listPreviewFrameLogicalKeys,
  parseFingerprintArtifact,
  parsePlanArtifact,
  parseRenderReportSummary,
  parseTimelineMapArtifactSummary,
  shouldSkipWhenArtifactExists,
  sumUsage,
} from "@/services/smartCrop"
import type { SmartCropPlanSegment } from "@/services/mastra-smart-crop"

const SEGMENT: SmartCropPlanSegment = {
  shotId: "shot_00421",
  canonicalStart: 124.2,
  canonicalEnd: 139.8,
  mode: "group",
  primarySubject: "Jesus",
  secondarySubjects: ["disciples"],
  avoidCutting: ["faces"],
  confidence: 0.94,
  cropKeyframes: [
    { progress: 0, x: 520, y: 0, width: 606, height: 1080 },
    { progress: 1, x: 560, y: 0, width: 606, height: 1080 },
  ],
}

describe("shouldSkipWhenArtifactExists", () => {
  it("skips only when the artifact exists and force is not set", () => {
    expect(shouldSkipWhenArtifactExists(true, false)).toBe(true)
    expect(shouldSkipWhenArtifactExists(true, undefined)).toBe(true)
    expect(shouldSkipWhenArtifactExists(true, true)).toBe(false)
    expect(shouldSkipWhenArtifactExists(false, false)).toBe(false)
    expect(shouldSkipWhenArtifactExists(false, true)).toBe(false)
  })
})

describe("buildShotBatches", () => {
  it("chunks shots into batches of 8 by default", () => {
    const shots = Array.from({ length: 19 }, (_, index) => index)
    const batches = buildShotBatches(shots)
    expect(batches.map((batch) => batch.length)).toEqual([8, 8, 3])
    expect(batches.flat()).toEqual(shots)
  })

  it("returns no batches for an empty shot list", () => {
    expect(buildShotBatches([])).toEqual([])
  })
})

describe("buildShotFrameUrls", () => {
  it("samples 3 frames at 10/50/90 percent of the shot", () => {
    const urls = buildShotFrameUrls("pb_abc", { start: 100, end: 200 })
    expect(urls).toEqual([
      "https://image.mux.com/pb_abc/thumbnail.webp?width=768&time=110",
      "https://image.mux.com/pb_abc/thumbnail.webp?width=768&time=150",
      "https://image.mux.com/pb_abc/thumbnail.webp?width=768&time=190",
    ])
  })

  it("keeps time=0 in the query (falsy-zero guard)", () => {
    const urls = buildShotFrameUrls("pb_abc", { start: 0, end: 0 })
    expect(urls).toEqual([
      "https://image.mux.com/pb_abc/thumbnail.webp?width=768&time=0",
    ])
  })

  it("dedupes rounded times for very short shots", () => {
    const urls = buildShotFrameUrls("pb_abc", { start: 10, end: 10.4 })
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("time=10")
  })
})

describe("assemblePlanArtifact", () => {
  it("assembles the canonical plan wire contract with qa draft", () => {
    const plan = assemblePlanArtifact({
      assetId: "asset123",
      muxAssetId: "mux_abc",
      playbackId: "pb_abc",
      source: { width: 1920, height: 1080, durationSeconds: 7200.04 },
      cropMode: "auto",
      model: "qwen/qwen2.5-vl-72b-instruct",
      segmentsFromChunks: [[SEGMENT], [SEGMENT]],
      usageTotals: { inputTokens: 100, outputTokens: 20 },
      generatedAt: "2026-06-09T00:00:00.000Z",
    })

    expect(plan).toEqual({
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
      segments: [SEGMENT, SEGMENT],
      usage: { inputTokens: 100, outputTokens: 20 },
      qa: { status: "draft" },
      generatedAt: "2026-06-09T00:00:00.000Z",
    })
  })
})

describe("buildTimelineMapArtifact", () => {
  it("wraps the mastra timeline map with ids/version/kind", () => {
    const payload = {
      mappingMethod: "shot-sequence" as const,
      overallConfidence: 0.97,
      unmappedDurationPercent: 1.8,
      maxConsecutiveUnmappedSeconds: 4.2,
      segments: [],
      gate: { passed: true, failures: [], config: {} },
      warnings: [],
    }
    const artifact = buildTimelineMapArtifact(
      payload,
      { canonicalAssetId: "asset123", localizedAssetId: "asset456" },
      "uk",
      "2026-06-09T00:00:00.000Z",
    )

    expect(artifact).toMatchObject({
      version: 1,
      kind: "smart-crop-timeline-map",
      canonicalAssetId: "asset123",
      localizedAssetId: "asset456",
      language: "uk",
      mappingMethod: "shot-sequence",
      overallConfidence: 0.97,
      generatedAt: "2026-06-09T00:00:00.000Z",
    })
  })
})

describe("buildQaArtifact", () => {
  it("builds the QA report wire contract", () => {
    const artifact = buildQaArtifact({
      assetId: "asset123",
      renderMode: "preview",
      verdict: "needs_repair",
      issues: [
        { severity: "warning", description: "off-center", atSeconds: 4 },
      ],
      frameCount: 6,
      model: "google/gemini-2.5-flash",
      usage: { inputTokens: 900, outputTokens: 120 },
      generatedAt: "2026-06-09T00:00:00.000Z",
    })

    expect(artifact).toEqual({
      version: 1,
      kind: "smart-crop-qa-report",
      assetId: "asset123",
      renderMode: "preview",
      verdict: "needs_repair",
      issues: [
        { severity: "warning", description: "off-center", atSeconds: 4 },
      ],
      frameCount: 6,
      model: "google/gemini-2.5-flash",
      usage: { inputTokens: 900, outputTokens: 120 },
      generatedAt: "2026-06-09T00:00:00.000Z",
    })
  })
})

describe("sumUsage / buildPlanSummary / buildQaFrameTimes", () => {
  it("sums usage across chunks", () => {
    expect(
      sumUsage([
        { inputTokens: 10, outputTokens: 1 },
        { inputTokens: 20, outputTokens: 2 },
      ]),
    ).toEqual({ inputTokens: 30, outputTokens: 3 })
    expect(sumUsage([])).toEqual({ inputTokens: 0, outputTokens: 0 })
  })

  it("summarizes plan segment modes", () => {
    const plan = assemblePlanArtifact({
      assetId: "asset123",
      muxAssetId: "mux_abc",
      playbackId: "pb_abc",
      source: { width: 1920, height: 1080, durationSeconds: 10 },
      cropMode: "auto",
      model: "m",
      segmentsFromChunks: [
        [SEGMENT, { ...SEGMENT, shotId: "shot_00422", mode: "speaker" }],
      ],
      usageTotals: { inputTokens: 0, outputTokens: 0 },
    })

    expect(buildPlanSummary(plan)).toEqual({
      segmentCount: 2,
      modes: { group: 1, speaker: 1 },
    })
  })

  it("spreads QA frame times across the preview duration", () => {
    expect(buildQaFrameTimes(60, 3)).toEqual([10, 30, 50])
    expect(buildQaFrameTimes(null, 2)).toEqual([1, 2])
    expect(buildQaFrameTimes(60, 0)).toEqual([])
  })
})

describe("artifact readers", () => {
  it("parses a fingerprint artifact with representative hashes", () => {
    const fingerprint = parseFingerprintArtifact({
      version: 1,
      kind: "smart-crop-fingerprint",
      assetId: "asset123",
      source: { width: 1920, height: 1080, durationSeconds: 7200.04 },
      sampling: { hashFps: 1, hashSize: 8, sceneThreshold: 0.3 },
      shots: [
        {
          shotId: "shot_00001",
          start: 0,
          end: 12.48,
          representativeHashes: [{ time: 6.0, dhash: "9fc8a1b2c3d4e5f6" }],
        },
      ],
      tool: "crop-worker-fingerprint-v1",
      generatedAt: "2026-06-09T00:00:00.000Z",
    })

    expect(fingerprint?.shots).toHaveLength(1)
    expect(fingerprint?.shots[0]).toMatchObject({
      shotId: "shot_00001",
      start: 0,
      end: 12.48,
    })
    expect(fingerprint?.source.durationSeconds).toBe(7200.04)
  })

  it("rejects a fingerprint artifact with the wrong kind", () => {
    expect(
      parseFingerprintArtifact({ kind: "scene-analysis", shots: [] }),
    ).toBeNull()
  })

  it("parses plan artifacts and rejects malformed qa blocks", () => {
    const plan = assemblePlanArtifact({
      assetId: "asset123",
      muxAssetId: "mux_abc",
      playbackId: "pb_abc",
      source: { width: 1920, height: 1080, durationSeconds: 10 },
      cropMode: "auto",
      model: "m",
      segmentsFromChunks: [[SEGMENT]],
      usageTotals: { inputTokens: 0, outputTokens: 0 },
    })

    expect(parsePlanArtifact(JSON.parse(JSON.stringify(plan)))).toMatchObject({
      kind: "smart-crop-canonical-plan",
      qa: { status: "draft" },
    })
    expect(parsePlanArtifact({ ...plan, qa: { status: "maybe" } })).toBeNull()
  })

  it("summarizes timeline-map artifacts", () => {
    expect(
      parseTimelineMapArtifactSummary({
        version: 1,
        kind: "smart-crop-timeline-map",
        overallConfidence: 0.91,
        unmappedDurationPercent: 6.5,
        gate: { passed: false, failures: ["unmapped duration 6.5% > 5%"] },
      }),
    ).toEqual({
      overallConfidence: 0.91,
      unmappedDurationPercent: 6.5,
      gatePassed: false,
      gateFailures: ["unmapped duration 6.5% > 5%"],
    })
  })

  it("lists preview frame logical keys from the render report", () => {
    const report = {
      version: 1,
      kind: "smart-crop-render-report",
      assetId: "asset123",
      mode: "preview",
      previewFrameArtifactTypes: [
        "smart-crop-preview-frame-9x16-001",
        "smart-crop-preview-frame-9x16-002",
        "unexpected-key",
      ],
      outputDurationSeconds: 88.4,
    }

    expect(listPreviewFrameLogicalKeys(report)).toEqual([
      "smart-crop-preview-frame-9x16-001",
      "smart-crop-preview-frame-9x16-002",
    ])
    expect(parseRenderReportSummary(report)?.outputDurationSeconds).toBe(88.4)
    expect(listPreviewFrameLogicalKeys({ kind: "other" })).toEqual([])
  })
})
