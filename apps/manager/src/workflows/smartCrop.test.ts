// Workflow-level branch pinning for the Smart Crop durable workflows
// (mocked-shape-vs-real-contract discipline: jobStateSteps / storage /
// crop-worker / mastra / mux are mocked at the module seams the steps
// dynamically import; the pure artifact helpers in @/services/smartCrop stay
// REAL and fixtures flow through the mocked storage as JSON bytes).

import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  updateJobMock,
  updateStepStatusStepMock,
  mergeJobArtifactsMock,
  stateUpdateStepStatusMock,
  artifactExistsMock,
  readArtifactMock,
  writeArtifactMock,
  createPresignedArtifactUrlMock,
  runCropWorkerJobMock,
  launchSmartCropPlanMock,
  launchSmartCropAlignMock,
  launchSmartCropQaMock,
  launchSmartCropRepairMock,
  createMuxAssetMock,
  getMuxAssetMock,
} = vi.hoisted(() => ({
  updateJobMock: vi.fn(),
  updateStepStatusStepMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  stateUpdateStepStatusMock: vi.fn(),
  artifactExistsMock: vi.fn(),
  readArtifactMock: vi.fn(),
  writeArtifactMock: vi.fn(),
  createPresignedArtifactUrlMock: vi.fn(),
  runCropWorkerJobMock: vi.fn(),
  launchSmartCropPlanMock: vi.fn(),
  launchSmartCropAlignMock: vi.fn(),
  launchSmartCropQaMock: vi.fn(),
  launchSmartCropRepairMock: vi.fn(),
  createMuxAssetMock: vi.fn(),
  getMuxAssetMock: vi.fn(),
}))

vi.mock("@/workflows/jobStateSteps", () => ({
  stepUpdateJob: updateJobMock,
  stepUpdateStepStatus: updateStepStatusStepMock,
  stepMergeJobArtifacts: mergeJobArtifactsMock,
  stepGetJob: vi.fn(),
}))

vi.mock("@/lib/state", () => ({
  updateStepStatus: stateUpdateStepStatusMock,
}))

vi.mock("@/services/storage", () => ({
  artifactExists: artifactExistsMock,
  readArtifact: readArtifactMock,
  writeArtifact: writeArtifactMock,
  createPresignedArtifactUrl: createPresignedArtifactUrlMock,
}))

vi.mock("@/services/crop-worker", () => ({
  runCropWorkerJob: runCropWorkerJobMock,
}))

vi.mock("@/services/mastra-smart-crop", () => ({
  launchSmartCropPlan: launchSmartCropPlanMock,
  launchSmartCropAlign: launchSmartCropAlignMock,
  launchSmartCropQa: launchSmartCropQaMock,
  launchSmartCropRepair: launchSmartCropRepairMock,
}))

vi.mock("@/services/mux", () => ({
  getPlaybackUrl: (playbackId: string) =>
    `https://stream.mux.com/${playbackId}.m3u8`,
  getThumbnailUrl: (
    playbackId: string,
    options: { width?: number; time?: number } = {},
  ) =>
    `https://image.mux.com/${playbackId}/thumbnail.webp?width=${options.width}&time=${options.time}`,
  createMuxAsset: createMuxAssetMock,
  getMuxAsset: getMuxAssetMock,
}))

import {
  errorMessage,
  runSmartCropCanonical,
  runSmartCropLocalized,
  SmartCropStepError,
} from "@/workflows/smartCrop"
import {
  assemblePlanArtifact,
  buildPlanProgressArtifact,
  buildMuxOutputRecord,
  buildTimelineMapArtifact,
  SMART_CROP_ATTEMPTS_ARTIFACT_TYPE,
  SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
  SMART_CROP_PLAN_BATCH_SIZE,
  SMART_CROP_PLAN_PROGRESS_ARTIFACT_TYPE,
} from "@/services/smartCrop"
import type { SmartCropPlanSegment } from "@/services/mastra-smart-crop"

// ---------------------------------------------------------------------------
// In-memory artifact store backing the mocked storage service
// ---------------------------------------------------------------------------

const artifactStore = new Map<string, unknown>()

function seedArtifact(
  assetId: string,
  artifactType: string,
  payload: unknown,
): void {
  artifactStore.set(`${assetId}/${artifactType}`, payload)
}

