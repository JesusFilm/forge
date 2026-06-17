import { describe, expect, it, vi } from "vitest"
import {
  launchSmartCropAlign,
  launchSmartCropPlan,
  launchSmartCropQa,
  launchSmartCropRepair,
} from "@/services/mastra-smart-crop"

const CLIENT = { baseUrl: "https://mastra.internal", bearer: "secret" }

// Producer literals copied from the plan doc (docs/plans/2026-06-09-002):
// the segment shape is identical to the canonical plan `segments[]` entries.
const planSegment = {
  shotId: "shot_00421",
  canonicalStart: 124.2,
  canonicalEnd: 139.8,
  mode: "group" as const,
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

const planInput = {
  asset: { assetId: "asset123", playbackId: "pb_abc" },
  source: { width: 1920, height: 1080, durationSeconds: 7200 },
  target: { aspectRatio: "9:16" as const, width: 1080, height: 1920 },
  cropMode: "auto",
  shots: [
    {
      shotId: "shot_00421",
      start: 124.2,
      end: 139.8,
      frameUrls: ["https://image.mux.com/pb_abc/thumbnail.webp?width=768"],
    },
  ],
  model: "qwen/qwen2.5-vl-72b-instruct",
}

describe("launchSmartCropPlan", () => {
  it("returns config_missing when service configuration is absent", async () => {
    await expect(launchSmartCropPlan(planInput)).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
  })

  it("posts to /forge-smart-crop-plan and parses the success literals", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({
          result: {
            ok: true,
            segments: [planSegment],
            usage: { inputTokens: 1200, outputTokens: 340 },
            model: "qwen/qwen2.5-vl-72b-instruct",
          },
        }),
    )

    await expect(
      launchSmartCropPlan(planInput, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      segments: [planSegment],
      usage: { inputTokens: 1200, outputTokens: 340 },
      model: "qwen/qwen2.5-vl-72b-instruct",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-smart-crop-plan"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    )
    const body = JSON.parse(
      String(fetchImpl.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>
    expect(body).toEqual(planInput)
  })

  it("parses the mastra failure shape with its retryable flag", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          result: {
            ok: false,
            reason: "frame_host_not_allowed",
            retryable: false,
            message: "Frame URL host evil.example is not allowlisted",
            mastraRunId: "run-9",
          },
        },
        { status: 422 },
      ),
    )

    await expect(
      launchSmartCropPlan(planInput, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: false,
      reason: "frame_host_not_allowed",
      retryable: false,
      message: "Frame URL host evil.example is not allowlisted",
      mastraRunId: "run-9",
    })
  })

  it("maps 401 to auth_failed and junk payloads to parse_error", async () => {
    const unauthorized = vi.fn(async () =>
      Response.json({ error: "nope" }, { status: 401 }),
    )
    await expect(
      launchSmartCropPlan(planInput, { ...CLIENT, fetchImpl: unauthorized }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed", retryable: false })

    const junk = vi.fn(async () => Response.json({ result: { weird: 1 } }))
    await expect(
      launchSmartCropPlan(planInput, { ...CLIENT, fetchImpl: junk }),
    ).resolves.toEqual({ ok: false, reason: "parse_error", retryable: true })
  })
})

describe("launchSmartCropAlign", () => {
  const alignInput = {
    canonicalFingerprint: { kind: "smart-crop-fingerprint" },
    localizedFingerprint: { kind: "smart-crop-fingerprint" },
    language: "uk",
    planShotIds: ["shot_00421"],
    gates: { minOverallConfidence: 0.92 },
  }

  it("parses the timeline map success literals", async () => {
    const timelineMap = {
      mappingMethod: "shot-sequence",
      overallConfidence: 0.97,
      unmappedDurationPercent: 1.8,
      maxConsecutiveUnmappedSeconds: 4.2,
      segments: [
        {
          canonicalShotId: "shot_00421",
          canonicalStart: 124.2,
          canonicalEnd: 139.8,
          localizedStart: 126.8,
          localizedEnd: 143.1,
          confidence: 0.98,
        },
      ],
      gate: {
        passed: true,
        failures: [],
        config: {
          minOverallConfidence: 0.92,
          minShotConfidence: 0.85,
          maxUnmappedDurationPercent: 5,
          maxConsecutiveUnmappedSeconds: 20,
          maxTimingDriftSecondsPerShot: 5,
        },
      },
      warnings: [],
    }
    const fetchImpl = vi.fn(async () =>
      Response.json({ result: { ok: true, timelineMap } }),
    )

    await expect(
      launchSmartCropAlign(alignInput, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({ ok: true, timelineMap })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-smart-crop-align"),
      expect.anything(),
    )
  })

  it("surfaces provider_failed with the mastra retryable flag", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        {
          result: {
            ok: false,
            reason: "provider_failed",
            retryable: true,
            message: "upstream 503",
            mastraRunId: "run-3",
          },
        },
        { status: 502 },
      ),
    )

    await expect(
      launchSmartCropAlign(alignInput, { ...CLIENT, fetchImpl }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "provider_failed",
      retryable: true,
    })
  })
})

