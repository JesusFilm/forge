import { describe, expect, it } from "vitest"
import {
  assemblePlanArtifact,
  buildSmartCropAttemptArtifactKeys,
  buildSmartCropAttemptSummary,
  buildSmartCropAttemptsArtifact,
  buildMuxOutputRecord,
  buildPlanProgressArtifact,
  buildPlanSummary,
  buildQaArtifact,
  buildQaFrameTimes,
  buildShotBatches,
  buildShotFrameUrls,
  buildTimelineMapArtifact,
  findRenderedShotIdAtTime,
  listPreviewFrameLogicalKeys,
  mergeSmartCropRepairSegments,
  parseFingerprintArtifact,
  parseMuxOutputRecord,
  parsePlanArtifact,
  parsePlanProgressArtifact,
  parseRenderReportSummary,
  parseSmartCropAttemptsArtifact,
  parseTimelineMapArtifactSummary,
  shouldRepairSmartCropQa,
  shouldEmitRenderProgress,
  shouldSkipWhenArtifactExists,
  sourceDimensionsMismatch,
  sumUsage,
  timelineMapMatchesProvenance,
  SMART_CROP_PLAN_BATCH_SIZE,
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
  faceVisible: true,
  faceCenter: {
    start: { cx: 0.72, cy: 0.24 },
    end: { cx: 0.73, cy: 0.24 },
  },
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

describe("smart crop repair attempts", () => {
  it("builds stable legacy and repair attempt keys", () => {
    expect(buildSmartCropAttemptArtifactKeys(0)).toMatchObject({
      suffix: "attempt-000",
      planLogicalKey: "smart-crop-plan-attempt-000",
      planArtifactType: "smart-crop-plan-9x16-attempt-000-v1",
      previewLogicalKey: "smart-crop-preview-attempt-000",
      qaLogicalKey: "smart-crop-qa-attempt-000",
    })
    expect(buildSmartCropAttemptArtifactKeys(1)).toMatchObject({
      planLogicalKey: "smart-crop-plan-attempt-001",
      planArtifactType: "smart-crop-plan-9x16-attempt-001-v1",
      previewLogicalKey: "smart-crop-preview-attempt-001",
      renderReportArtifactType:
        "smart-crop-render-report-9x16-preview-attempt-001",
      qaLogicalKey: "smart-crop-qa-attempt-001",
    })
  })

  it("round-trips the attempt manifest and rejects digest drift", () => {
    const attempt = buildSmartCropAttemptSummary({
      attemptIndex: 1,
      status: "complete",
      source: "repair",
      repairedFromAttemptIndex: 0,
      previewFrameLogicalKeys: [
        "smart-crop-preview-frame-9x16-001-attempt-001",
      ],
      qa: { verdict: "pass", issueCount: 1, repairTriggerCount: 1 },
      triggerIssues: [
        {
          severity: "warning",
          description: "Face is cut off",
          shotId: "shot_00421",
        },
      ],
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    })
    const manifest = buildSmartCropAttemptsArtifact({
      assetId: "asset123",
      attempts: [attempt],
      selectedAttemptIndex: 1,
      updatedAt: "2026-06-09T00:00:00.000Z",
    })

    expect(parseSmartCropAttemptsArtifact(manifest)).toMatchObject({
      assetId: "asset123",
      selectedAttemptIndex: 1,
      attempts: [expect.objectContaining({ attemptIndex: 1 })],
    })
    expect(
      parseSmartCropAttemptsArtifact({
        ...manifest,
        attempts: [{ ...attempt, status: "failed" }],
      }),
    ).toBeNull()
  })

  it("repairs only crop-affecting warnings, not report-only warnings", () => {
    expect(
      shouldRepairSmartCropQa({
        verdict: "pass",
        issues: [
          {
            severity: "warning",
            description: "Preview frame is slightly noisy",
          },
        ],
        repairAttemptCount: 0,
      }),
    ).toMatchObject({ action: "accept", reason: "report_only_issues" })

    expect(
      shouldRepairSmartCropQa({
        verdict: "pass",
        issues: [
          {
            severity: "warning",
            description: "Speaker face is cut off by the crop",
          },
        ],
        repairAttemptCount: 0,
      }),
    ).toMatchObject({ action: "repair", reason: "repair_triggering_issue" })

    expect(
      shouldRepairSmartCropQa({
        verdict: "needs_repair",
        issues: [],
        repairAttemptCount: 0,
      }),
    ).toMatchObject({ action: "repair", reason: "verdict_needs_repair" })

    expect(
      shouldRepairSmartCropQa({
        verdict: "fail",
        issues: [{ severity: "critical", description: "Subject missing" }],
        repairAttemptCount: 2,
      }),
    ).toMatchObject({ action: "fail", reason: "critical_after_max_repairs" })
  })

  it("merges repair replacements into a complete plan", () => {
    const secondSegment = {
      ...SEGMENT,
      shotId: "shot_00422",
      canonicalStart: 140,
      canonicalEnd: 150,
      cropKeyframes: [{ progress: 0, x: 300, y: 0, width: 606, height: 1080 }],
    }
    const replacement = {
      ...secondSegment,
      cropKeyframes: [{ progress: 0, x: 620, y: 0, width: 606, height: 1080 }],
    }
    const plan = assemblePlanArtifact({
      assetId: "asset123",
      muxAssetId: "mux_abc",
      playbackId: "pb_abc",
      source: { width: 1920, height: 1080, durationSeconds: 200 },
      cropMode: "auto",
      model: "m",
      segmentsFromChunks: [[SEGMENT, secondSegment]],
      usageTotals: { inputTokens: 10, outputTokens: 1 },
    })

    const merged = mergeSmartCropRepairSegments({
      previousPlan: plan,
      replacementSegments: [replacement],
      expectedShotIds: ["shot_00422"],
      model: "repair-model",
      usage: { inputTokens: 3, outputTokens: 2 },
    })

    expect(merged.segments.map((segment) => segment.shotId)).toEqual([
      "shot_00421",
      "shot_00422",
    ])
    expect(merged.segments[0]).toEqual(SEGMENT)
    expect(merged.segments[1]?.cropKeyframes[0]?.x).toBe(620)
    expect(merged.usage).toEqual({ inputTokens: 13, outputTokens: 3 })
    expect(() =>
      mergeSmartCropRepairSegments({
        previousPlan: plan,
        replacementSegments: [replacement],
        expectedShotIds: ["shot_missing"],
        model: "repair-model",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    ).toThrow("repair_segments_mismatch")
    expect(() =>
      mergeSmartCropRepairSegments({
        previousPlan: plan,
        replacementSegments: [replacement, replacement],
        expectedShotIds: ["shot_00422"],
        model: "repair-model",
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    ).toThrow("repair_segments_mismatch")
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
    const legacySegment = { ...SEGMENT }
    delete legacySegment.faceCenter
    delete legacySegment.faceVisible
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
    const legacyPlan = {
      ...plan,
      segments: [legacySegment],
    }
    expect(
      parsePlanArtifact(JSON.parse(JSON.stringify(legacyPlan))),
    ).toMatchObject({
      segments: [legacySegment],
    })
    expect(parsePlanArtifact({ ...plan, qa: { status: "maybe" } })).toBeNull()
  })

  // Deliberately extended: the summary now also surfaces the asset-pair ids
  // and provenance block so the align step's skip path can detect stale maps
  // (legacy maps report null provenance and are recomputed).
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
      canonicalAssetId: null,
      localizedAssetId: null,
      provenance: null,
    })
  })

  it("surfaces ids and provenance from a stamped timeline map", () => {
    const summary = parseTimelineMapArtifactSummary({
      version: 1,
      kind: "smart-crop-timeline-map",
      canonicalAssetId: "asset123",
      localizedAssetId: "asset456",
      provenance: {
        canonicalPlanGeneratedAt: "2026-06-09T00:00:00.000Z",
        canonicalFingerprintGeneratedAt: "2026-06-08T00:00:00.000Z",
        localizedFingerprintGeneratedAt: "2026-06-08T01:00:00.000Z",
      },
      overallConfidence: 0.97,
      unmappedDurationPercent: 1.2,
      gate: { passed: true, failures: [] },
    })

    expect(summary).toMatchObject({
      canonicalAssetId: "asset123",
      localizedAssetId: "asset456",
      provenance: {
        canonicalPlanGeneratedAt: "2026-06-09T00:00:00.000Z",
        canonicalFingerprintGeneratedAt: "2026-06-08T00:00:00.000Z",
        localizedFingerprintGeneratedAt: "2026-06-08T01:00:00.000Z",
      },
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
      renderedSegments: [
        {
          shotId: "shot_00001",
          outputStartSeconds: 0,
          outputEndSeconds: 44.2,
        },
        {
          shotId: "shot_00002",
          outputStartSeconds: 44.2,
          outputEndSeconds: 88.4,
        },
      ],
    }

    const summary = parseRenderReportSummary(report)
    expect(listPreviewFrameLogicalKeys(report)).toEqual([
      "smart-crop-preview-frame-9x16-001",
      "smart-crop-preview-frame-9x16-002",
    ])
    expect(summary?.outputDurationSeconds).toBe(88.4)
    expect(summary?.renderedShotIds).toEqual(["shot_00001", "shot_00002"])
    expect(summary ? findRenderedShotIdAtTime(summary, 10) : undefined).toBe(
      "shot_00001",
    )
    expect(summary ? findRenderedShotIdAtTime(summary, 60) : undefined).toBe(
      "shot_00002",
    )
    expect(listPreviewFrameLogicalKeys({ kind: "other" })).toEqual([])
  })

  // parsePlanArtifact validates the full contract (no pass-through casts):
  // every consumer (align, QA, full render, approve route) relies on the
  // returned fields being real.
  it("rejects plan artifacts with malformed segments or missing fields", () => {
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
    const raw = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>

    expect(parsePlanArtifact({ ...raw, usage: undefined })).toBeNull()
    expect(
      parsePlanArtifact({
        ...raw,
        segments: [{ ...SEGMENT, cropKeyframes: [] }],
      }),
    ).toBeNull()
    expect(
      parsePlanArtifact({ ...raw, segments: [{ ...SEGMENT, mode: "zoom" }] }),
    ).toBeNull()
    expect(
      parsePlanArtifact({
        ...raw,
        qa: { status: "approved" }, // approved without approvedBy/approvedAt
      }),
    ).toBeNull()
    expect(parsePlanArtifact(raw)).not.toBeNull()
  })

  it("preserves the approved qa variant fields", () => {
    const plan = assemblePlanArtifact({
      assetId: "asset123",
      muxAssetId: "mux_abc",
      playbackId: "pb_abc",
      source: { width: 1920, height: 1080, durationSeconds: 10 },
      cropMode: "auto",
      model: "m",
      segmentsFromChunks: [[SEGMENT]],
      usageTotals: { inputTokens: 1, outputTokens: 2 },
    })
    const approved = {
      ...JSON.parse(JSON.stringify(plan)),
      qa: {
        status: "approved",
        approvedBy: "vlad@example.test",
        approvedAt: "2026-06-09T00:00:00.000Z",
      },
    }

    expect(parsePlanArtifact(approved)?.qa).toEqual({
      status: "approved",
      approvedBy: "vlad@example.test",
      approvedAt: "2026-06-09T00:00:00.000Z",
    })
  })
})

describe("timelineMapMatchesProvenance", () => {
  const provenance = {
    canonicalPlanGeneratedAt: "2026-06-09T00:00:00.000Z",
    canonicalFingerprintGeneratedAt: "2026-06-08T00:00:00.000Z",
    localizedFingerprintGeneratedAt: "2026-06-08T01:00:00.000Z",
  }
  const summary = {
    overallConfidence: 0.97,
    unmappedDurationPercent: 1.2,
    gatePassed: true,
    gateFailures: [],
    canonicalAssetId: "asset123",
    localizedAssetId: "asset456",
    provenance,
  }
  const expected = {
    canonicalAssetId: "asset123",
    localizedAssetId: "asset456",
    provenance,
  }

  it("matches when ids and provenance agree", () => {
    expect(timelineMapMatchesProvenance(summary, expected)).toBe(true)
  })

  it("rejects legacy maps without provenance", () => {
    expect(
      timelineMapMatchesProvenance({ ...summary, provenance: null }, expected),
    ).toBe(false)
  })

  it("rejects regenerated canonical plans", () => {
    expect(
      timelineMapMatchesProvenance(summary, {
        ...expected,
        provenance: {
          ...provenance,
          canonicalPlanGeneratedAt: "2026-06-10T00:00:00.000Z",
        },
      }),
    ).toBe(false)
  })

  it("rejects a different asset pair", () => {
    expect(
      timelineMapMatchesProvenance(summary, {
        ...expected,
        canonicalAssetId: "asset999",
      }),
    ).toBe(false)
  })
})

describe("sourceDimensionsMismatch", () => {
  it("returns null when dimensions match exactly", () => {
    expect(
      sourceDimensionsMismatch(
        { width: 1920, height: 1080, durationSeconds: 100 },
        { width: 1920, height: 1080, durationSeconds: 101.5 },
      ),
    ).toBeNull()
  })

  it("returns an actionable message on any width/height difference", () => {
    expect(
      sourceDimensionsMismatch(
        { width: 1920, height: 1080, durationSeconds: 100 },
        { width: 1280, height: 720, durationSeconds: 100 },
      ),
    ).toBe("canonical 1920x1080 != localized 1280x720")
  })
})

describe("plan progress checkpoint", () => {
  const expected = {
    fingerprintGeneratedAt: "2026-06-09T00:00:00.000Z",
    batchSize: SMART_CROP_PLAN_BATCH_SIZE,
    totalBatches: 3,
  }

  function buildCheckpoint() {
    return buildPlanProgressArtifact({
      fingerprintGeneratedAt: expected.fingerprintGeneratedAt,
      batchSize: expected.batchSize,
      totalBatches: expected.totalBatches,
      completedBatches: 2,
      segments: [SEGMENT],
      usage: { inputTokens: 100, outputTokens: 10 },
      model: "qwen/qwen2.5-vl-72b-instruct",
    })
  }

  it("round-trips a checkpoint matching the current fingerprint", () => {
    const parsed = parsePlanProgressArtifact(
      JSON.parse(JSON.stringify(buildCheckpoint())),
      expected,
    )
    expect(parsed).toMatchObject({
      completedBatches: 2,
      usage: { inputTokens: 100, outputTokens: 10 },
      model: "qwen/qwen2.5-vl-72b-instruct",
    })
    expect(parsed?.segments).toHaveLength(1)
  })

  it("rejects a checkpoint from a regenerated fingerprint", () => {
    expect(
      parsePlanProgressArtifact(buildCheckpoint(), {
        ...expected,
        fingerprintGeneratedAt: "2026-06-10T00:00:00.000Z",
      }),
    ).toBeNull()
  })

  it("rejects a checkpoint with a different batching shape", () => {
    expect(
      parsePlanProgressArtifact(buildCheckpoint(), {
        ...expected,
        totalBatches: 5,
      }),
    ).toBeNull()
    expect(
      parsePlanProgressArtifact(buildCheckpoint(), {
        ...expected,
        batchSize: 4,
      }),
    ).toBeNull()
  })

  it("rejects malformed or out-of-range checkpoints", () => {
    expect(parsePlanProgressArtifact(null, expected)).toBeNull()
    expect(parsePlanProgressArtifact({ kind: "other" }, expected)).toBeNull()
    expect(
      parsePlanProgressArtifact(
        { ...buildCheckpoint(), completedBatches: 9 },
        expected,
      ),
    ).toBeNull()
    expect(
      parsePlanProgressArtifact(
        { ...buildCheckpoint(), segments: [{ shotId: 42 }] },
        expected,
      ),
    ).toBeNull()
  })
})

describe("mux output record", () => {
  it("round-trips the pending and ready record shapes", () => {
    const pending = buildMuxOutputRecord({
      jobId: "job-1",
      muxAssetId: "mux_out_1",
      ready: false,
      createdAt: "2026-06-09T00:00:00.000Z",
    })
    expect(parseMuxOutputRecord(JSON.parse(JSON.stringify(pending)))).toEqual({
      version: 1,
      kind: "smart-crop-mux-output",
      jobId: "job-1",
      muxAssetId: "mux_out_1",
      ready: false,
      playbackId: undefined,
      createdAt: "2026-06-09T00:00:00.000Z",
    })

    const ready = buildMuxOutputRecord({
      jobId: "job-1",
      muxAssetId: "mux_out_1",
      ready: true,
      playbackId: "pb_out_1",
      createdAt: "2026-06-09T00:00:00.000Z",
    })
    expect(
      parseMuxOutputRecord(JSON.parse(JSON.stringify(ready))),
    ).toMatchObject({ ready: true, playbackId: "pb_out_1" })
  })

  it("rejects malformed records", () => {
    expect(parseMuxOutputRecord(null)).toBeNull()
    expect(parseMuxOutputRecord({ kind: "smart-crop-mux-output" })).toBeNull()
  })
})

describe("shouldEmitRenderProgress", () => {
  it("emits the first snapshot with any signal", () => {
    expect(
      shouldEmitRenderProgress(null, { progress: 0.01, message: null }),
    ).toBe(true)
    expect(
      shouldEmitRenderProgress(null, { progress: null, message: "Starting" }),
    ).toBe(true)
    expect(
      shouldEmitRenderProgress(null, { progress: null, message: null }),
    ).toBe(false)
  })

  it("throttles small progress advances", () => {
    const last = { progress: 0.5, message: "Rendering segment 5 of 10" }
    expect(
      shouldEmitRenderProgress(last, {
        progress: 0.52,
        message: "Rendering segment 5 of 10",
      }),
    ).toBe(false)
    expect(
      shouldEmitRenderProgress(last, {
        progress: 0.55,
        message: "Rendering segment 5 of 10",
      }),
    ).toBe(true)
  })

  it("emits on message change even without progress movement", () => {
    const last = { progress: 0.5, message: "Rendering segment 5 of 10" }
    expect(
      shouldEmitRenderProgress(last, {
        progress: 0.5,
        message: "Rendering segment 6 of 10",
      }),
    ).toBe(true)
  })
})