function readSeededArtifact(assetId: string, artifactType: string): unknown {
  return artifactStore.get(`${assetId}/${artifactType}`)
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLAN_GENERATED_AT = "2026-06-09T00:00:00.000Z"
const CANONICAL_FP_AT = "2026-06-08T00:00:00.000Z"
const LOCALIZED_FP_AT = "2026-06-08T01:00:00.000Z"

const SEGMENT: SmartCropPlanSegment = {
  shotId: "shot_00001",
  canonicalStart: 0,
  canonicalEnd: 10,
  mode: "speaker",
  confidence: 0.9,
  cropKeyframes: [{ progress: 0, x: 0, y: 0, width: 606, height: 1080 }],
}

function buildFingerprint(
  assetId: string,
  generatedAt: string,
  options: { shotCount?: number; width?: number; height?: number } = {},
) {
  const shotCount = options.shotCount ?? 2
  return {
    version: 1,
    kind: "smart-crop-fingerprint",
    assetId,
    source: {
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      durationSeconds: 100,
    },
    shots: Array.from({ length: shotCount }, (_, index) => ({
      shotId: `shot_${String(index + 1).padStart(5, "0")}`,
      start: index * 10,
      end: index * 10 + 10,
      representativeHashes: [],
    })),
    tool: "crop-worker-fingerprint-v1",
    generatedAt,
  }
}

function buildApprovedPlan() {
  const plan = assemblePlanArtifact({
    assetId: "asset123",
    muxAssetId: "mux-1",
    playbackId: "pbcanonical",
    source: { width: 1920, height: 1080, durationSeconds: 100 },
    cropMode: "auto",
    model: "m",
    segmentsFromChunks: [[SEGMENT]],
    usageTotals: { inputTokens: 10, outputTokens: 1 },
    generatedAt: PLAN_GENERATED_AT,
  })
  return {
    ...plan,
    qa: {
      status: "approved" as const,
      approvedBy: "vlad@example.test",
      approvedAt: PLAN_GENERATED_AT,
    },
  }
}

function buildMatchingTimelineMap() {
  return buildTimelineMapArtifact(
    {
      mappingMethod: "shot-sequence",
      overallConfidence: 0.97,
      unmappedDurationPercent: 1.2,
      maxConsecutiveUnmappedSeconds: 2,
      segments: [],
      gate: { passed: true, failures: [], config: {} },
      warnings: [],
    },
    { canonicalAssetId: "asset123", localizedAssetId: "asset456" },
    "uk",
    "2026-06-09T02:00:00.000Z",
    {
      canonicalPlanGeneratedAt: PLAN_GENERATED_AT,
      canonicalFingerprintGeneratedAt: CANONICAL_FP_AT,
      localizedFingerprintGeneratedAt: LOCALIZED_FP_AT,
    },
  )
}

const PREVIEW_RENDER_REPORT = {
  version: 1,
  kind: "smart-crop-render-report",
  assetId: "asset456",
  mode: "preview",
  previewFrameArtifactTypes: [
    "smart-crop-preview-frame-9x16-001",
    "smart-crop-preview-frame-9x16-002",
  ],
  outputDurationSeconds: 60,
}

const LOCALIZED_INPUT = {
  jobId: "job-loc",
  assetId: "asset456",
  muxAssetId: "mux-uk",
  playbackId: "pbuk",
  cropMode: "auto" as const,
  canonicalAssetId: "asset123",
  language: "uk",
}

const CANONICAL_INPUT = {
  jobId: "job-can",
  assetId: "asset123",
  muxAssetId: "mux-1",
  playbackId: "pbcanonical",
  cropMode: "auto" as const,
}

// Seeds every artifact a localized run needs so all steps before mux output
// take their skip paths; individual tests delete/replace what they exercise.
function seedLocalizedSkipArtifacts(): void {
  seedArtifact(
    "asset456",
    "smart-crop-fingerprint-v1",
    buildFingerprint("asset456", LOCALIZED_FP_AT),
  )
  seedArtifact(
    "asset123",
    "smart-crop-fingerprint-v1",
    buildFingerprint("asset123", CANONICAL_FP_AT),
  )
  seedArtifact("asset123", "smart-crop-plan-9x16-v1", buildApprovedPlan())
  seedArtifact(
    "asset456",
    "smart-crop-timeline-map-v1",
    buildMatchingTimelineMap(),
  )
  seedArtifact(
    "asset456",
    "smart-crop-render-report-9x16-preview",
    PREVIEW_RENDER_REPORT,
  )
  seedArtifact("asset456", "smart-crop-qa-9x16-v1", {
    verdict: "pass",
    issues: [],
  })
  seedArtifact("asset456", "smart-crop-render-report-9x16-full", {
    version: 1,
    kind: "smart-crop-render-report",
    mode: "full",
  })
}

function stepStatusCalls(step: string): unknown[][] {
  return updateStepStatusStepMock.mock.calls.filter(([, name]) => name === step)
}

beforeEach(() => {
  vi.clearAllMocks()
  artifactStore.clear()

  updateJobMock.mockResolvedValue({})
  updateStepStatusStepMock.mockResolvedValue({})
  mergeJobArtifactsMock.mockResolvedValue({})
  stateUpdateStepStatusMock.mockResolvedValue({})

  artifactExistsMock.mockImplementation(
    async (assetId: string, artifactType: string) =>
      artifactStore.has(`${assetId}/${artifactType}`),
  )
  readArtifactMock.mockImplementation(
    async (assetId: string, artifactType: string) => {
      const payload = artifactStore.get(`${assetId}/${artifactType}`)
      if (payload === undefined) {
        throw new Error(`missing artifact ${assetId}/${artifactType}`)
      }
      return new TextEncoder().encode(JSON.stringify(payload))
    },
  )
  writeArtifactMock.mockImplementation(
    async (options: {
      assetId: string
      artifactType: string
      body: string
    }) => {
      artifactStore.set(
        `${options.assetId}/${options.artifactType}`,
        JSON.parse(String(options.body)) as unknown,
      )
      return `${options.assetId}/${options.artifactType}.json`
    },
  )
  createPresignedArtifactUrlMock.mockResolvedValue(
    "https://s3.example.test/presigned",
  )

  runCropWorkerJobMock.mockImplementation(
    async (options: {
      body: {
        kind: string
        assetId: string
        render?: {
          mode: "preview" | "full"
          artifactSuffix?: string
          cropPlan?: { artifactType?: string }
        }
      }
    }) => {
      if (options.body.kind === "render" && options.body.render) {
        const suffix = options.body.render.artifactSuffix
          ? `-${options.body.render.artifactSuffix}`
          : ""
        const frameSuffix = options.body.render.artifactSuffix
          ? `-${options.body.render.artifactSuffix}`
          : ""
        seedArtifact(
          options.body.assetId,
          `smart-crop-render-report-9x16-${options.body.render.mode}${suffix}`,
          {
            ...PREVIEW_RENDER_REPORT,
            assetId: options.body.assetId,
            mode: options.body.render.mode,
            cropPlanArtifactType:
              options.body.render.cropPlan?.artifactType ??
              "smart-crop-plan-9x16-v1",
            artifactSuffix: options.body.render.artifactSuffix,
            previewFrameArtifactTypes:
              options.body.render.mode === "preview"
                ? [
                    `smart-crop-preview-frame-9x16-001${frameSuffix}`,
                    `smart-crop-preview-frame-9x16-002${frameSuffix}`,
                  ]
                : [],
            renderedSegments: [
              {
                shotId: "shot_00001",
                sourceStartSeconds: 0,
                sourceEndSeconds: 10,
                outputStartSeconds: 0,
                outputEndSeconds: PREVIEW_RENDER_REPORT.outputDurationSeconds,
                durationSeconds: PREVIEW_RENDER_REPORT.outputDurationSeconds,
              },
            ],
          },
        )
      }
      return {
        ok: true,
        data: {
          workerJobId: "wj_1",
          kind: options.body.kind,
          status: "completed",
          progress: 1,
          message: null,
          error: null,
          result: null,
        },
      }
    },
  )
  launchSmartCropPlanMock.mockResolvedValue({
    ok: true,
    segments: [SEGMENT],
    usage: { inputTokens: 10, outputTokens: 1 },
    model: "m",
  })
  launchSmartCropAlignMock.mockResolvedValue({
    ok: true,
    timelineMap: {
      mappingMethod: "shot-sequence",
      overallConfidence: 0.97,
      unmappedDurationPercent: 1.2,
      maxConsecutiveUnmappedSeconds: 2,
      segments: [],
      gate: { passed: true, failures: [], config: {} },
      warnings: [],
    },
  })
  launchSmartCropQaMock.mockResolvedValue({
    ok: true,
    verdict: "pass",
    issues: [],
    usage: { inputTokens: 5, outputTokens: 1 },
    model: "qa-model",
  })
  launchSmartCropRepairMock.mockResolvedValue({
    ok: true,
    segments: [
      {
        ...SEGMENT,
        cropKeyframes: [
          { progress: 0, x: 120, y: 0, width: 606, height: 1080 },
        ],
      },
    ],
    usage: { inputTokens: 7, outputTokens: 2 },
    model: "repair-model",
  })
  createMuxAssetMock.mockResolvedValue({
    assetId: "mux_new",
    playbackId: "pb_new",
    status: "ready",
    duration: 100,
  })
  getMuxAssetMock.mockResolvedValue({
    assetId: "mux_prev",
    playbackId: "pb_prev",
    status: "ready",
    duration: 100,
  })
})

describe("runSmartCropLocalized — mux output idempotency", () => {
  it("creates the asset once and records it before readiness is observed", async () => {
    seedLocalizedSkipArtifacts()

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(createMuxAssetMock).toHaveBeenCalledTimes(1)
    // The pending record (ready:false) is written before the ready record —
    // a throw between the two leaves the asset id durable for the retry.
    const recordWrites = writeArtifactMock.mock.calls.filter(
      ([options]) =>
        (options as { artifactType: string }).artifactType ===
        SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
    )
    expect(recordWrites).toHaveLength(2)
    const first = JSON.parse(
      String((recordWrites[0]?.[0] as { body: string }).body),
    ) as { ready: boolean; muxAssetId: string }
    expect(first).toMatchObject({ ready: false, muxAssetId: "mux_new" })
    const final = readSeededArtifact(
      "asset456",
      SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
    ) as { ready: boolean; playbackId?: string }
    expect(final).toMatchObject({ ready: true, playbackId: "pb_new" })

    expect(updateJobMock).toHaveBeenCalledWith(
      "job-loc",
      expect.objectContaining({ status: "completed" }),
    )
  })

  it("resumes polling a recorded pending asset instead of creating a duplicate", async () => {
    seedLocalizedSkipArtifacts()
    seedArtifact(
      "asset456",
      SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
      buildMuxOutputRecord({
        jobId: "job-loc",
        muxAssetId: "mux_prev",
        ready: false,
        createdAt: "2026-06-09T03:00:00.000Z",
      }),
    )

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(createMuxAssetMock).not.toHaveBeenCalled()
    expect(getMuxAssetMock).toHaveBeenCalledWith("mux_prev")
    const final = readSeededArtifact(
      "asset456",
      SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
    ) as { ready: boolean; muxAssetId: string; playbackId?: string }
    expect(final).toMatchObject({
      ready: true,
      muxAssetId: "mux_prev",
      playbackId: "pb_prev",
    })
  })

  it("short-circuits on a ready record without any Mux calls", async () => {
    seedLocalizedSkipArtifacts()
    seedArtifact(
      "asset456",
      SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
      buildMuxOutputRecord({
        jobId: "job-loc",
        muxAssetId: "mux_done",
        ready: true,
        playbackId: "pb_done",
      }),
    )

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(createMuxAssetMock).not.toHaveBeenCalled()
    expect(getMuxAssetMock).not.toHaveBeenCalled()
    expect(stepStatusCalls("smart_crop_mux_output").at(-1)).toEqual([
      "job-loc",
      "smart_crop_mux_output",
      "skipped",
    ])
    // The report still mirrors the recorded output for the UI.
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-loc",
      expect.objectContaining({
        smartCrop: expect.objectContaining({
          data: expect.objectContaining({
            output: { muxAssetId: "mux_done", playbackId: "pb_done" },
          }),
        }),
      }),
    )
  })

  it("recreates a fresh asset when the recorded asset errored", async () => {
    seedLocalizedSkipArtifacts()
    seedArtifact(
      "asset456",
      SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
      buildMuxOutputRecord({
        jobId: "job-loc",
        muxAssetId: "mux_errored",
        ready: false,
      }),
    )
    getMuxAssetMock.mockResolvedValue({
      assetId: "mux_errored",
      playbackId: "pb_err",
      status: "errored",
      duration: null,
    })

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(createMuxAssetMock).toHaveBeenCalledTimes(1)
    const final = readSeededArtifact(
      "asset456",
      SMART_CROP_MUX_OUTPUT_ARTIFACT_TYPE,
    ) as { muxAssetId: string; ready: boolean }
    expect(final).toMatchObject({ muxAssetId: "mux_new", ready: true })
  })
})