describe("launchSmartCropQa", () => {
  const qaInput = {
    asset: { assetId: "asset123" },
    renderMode: "preview" as const,
    planSummary: { segmentCount: 412, modes: { speaker: 250, group: 100 } },
    frames: [{ atSeconds: 4, url: "https://image.mux.com/frame.jpg" }],
    model: "google/gemini-2.5-flash",
  }

  it("parses the QA verdict literals", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          ok: true,
          verdict: "pass",
          issues: [
            {
              severity: "warning",
              description: "Subject slightly off-center in opening shot",
              atSeconds: 4,
              shotId: "shot_00421",
            },
          ],
          usage: { inputTokens: 900, outputTokens: 120 },
          model: "google/gemini-2.5-flash",
        },
      }),
    )

    await expect(
      launchSmartCropQa(qaInput, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      verdict: "pass",
      issues: [
        {
          severity: "warning",
          description: "Subject slightly off-center in opening shot",
          atSeconds: 4,
          shotId: "shot_00421",
        },
      ],
      usage: { inputTokens: 900, outputTokens: 120 },
      model: "google/gemini-2.5-flash",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-smart-crop-qa"),
      expect.anything(),
    )
  })

  it("rejects an unknown verdict literal as parse_error", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          ok: true,
          verdict: "great",
          issues: [],
          usage: { inputTokens: 0, outputTokens: 0 },
          model: "google/gemini-2.5-flash",
        },
      }),
    )

    await expect(
      launchSmartCropQa(qaInput, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({ ok: false, reason: "parse_error", retryable: true })
  })
})

describe("launchSmartCropRepair", () => {
  const repairInput = {
    asset: { assetId: "asset123", playbackId: "pb_abc" },
    source: { width: 1920, height: 1080, durationSeconds: 7200 },
    target: { aspectRatio: "9:16" as const, width: 1080, height: 1920 },
    attempt: {
      index: 1,
      previousPlanGeneratedAt: "2026-06-09T00:00:00.000Z",
    },
    issues: [
      {
        severity: "warning" as const,
        description: "Subject face is cut off",
        shotId: "shot_00421",
      },
    ],
    shots: [
      {
        shotId: "shot_00421",
        start: 124.2,
        end: 139.8,
        previousSegment: planSegment,
        frameUrls: ["https://image.mux.com/pb_abc/thumbnail.webp?width=768"],
      },
    ],
    model: "qwen/qwen2.5-vl-72b-instruct",
  }

  it("posts to /forge-smart-crop-repair and parses replacement segments", async () => {
    const repairedSegment = {
      ...planSegment,
      cropKeyframes: [
        { progress: 0, x: 640, y: 0, width: 606, height: 1080 },
        { progress: 1, x: 680, y: 0, width: 606, height: 1080 },
      ],
    }
    const fetchImpl = vi.fn(async () =>
      Response.json({
        result: {
          ok: true,
          segments: [repairedSegment],
          usage: { inputTokens: 700, outputTokens: 80 },
          model: "qwen/qwen2.5-vl-72b-instruct",
        },
      }),
    )

    await expect(
      launchSmartCropRepair(repairInput, { ...CLIENT, fetchImpl }),
    ).resolves.toEqual({
      ok: true,
      segments: [repairedSegment],
      usage: { inputTokens: 700, outputTokens: 80 },
      model: "qwen/qwen2.5-vl-72b-instruct",
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://mastra.internal/forge-smart-crop-repair"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    )
  })
})
