import { describe, expect, it, vi } from "vitest"

import { SMART_CROP_GATE_DEFAULTS } from "../../services/smart-crop/alignment"
import {
  handleSmartCropAlignRouteRequest,
  runSmartCropAlignWorkflow,
  type SmartCropAlignResult,
} from "./smart-crop-align"

const HASH_A = "0000000000000000"
const HASH_B = "ffffffffffffffff"

/** Producer-exact `smart-crop-fingerprint` artifact shape from crop-worker. */
function fingerprintArtifact(
  assetId: string,
  durationSeconds: number,
  shots: Array<{ id: string; start: number; end: number; dhash: string }>,
) {
  return {
    version: 1,
    kind: "smart-crop-fingerprint",
    assetId,
    source: { width: 1920, height: 1080, durationSeconds },
    sampling: { hashFps: 1, hashSize: 8, sceneThreshold: 0.3 },
    shots: shots.map((shot) => ({
      shotId: shot.id,
      start: shot.start,
      end: shot.end,
      representativeHashes: [
        { time: (shot.start + shot.end) / 2, dhash: shot.dhash },
      ],
    })),
    tool: "crop-worker-fingerprint-v1",
    generatedAt: "2026-06-09T00:00:00.000Z",
  }
}

const canonicalFingerprint = fingerprintArtifact("asset123", 100, [
  { id: "shot_00001", start: 0, end: 50, dhash: HASH_A },
  { id: "shot_00002", start: 50, end: 100, dhash: HASH_B },
])
const localizedFingerprint = fingerprintArtifact("asset456", 100.2, [
  { id: "shot_00001", start: 0, end: 50.1, dhash: HASH_A },
  { id: "shot_00002", start: 50.1, end: 100.2, dhash: HASH_B },
])

describe("smart crop align workflow", () => {
  it("aligns producer-exact fingerprint artifacts, tolerating extra fields", async () => {
    const result = await runSmartCropAlignWorkflow(
      {
        canonicalFingerprint,
        localizedFingerprint,
        language: "uk",
        planShotIds: ["shot_00001", "shot_00002"],
      },
      { runId: "run-align" },
    )

    expect(result).toEqual({
      ok: true,
      timelineMap: {
        mappingMethod: "identical-duration",
        overallConfidence: 0.99,
        unmappedDurationPercent: 0,
        maxConsecutiveUnmappedSeconds: 0,
        segments: [
          {
            canonicalShotId: "shot_00001",
            canonicalStart: 0,
            canonicalEnd: 50,
            localizedStart: 0,
            localizedEnd: 50.1,
            confidence: 0.99,
          },
          {
            canonicalShotId: "shot_00002",
            canonicalStart: 50,
            canonicalEnd: 100,
            localizedStart: 50.1,
            localizedEnd: 100.2,
            confidence: 0.99,
          },
        ],
        gate: {
          passed: true,
          failures: [],
          config: { ...SMART_CROP_GATE_DEFAULTS },
        },
        warnings: [],
      },
    })
  })

  it("merges gate overrides over the defaults and reports gate failures", async () => {
    const result = await runSmartCropAlignWorkflow(
      {
        canonicalFingerprint,
        localizedFingerprint,
        gates: { minOverallConfidence: 0.995 },
      },
      { runId: "run-align-gates" },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timelineMap.gate.config.minOverallConfidence).toBe(0.995)
    expect(result.timelineMap.gate.passed).toBe(false)
    expect(result.timelineMap.gate.failures).toEqual([
      "overall_confidence_below_min",
    ])
  })

  it("rejects fingerprints with the wrong kind literal", async () => {
    const result = await runSmartCropAlignWorkflow(
      {
        canonicalFingerprint: {
          ...canonicalFingerprint,
          kind: "scene-analysis",
        },
        localizedFingerprint,
      },
      { runId: "run-align-bad-kind" },
    )

    expect(result).toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
      message: "smart crop align input failed validation",
      mastraRunId: "run-align-bad-kind",
    })
  })

  it("requires service bearer auth on the route", async () => {
    const outcome = await handleSmartCropAlignRouteRequest({
      authHeader: undefined,
      serviceKeys: ["service-key"],
      readJson: async () => ({}),
    })

    expect(outcome).toEqual({
      status: 401,
      body: { error: "Service bearer required" },
    })
  })

  it("maps invalid route input to 400", async () => {
    const outcome = await handleSmartCropAlignRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ canonicalFingerprint: { kind: "nope" } }),
    })

    expect(outcome.status).toBe(400)
    expect(outcome.body.result).toMatchObject({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
  })

  it("launches the workflow from a valid route request", async () => {
    const result: SmartCropAlignResult = {
      ok: true,
      timelineMap: {
        mappingMethod: "shot-sequence",
        overallConfidence: 0.97,
        unmappedDurationPercent: 1.8,
        maxConsecutiveUnmappedSeconds: 4.2,
        segments: [],
        gate: {
          passed: true,
          failures: [],
          config: { ...SMART_CROP_GATE_DEFAULTS },
        },
        warnings: [],
      },
    }
    const launch = vi.fn(async () => result)

    const outcome = await handleSmartCropAlignRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({ canonicalFingerprint, localizedFingerprint }),
      launch,
    })

    expect(outcome).toEqual({ status: 200, body: { result } })
    expect(launch).toHaveBeenCalledWith(
      { canonicalFingerprint, localizedFingerprint },
      { runId: expect.any(String) },
    )
  })
})