describe("runSmartCropLocalized — QA advisory degradation", () => {
  it("skips the QA step on frame_host_not_allowed and continues to mux output", async () => {
    seedLocalizedSkipArtifacts()
    artifactStore.delete("asset456/smart-crop-qa-9x16-v1")
    launchSmartCropQaMock.mockResolvedValue({
      ok: false,
      reason: "frame_host_not_allowed",
      retryable: false,
      message: "frame URL host is not allowlisted: s3.example.test",
    })

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(stepStatusCalls("smart_crop_qa").at(-1)).toEqual([
      "job-loc",
      "smart_crop_qa",
      "skipped",
      expect.stringContaining("qa_unavailable (frame_host_not_allowed)"),
    ])
    // Reason mirrored into metadata for the UI.
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-loc",
      expect.objectContaining({
        smartCrop: expect.objectContaining({
          data: expect.objectContaining({
            qa: { unavailableReason: "frame_host_not_allowed" },
          }),
        }),
      }),
    )
    // The pipeline still reaches mux output and completes.
    expect(updateJobMock).toHaveBeenCalledWith(
      "job-loc",
      expect.objectContaining({ status: "completed" }),
    )
  })

  it("still fails the job on a genuine QA verdict fail", async () => {
    seedLocalizedSkipArtifacts()
    artifactStore.delete("asset456/smart-crop-qa-9x16-v1")
    launchSmartCropQaMock.mockResolvedValue({
      ok: true,
      verdict: "fail",
      issues: [{ severity: "critical", description: "subject cut off" }],
      usage: { inputTokens: 5, outputTokens: 1 },
      model: "qa-model",
    })

    await expect(runSmartCropLocalized(LOCALIZED_INPUT)).rejects.toMatchObject({
      name: "SmartCropStepError",
      message: "Smart Crop QA verdict: fail (1 issue)",
    })

    expect(stepStatusCalls("smart_crop_qa").at(-1)).toEqual([
      "job-loc",
      "smart_crop_qa",
      "failed",
      "Smart Crop QA verdict: fail (1 issue)",
    ])
    expect(updateJobMock).toHaveBeenCalledWith("job-loc", {
      status: "failed",
      currentStep: undefined,
    })
    expect(createMuxAssetMock).not.toHaveBeenCalled()
  })

  it("fails (not retries) on non-config QA brokenness via FatalError when retryable:false", async () => {
    seedLocalizedSkipArtifacts()
    artifactStore.delete("asset456/smart-crop-qa-9x16-v1")
    launchSmartCropQaMock.mockResolvedValue({
      ok: false,
      reason: "provider_invalid_output",
      retryable: false,
      message: "model returned junk",
    })

    const error = await runSmartCropLocalized(LOCALIZED_INPUT).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe("FatalError")
    expect((error as Error).message).toContain("provider_invalid_output")
  })
})

describe("runSmartCropLocalized — alignment", () => {
  it("fails the job with an operator-actionable message when the gate fails", async () => {
    seedLocalizedSkipArtifacts()
    artifactStore.delete("asset456/smart-crop-timeline-map-v1")
    launchSmartCropAlignMock.mockResolvedValue({
      ok: true,
      timelineMap: {
        mappingMethod: "shot-sequence",
        overallConfidence: 0.4,
        unmappedDurationPercent: 12,
        maxConsecutiveUnmappedSeconds: 30,
        segments: [],
        gate: {
          passed: false,
          failures: ["overall confidence 0.4 < 0.85"],
          config: {},
        },
        warnings: [],
      },
    })

    const error = await runSmartCropLocalized(LOCALIZED_INPUT).catch(
      (caught: unknown) => caught,
    )
    // Workflow-body throw (never SDK-retried) with the typed step error.
    expect(error).toBeInstanceOf(SmartCropStepError)
    expect((error as Error).message).toBe(
      "Alignment confidence gates failed: overall confidence 0.4 < 0.85",
    )

    expect(stepStatusCalls("smart_crop_align").at(-1)).toEqual([
      "job-loc",
      "smart_crop_align",
      "failed",
      "Alignment confidence gates failed: overall confidence 0.4 < 0.85",
    ])
    // Gate outcome persisted (operator-actionable, not silent).
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-loc",
      expect.objectContaining({
        smartCrop: expect.objectContaining({
          data: expect.objectContaining({
            alignment: expect.objectContaining({ gatePassed: false }),
          }),
        }),
      }),
    )
    expect(updateJobMock).toHaveBeenCalledWith("job-loc", {
      status: "failed",
      currentStep: undefined,
    })
  })

  it("reuses an existing map only when provenance matches", async () => {
    seedLocalizedSkipArtifacts()

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(launchSmartCropAlignMock).not.toHaveBeenCalled()
    expect(stepStatusCalls("smart_crop_align").at(-1)).toEqual([
      "job-loc",
      "smart_crop_align",
      "skipped",
    ])
  })

  it("recomputes when the canonical plan was regenerated after the map", async () => {
    seedLocalizedSkipArtifacts()
    const staleMap = buildMatchingTimelineMap()
    seedArtifact("asset456", "smart-crop-timeline-map-v1", {
      ...staleMap,
      provenance: {
        ...staleMap.provenance,
        canonicalPlanGeneratedAt: "2026-01-01T00:00:00.000Z",
      },
    })

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(launchSmartCropAlignMock).toHaveBeenCalledTimes(1)
    const rewritten = readSeededArtifact(
      "asset456",
      "smart-crop-timeline-map-v1",
    ) as { provenance?: { canonicalPlanGeneratedAt: string | null } }
    expect(rewritten.provenance?.canonicalPlanGeneratedAt).toBe(
      PLAN_GENERATED_AT,
    )
  })

  it("recomputes legacy maps without provenance", async () => {
    seedLocalizedSkipArtifacts()
    const legacyMap = buildMatchingTimelineMap() as Record<string, unknown>
    delete legacyMap.provenance
    seedArtifact("asset456", "smart-crop-timeline-map-v1", legacyMap)

    await runSmartCropLocalized(LOCALIZED_INPUT)

    expect(launchSmartCropAlignMock).toHaveBeenCalledTimes(1)
  })

  it("fails deterministically when canonical and localized dimensions differ", async () => {
    seedLocalizedSkipArtifacts()
    seedArtifact(
      "asset456",
      "smart-crop-fingerprint-v1",
      buildFingerprint("asset456", LOCALIZED_FP_AT, {
        width: 1280,
        height: 720,
      }),
    )

    const error = await runSmartCropLocalized(LOCALIZED_INPUT).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe("FatalError")
    expect((error as Error).message).toContain(
      "source_dimensions_mismatch: canonical 1920x1080 != localized 1280x720",
    )
    expect(launchSmartCropAlignMock).not.toHaveBeenCalled()
  })
})

describe("runSmartCropCanonical — plan checkpointing", () => {
  function seedCanonicalBase(shotCount: number): void {
    seedArtifact(
      "asset123",
      "smart-crop-fingerprint-v1",
      buildFingerprint("asset123", CANONICAL_FP_AT, { shotCount }),
    )
    seedArtifact("asset123", "smart-crop-render-report-9x16-preview", {
      ...PREVIEW_RENDER_REPORT,
      assetId: "asset123",
    })
    seedArtifact("asset123", "smart-crop-qa-9x16-v1", {
      verdict: "pass",
      issues: [],
    })
  }

  it("resumes from the checkpoint instead of re-paying completed batches", async () => {
    // 17 shots -> 3 batches of 8/8/1; checkpoint says 2 are done.
    seedCanonicalBase(17)
    seedArtifact(
      "asset123",
      SMART_CROP_PLAN_PROGRESS_ARTIFACT_TYPE,
      buildPlanProgressArtifact({
        fingerprintGeneratedAt: CANONICAL_FP_AT,
        batchSize: SMART_CROP_PLAN_BATCH_SIZE,
        totalBatches: 3,
        completedBatches: 2,
        segments: [SEGMENT, { ...SEGMENT, shotId: "shot_00002" }],
        usage: { inputTokens: 100, outputTokens: 10 },
        model: "checkpoint-model",
      }),
    )
    launchSmartCropPlanMock.mockResolvedValue({
      ok: true,
      segments: [{ ...SEGMENT, shotId: "shot_00017" }],
      usage: { inputTokens: 50, outputTokens: 5 },
      model: "m",
    })

    await runSmartCropCanonical(CANONICAL_INPUT)

    expect(launchSmartCropPlanMock).toHaveBeenCalledTimes(1)
    const plan = readSeededArtifact("asset123", "smart-crop-plan-9x16-v1") as {
      segments: Array<{ shotId: string }>
      usage: { inputTokens: number; outputTokens: number }
    }
    expect(plan.segments.map((segment) => segment.shotId)).toEqual([
      "shot_00001",
      "shot_00002",
      "shot_00017",
    ])
    expect(plan.usage).toEqual({ inputTokens: 150, outputTokens: 15 })
  })

  it("starts fresh when the checkpoint belongs to a regenerated fingerprint", async () => {
    seedCanonicalBase(17)
    seedArtifact(
      "asset123",
      SMART_CROP_PLAN_PROGRESS_ARTIFACT_TYPE,
      buildPlanProgressArtifact({
        fingerprintGeneratedAt: "2020-01-01T00:00:00.000Z",
        batchSize: SMART_CROP_PLAN_BATCH_SIZE,
        totalBatches: 3,
        completedBatches: 2,
        segments: [SEGMENT],
        usage: { inputTokens: 100, outputTokens: 10 },
      }),
    )

    await runSmartCropCanonical(CANONICAL_INPUT)

    expect(launchSmartCropPlanMock).toHaveBeenCalledTimes(3)
  })

  it("checkpoints after every successful batch", async () => {
    seedCanonicalBase(17)

    await runSmartCropCanonical(CANONICAL_INPUT)

    const checkpointWrites = writeArtifactMock.mock.calls.filter(
      ([options]) =>
        (options as { artifactType: string }).artifactType ===
        SMART_CROP_PLAN_PROGRESS_ARTIFACT_TYPE,
    )
    expect(checkpointWrites).toHaveLength(3)
    const lastCheckpoint = JSON.parse(
      String((checkpointWrites[2]?.[0] as { body: string }).body),
    ) as { completedBatches: number; totalBatches: number }
    expect(lastCheckpoint).toMatchObject({
      completedBatches: 3,
      totalBatches: 3,
    })
  })

  it("recomputes a malformed existing plan artifact instead of skipping", async () => {
    seedCanonicalBase(2)
    seedArtifact("asset123", "smart-crop-plan-9x16-v1", {
      kind: "smart-crop-canonical-plan",
      assetId: "asset123",
      segments: "not-an-array",
    })

    await runSmartCropCanonical(CANONICAL_INPUT)

    expect(launchSmartCropPlanMock).toHaveBeenCalled()
    const plan = readSeededArtifact("asset123", "smart-crop-plan-9x16-v1") as {
      segments: unknown[]
    }
    expect(Array.isArray(plan.segments)).toBe(true)
  })

  it("creates a repair attempt for a crop-affecting QA warning", async () => {
    seedCanonicalBase(2)
    artifactStore.delete("asset123/smart-crop-qa-9x16-v1")
    launchSmartCropQaMock
      .mockResolvedValueOnce({
        ok: true,
        verdict: "pass",
        issues: [
          {
            severity: "warning",
            description: "Speaker face is cut off by the crop",
            shotId: "shot_00001",
          },
        ],
        usage: { inputTokens: 5, outputTokens: 1 },
        model: "qa-model",
      })
      .mockResolvedValueOnce({
        ok: true,
        verdict: "pass",
        issues: [],
        usage: { inputTokens: 5, outputTokens: 1 },
        model: "qa-model",
      })

    await runSmartCropCanonical(CANONICAL_INPUT)

    expect(
      readSeededArtifact("asset123", "smart-crop-plan-9x16-attempt-000-v1"),
    ).toMatchObject({
      kind: "smart-crop-canonical-plan",
      segments: expect.any(Array),
    })
    expect(launchSmartCropRepairMock).toHaveBeenCalledTimes(1)
    expect(
      readSeededArtifact("asset123", SMART_CROP_ATTEMPTS_ARTIFACT_TYPE),
    ).toMatchObject({
      attempts: [
        expect.objectContaining({
          attemptIndex: 0,
          planArtifactType: "smart-crop-plan-9x16-attempt-000-v1",
          qa: expect.objectContaining({ repairTriggerCount: 1 }),
        }),
        expect.objectContaining({ attemptIndex: 1, status: "complete" }),
      ],
    })
  })

  it("does not repair a report-only QA warning", async () => {
    seedCanonicalBase(2)
    artifactStore.delete("asset123/smart-crop-qa-9x16-v1")
    launchSmartCropQaMock.mockResolvedValueOnce({
      ok: true,
      verdict: "pass",
      issues: [
        {
          severity: "warning",
          description: "Preview compression noise is visible",
        },
      ],
      usage: { inputTokens: 5, outputTokens: 1 },
      model: "qa-model",
    })

    await runSmartCropCanonical(CANONICAL_INPUT)

    expect(launchSmartCropRepairMock).not.toHaveBeenCalled()
    expect(
      readSeededArtifact("asset123", SMART_CROP_ATTEMPTS_ARTIFACT_TYPE),
    ).toMatchObject({
      attempts: [
        expect.objectContaining({
          attemptIndex: 0,
          qa: expect.objectContaining({ repairTriggerCount: 0 }),
        }),
      ],
    })
  })
})

describe("step error classification (FatalError vs SmartCropStepError)", () => {
  it("maps retryable:false envelope failures to FatalError (no SDK retry)", async () => {
    // Fingerprint artifact absent -> crop-worker runs and fails terminally.
    runCropWorkerJobMock.mockResolvedValue({
      ok: false,
      reason: "timeout",
      messages: ["crop-worker job wj_1 did not complete within 1800000ms"],
      retryable: false,
    })

    const error = await runSmartCropCanonical(CANONICAL_INPUT).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe("FatalError")
    expect((error as Error).message).toContain(
      "crop-worker fingerprint failed (timeout)",
    )
    expect(updateJobMock).toHaveBeenCalledWith("job-can", {
      status: "failed",
      currentStep: undefined,
    })
  })

  it("keeps retryable:true envelope failures as SmartCropStepError (SDK retries)", async () => {
    runCropWorkerJobMock.mockResolvedValue({
      ok: false,
      reason: "network_error",
      messages: ["socket hang up"],
      retryable: true,
    })

    const error = await runSmartCropCanonical(CANONICAL_INPUT).catch(
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(SmartCropStepError)
    expect((error as SmartCropStepError).code).toBe("network_error")
    expect((error as Error).name).toBe("SmartCropStepError")
  })
})

describe("force retry", () => {
  it("regenerates the QA artifact (and every other step) when force is set", async () => {
    // Everything exists — including a stored verdict "fail" that would
    // deterministically re-fail a plain retry. force recomputes it.
    seedArtifact(
      "asset123",
      "smart-crop-fingerprint-v1",
      buildFingerprint("asset123", CANONICAL_FP_AT),
    )
    seedArtifact("asset123", "smart-crop-plan-9x16-v1", buildApprovedPlan())
    seedArtifact(
      "asset123",
      "smart-crop-render-report-9x16-preview-attempt-000",
      {
        ...PREVIEW_RENDER_REPORT,
        assetId: "asset123",
      },
    )
    seedArtifact("asset123", "smart-crop-qa-9x16-attempt-000-v1", {
      verdict: "fail",
      issues: [{ severity: "critical", description: "old failure" }],
    })

    await runSmartCropCanonical({ ...CANONICAL_INPUT, force: true })

    expect(launchSmartCropQaMock).toHaveBeenCalledTimes(1)
    const qaInput = launchSmartCropQaMock.mock.calls[0]?.[0] as {
      frames: Array<{ shotId?: string }>
    }
    expect(qaInput.frames.map((frame) => frame.shotId)).toEqual([
      "shot_00001",
      "shot_00001",
    ])
    const qaArtifact = readSeededArtifact(
      "asset123",
      "smart-crop-qa-9x16-attempt-000-v1",
    ) as { verdict: string }
    expect(qaArtifact.verdict).toBe("pass")
    expect(updateJobMock).toHaveBeenCalledWith(
      "job-can",
      expect.objectContaining({ status: "completed" }),
    )
    // force also re-ran the byte work + plan.
    expect(runCropWorkerJobMock).toHaveBeenCalledTimes(2) // fingerprint + preview
    expect(launchSmartCropPlanMock).toHaveBeenCalled()
  })

  it("repairs a stored canonical fail verdict on a plain (force:false) retry", async () => {
    seedArtifact(
      "asset123",
      "smart-crop-fingerprint-v1",
      buildFingerprint("asset123", CANONICAL_FP_AT),
    )
    seedArtifact("asset123", "smart-crop-plan-9x16-v1", buildApprovedPlan())
    seedArtifact(
      "asset123",
      "smart-crop-render-report-9x16-preview-attempt-000",
      {
        ...PREVIEW_RENDER_REPORT,
        assetId: "asset123",
      },
    )
    seedArtifact("asset123", "smart-crop-qa-9x16-attempt-000-v1", {
      verdict: "fail",
      issues: [{ severity: "critical", description: "old failure" }],
    })

    await runSmartCropCanonical(CANONICAL_INPUT)

    expect(launchSmartCropQaMock).toHaveBeenCalledTimes(1)
    expect(launchSmartCropRepairMock).toHaveBeenCalledTimes(1)
    expect(
      readSeededArtifact("asset123", "smart-crop-plan-9x16-attempt-001-v1"),
    ).toMatchObject({
      strategy: expect.objectContaining({ model: "repair-model" }),
    })
    expect(updateJobMock).toHaveBeenCalledWith(
      "job-can",
      expect.objectContaining({ status: "completed" }),
    )
  })
})

describe("errorMessage (operator-actionable error extraction)", () => {
  it("extracts .message from a FatalError-shaped object that is NOT instanceof Error", () => {
    // Reproduces the Next.js workflow runtime shape: FatalError surfaces as a
    // plain object with name/message, not an `instanceof Error`. Gating on
    // instanceof discarded the message and showed "Unknown error".
    const fatalLike = {
      name: "FatalError",
      fatal: true,
      message:
        "crop-worker fingerprint failed (worker_error): Command ffprobe failed with code 1: 404 Not Found",
    }
    expect(fatalLike instanceof Error).toBe(false)
    expect(errorMessage(fatalLike)).toBe(fatalLike.message)
  })

  it("returns the message of a real Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom")
  })

  it("returns a plain string error as-is", () => {
    expect(errorMessage("raw failure text")).toBe("raw failure text")
  })

  it("falls back to 'Unknown error' for null/undefined/empty/messageless", () => {
    expect(errorMessage(null)).toBe("Unknown error")
    expect(errorMessage(undefined)).toBe("Unknown error")
    expect(errorMessage("")).toBe("Unknown error")
    expect(errorMessage({ name: "FatalError" })).toBe("Unknown error")
    expect(errorMessage({ message: 42 })).toBe("Unknown error")
  })
})
