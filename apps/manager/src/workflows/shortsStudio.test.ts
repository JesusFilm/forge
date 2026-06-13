// Workflow-level branch pinning for the Shorts Studio durable workflows
// (mocked-shape-vs-real-contract discipline: jobStateSteps / state / storage
// / shorts-worker / mux are mocked at the module seams the steps dynamically
// import; the pure helpers in @/lib/shorts-* stay REAL and fixtures flow
// through the mocked storage as JSON bytes).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobArtifactManifest, JobRecord } from "@/types/job"

const {
  updateJobMock,
  updateStepStatusStepMock,
  mergeJobArtifactsMock,
  mergeShortsReportEntryMock,
  getJobMock,
  stateUpdateStepStatusMock,
  artifactExistsMock,
  readArtifactMock,
  writeArtifactMock,
  createPresignedArtifactUrlMock,
  runShortsWorkerJobMock,
  createMuxAssetMock,
  getMuxAssetMock,
} = vi.hoisted(() => ({
  updateJobMock: vi.fn(),
  updateStepStatusStepMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  mergeShortsReportEntryMock: vi.fn(),
  getJobMock: vi.fn(),
  stateUpdateStepStatusMock: vi.fn(),
  artifactExistsMock: vi.fn(),
  readArtifactMock: vi.fn(),
  writeArtifactMock: vi.fn(),
  createPresignedArtifactUrlMock: vi.fn(),
  runShortsWorkerJobMock: vi.fn(),
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
  getJob: getJobMock,
  updateStepStatus: stateUpdateStepStatusMock,
  mergeShortsReportEntry: mergeShortsReportEntryMock,
}))

vi.mock("@/services/storage", () => ({
  artifactExists: artifactExistsMock,
  readArtifact: readArtifactMock,
  writeArtifact: writeArtifactMock,
  createPresignedArtifactUrl: createPresignedArtifactUrlMock,
}))

vi.mock("@/services/shorts-worker", () => ({
  runShortsWorkerJob: runShortsWorkerJobMock,
  SHORTS_PREPARE_POLL_TIMEOUT_MS: 50 * 60_000,
  SHORTS_RENDER_POLL_TIMEOUT_MS: 80 * 60_000,
}))

vi.mock("@/services/mux", () => ({
  getPlaybackUrl: (playbackId: string) =>
    `https://stream.mux.com/${playbackId}.m3u8`,
  createMuxAsset: createMuxAssetMock,
  getMuxAsset: getMuxAssetMock,
}))

import { COMPOSITIONS_VERSION } from "@forge/shorts-compositions/version"
import {
  buildShortsMetadataArtifact,
  getShortsReport,
  mergeShortsReport,
  type ShortsReportPatch,
} from "@/lib/shorts-report"
import { runShortsPrepare, runShortsRender } from "@/workflows/shortsStudio"

// ---------------------------------------------------------------------------
// In-memory artifact store backing the mocked storage service
// ---------------------------------------------------------------------------

const artifactStore = new Map<string, unknown>()

function storeKey(assetId: string, artifactType: string, ext: string): string {
  return `${assetId}/${artifactType}.${ext}`
}

function seedArtifact(
  assetId: string,
  artifactType: string,
  ext: string,
  payload: unknown,
): void {
  artifactStore.set(storeKey(assetId, artifactType, ext), payload)
}

function readSeededArtifact(
  assetId: string,
  artifactType: string,
  ext = "json",
): unknown {
  return artifactStore.get(storeKey(assetId, artifactType, ext))
}

// Job-state artifacts manifest mutated by the mocked stepMergeJobArtifacts so
// stepReadShortsReport sees what previous runs persisted.
let jobArtifacts: JobArtifactManifest = {}

const ASSET_ID = "mux-src-short-abc12345"
const JOB_ID = "job-shorts-1"
const CAPTIONS_AT = "2026-06-11T10:00:01.000Z"

function buildJobRecord(): JobRecord {
  return {
    id: JOB_ID,
    muxAssetId: "mux-src",
    muxPlaybackId: "pb-src",
    languages: [],
    options: {
      shorts: {
        assetId: ASSET_ID,
        sourceMuxAssetId: "mux-src",
        sourcePlaybackId: "pb-src",
        clip: { startSec: 12, endSec: 42 },
        language: { bcp47: "en-US", whisper: "en" },
        requestedBy: "vlad@example.test",
      },
    },
    status: "pending",
    retries: 0,
    createdAt: "2026-06-11T09:00:00.000Z",
    updatedAt: "2026-06-11T09:00:00.000Z",
    artifacts: jobArtifacts,
    steps: [],
    errors: [],
  }
}

const CLIP_META = {
  sourceHost: "stream.mux.com",
  clip: { startSec: 12, endSec: 42 },
  durationSec: 30,
  fps: 30,
  width: 1920,
  height: 1080,
  hasAudio: true,
  generatedAt: "2026-06-11T10:00:00.000Z",
}

const CAPTIONS_ARTIFACT = {
  captions: [
    {
      text: "Hello",
      startMs: 0,
      endMs: 400,
      timestampMs: 200,
      confidence: 0.98,
    },
    {
      text: " world",
      startMs: 400,
      endMs: 900,
      timestampMs: 600,
      confidence: 0.97,
    },
  ],
  language: "en",
  model: "large-v3-turbo",
  annotation: null,
  generatedAt: CAPTIONS_AT,
}

function seedPrepareArtifacts(): void {
  seedArtifact(ASSET_ID, "shorts-clip-v1", "mp4", "<mp4-bytes>")
  seedArtifact(ASSET_ID, "shorts-clip-meta-v1", "json", CLIP_META)
  seedArtifact(ASSET_ID, "shorts-captions-v1", "json", CAPTIONS_ARTIFACT)
}

function lastPersistedReport() {
  return getShortsReport(jobArtifacts)
}

beforeEach(() => {
  vi.clearAllMocks()
  artifactStore.clear()
  jobArtifacts = {}

  getJobMock.mockImplementation(async () => buildJobRecord())
  updateJobMock.mockImplementation(async () => buildJobRecord())
  updateStepStatusStepMock.mockResolvedValue({})
  stateUpdateStepStatusMock.mockResolvedValue({})
  mergeJobArtifactsMock.mockImplementation(
    async (_jobId: string, artifacts: JobArtifactManifest) => {
      jobArtifacts = { ...jobArtifacts, ...artifacts }
      return buildJobRecord()
    },
  )
  // Test double for state.mergeShortsReportEntry: field-level merge against
  // the CURRENT persisted entry using the REAL pure helpers (the production
  // helper does exactly this inside the per-job write lock).
  mergeShortsReportEntryMock.mockImplementation(
    async (_jobId: string, patch: ShortsReportPatch) => {
      const merged = mergeShortsReport(getShortsReport(jobArtifacts), patch)
      jobArtifacts = { ...jobArtifacts, ...buildShortsMetadataArtifact(merged) }
      return buildJobRecord()
    },
  )

  artifactExistsMock.mockImplementation(
    async (assetId: string, artifactType: string, ext: string) =>
      artifactStore.has(storeKey(assetId, artifactType, ext)),
  )
  readArtifactMock.mockImplementation(
    async (assetId: string, artifactType: string, ext: string) => {
      const key = storeKey(assetId, artifactType, ext)
      if (!artifactStore.has(key)) {
        throw new Error(`missing artifact ${key}`)
      }
      return new TextEncoder().encode(JSON.stringify(artifactStore.get(key)))
    },
  )
  writeArtifactMock.mockImplementation(
    async (options: {
      assetId: string
      artifactType: string
      ext: string
      body: string
    }) => {
      artifactStore.set(
        storeKey(options.assetId, options.artifactType, options.ext),
        options.ext === "json" ? JSON.parse(options.body) : options.body,
      )
      return storeKey(options.assetId, options.artifactType, options.ext)
    },
  )
  createPresignedArtifactUrlMock.mockResolvedValue(
    "https://s3.example.test/presigned",
  )

  // Default worker behavior: prepare writes its artifacts then succeeds;
  // render writes output + render meta echoing the submitted propsHash.
  runShortsWorkerJobMock.mockImplementation(
    async (input: {
      body:
        | { kind: "prepare"; assetId: string }
        | {
            kind: "render"
            assetId: string
            propsHash: string
            draftVersion: number
          }
    }) => {
      if (input.body.kind === "prepare") {
        seedPrepareArtifacts()
        return {
          ok: true,
          data: { workerJobId: "wj_p", kind: "prepare", status: "completed" },
        }
      }
      seedArtifact(input.body.assetId, "shorts-output-v1", "mp4", "<mp4>")
      seedArtifact(input.body.assetId, "shorts-render-meta-v1", "json", {
        propsHash: input.body.propsHash,
        renderedDraftVersion: input.body.draftVersion,
        compositionsVersion: COMPOSITIONS_VERSION,
        generatedAt: "2026-06-11T12:00:00.000Z",
      })
      return {
        ok: true,
        data: { workerJobId: "wj_r", kind: "render", status: "completed" },
      }
    },
  )

  createMuxAssetMock.mockResolvedValue({
    assetId: "mux-out-1",
    playbackId: "",
    status: "preparing",
    duration: null,
  })
  getMuxAssetMock.mockImplementation(async (muxAssetId: string) => ({
    assetId: muxAssetId,
    playbackId: "pb-out-1",
    status: "ready",
    duration: 30,
  }))
})

describe("runShortsPrepare", () => {
  it("runs the worker, seeds the initial draft, and reports ready_for_review", async () => {
    await runShortsPrepare({ jobId: JOB_ID })

    // Worker called with the exact prepare wire contract.
    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(1)
    expect(runShortsWorkerJobMock.mock.calls[0]?.[0]).toMatchObject({
      body: {
        kind: "prepare",
        jobId: JOB_ID,
        assetId: ASSET_ID,
        source: { url: "https://stream.mux.com/pb-src.m3u8" },
        clip: { startSec: 12, endSec: 42 },
        transcription: { language: "en" },
      },
      pollTimeoutMs: 50 * 60_000,
    })

    // Initial draft seeded with captions provenance.
    const draft = readSeededArtifact(ASSET_ID, "shorts-draft-v1") as {
      draftVersion: number
      captionsGeneratedAt: string
      draft: { templateId: string; showCaptions: boolean }
    }
    expect(draft).toMatchObject({
      draftVersion: 1,
      captionsGeneratedAt: CAPTIONS_AT,
      draft: { templateId: "focus", showCaptions: true },
    })

    // Report lands on ready_for_review with prepare facts.
    expect(lastPersistedReport()).toMatchObject({
      phase: "ready_for_review",
      hasAudio: true,
      clipDurationSec: 30,
      captionsCount: 2,
      annotation: null,
      draftVersion: 1,
    })

    // Job completed; step completed (not skipped).
    expect(updateJobMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "completed" }),
    )
    expect(updateStepStatusStepMock).toHaveBeenCalledWith(
      JOB_ID,
      "shorts_prepare",
      "completed",
    )
  })

  it("skips the worker and preserves the draft when artifacts already exist", async () => {
    seedPrepareArtifacts()
    // Operator-edited draft with matching captions provenance.
    seedArtifact(ASSET_ID, "shorts-draft-v1", "json", {
      draftVersion: 3,
      captionsGeneratedAt: CAPTIONS_AT,
      updatedBy: "vlad@example.test",
      updatedAt: "2026-06-11T11:00:00.000Z",
      draft: {
        templateId: "frame",
        accentColor: "#ff0000",
        captionPosition: "center",
        captionFont: "inter",
        waveformStyle: "none",
        showCaptions: true,
        captionPages: [],
      },
    })

    await runShortsPrepare({ jobId: JOB_ID })

    expect(runShortsWorkerJobMock).not.toHaveBeenCalled()
    // Existing draft untouched (retries never discard caption edits).
    expect(readSeededArtifact(ASSET_ID, "shorts-draft-v1")).toMatchObject({
      draftVersion: 3,
      draft: { templateId: "frame" },
    })
    expect(lastPersistedReport()).toMatchObject({
      phase: "ready_for_review",
      draftVersion: 3,
    })
    expect(updateStepStatusStepMock).toHaveBeenCalledWith(
      JOB_ID,
      "shorts_prepare",
      "skipped",
      expect.stringContaining("reused"),
    )
  })

  it("re-runs the worker under force and resets the draft when captions regenerate", async () => {
    seedPrepareArtifacts()
    seedArtifact(ASSET_ID, "shorts-draft-v1", "json", {
      draftVersion: 5,
      captionsGeneratedAt: "2026-06-10T00:00:00.000Z", // stale provenance
      updatedBy: "vlad@example.test",
      updatedAt: "2026-06-10T01:00:00.000Z",
      draft: {
        templateId: "frame",
        accentColor: "#ff0000",
        captionPosition: "center",
        captionFont: "inter",
        waveformStyle: "none",
        showCaptions: true,
        captionPages: [],
      },
    })

    await runShortsPrepare({ jobId: JOB_ID, force: true })

    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(1)
    // Draft reset to the initial v1 (documented force-prepare discard).
    expect(readSeededArtifact(ASSET_ID, "shorts-draft-v1")).toMatchObject({
      draftVersion: 1,
      captionsGeneratedAt: CAPTIONS_AT,
      draft: { templateId: "focus" },
    })
  })

  it("fails the job with phase prepare_failed when the worker fails deterministically", async () => {
    runShortsWorkerJobMock.mockResolvedValue({
      ok: false,
      reason: "worker_error",
      messages: ["clip_out_of_range: bounds exceed source"],
      retryable: false,
    })

    await expect(runShortsPrepare({ jobId: JOB_ID })).rejects.toThrow(
      /clip_out_of_range/,
    )

    expect(lastPersistedReport()).toMatchObject({ phase: "prepare_failed" })
    expect(updateJobMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    )
    expect(updateStepStatusStepMock).toHaveBeenCalledWith(
      JOB_ID,
      "shorts_prepare",
      "failed",
      expect.stringContaining("clip_out_of_range"),
    )
  })
})

describe("runShortsRender", () => {
  // `accentColor` is part of the resolved render props — overriding it
  // simulates an operator edit and produces a DIFFERENT propsHash.
  function seedDraft(draftVersion = 2, accentColor = "#facc15"): void {
    seedArtifact(ASSET_ID, "shorts-draft-v1", "json", {
      draftVersion,
      captionsGeneratedAt: CAPTIONS_AT,
      updatedBy: "vlad@example.test",
      updatedAt: "2026-06-11T11:00:00.000Z",
      draft: {
        templateId: "focus",
        accentColor,
        captionPosition: "lower",
        captionFont: "montserrat",
        waveformStyle: "bars",
        showCaptions: true,
        captionPages: [
          {
            text: "Hello world",
            startMs: 0,
            durationMs: 900,
            tokens: [
              { text: "Hello", fromMs: 0, toMs: 400 },
              { text: " world", fromMs: 400, toMs: 900 },
            ],
          },
        ],
      },
    })
  }

  it("resolves props, submits the audited payload, and finishes via Mux output", async () => {
    seedPrepareArtifacts()
    seedDraft(2)

    // Record-before-poll pin: when Mux readiness is first polled, the output
    // record must ALREADY exist with ready:false.
    let recordAtFirstPoll: unknown = null
    getMuxAssetMock.mockImplementation(async (muxAssetId: string) => {
      recordAtFirstPoll ??= structuredClone(
        readSeededArtifact(ASSET_ID, "shorts-mux-output-v1"),
      )
      return {
        assetId: muxAssetId,
        playbackId: "pb-out-1",
        status: "ready",
        duration: 30,
      }
    })

    await runShortsRender({ jobId: JOB_ID })

    // Audit artifact written and its props (no clipUrl) sent to the worker.
    const audit = readSeededArtifact(ASSET_ID, "shorts-render-props-v1") as {
      propsHash: string
      draftVersion: number
      props: Record<string, unknown>
    }
    expect(audit.propsHash).toMatch(/^[a-f0-9]{64}$/)
    expect(audit.draftVersion).toBe(2)
    expect(audit.props).not.toHaveProperty("clipUrl")
    expect(audit.props).toMatchObject({
      fps: 30,
      clipDurationSec: 30,
      hasAudio: true,
    })

    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(1)
    expect(runShortsWorkerJobMock.mock.calls[0]?.[0]).toMatchObject({
      body: {
        kind: "render",
        jobId: JOB_ID,
        assetId: ASSET_ID,
        propsHash: audit.propsHash,
        draftVersion: 2,
        props: audit.props,
      },
      pollTimeoutMs: 80 * 60_000,
    })

    expect(recordAtFirstPoll).toMatchObject({
      kind: "shorts-mux-output",
      muxAssetId: "mux-out-1",
      ready: false,
    })

    expect(lastPersistedReport()).toMatchObject({
      phase: "completed",
      lastRenderedDraftVersion: 2,
      lastRenderedPropsHash: audit.propsHash,
      output: { muxAssetId: "mux-out-1", playbackId: "pb-out-1", ready: true },
    })
    expect(updateJobMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "completed" }),
    )
  })

  it("preserves prepare-written report fields through the render run", async () => {
    seedPrepareArtifacts()
    seedDraft(2)
    await runShortsPrepare({ jobId: JOB_ID })

    await runShortsRender({ jobId: JOB_ID })

    expect(lastPersistedReport()).toMatchObject({
      phase: "completed",
      hasAudio: true,
      clipDurationSec: 30,
      captionsCount: 2,
    })
  })

  it("skips the worker when an output for the identical propsHash exists", async () => {
    seedPrepareArtifacts()
    seedDraft(2)

    await runShortsRender({ jobId: JOB_ID })
    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(1)
    expect(createMuxAssetMock).toHaveBeenCalledTimes(1)

    // Same draft, same clip — identical propsHash → render reuse AND the
    // recorded ready Mux asset is reused (no duplicate billable asset).
    await runShortsRender({ jobId: JOB_ID })
    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(1)
    expect(createMuxAssetMock).toHaveBeenCalledTimes(1)
    expect(updateStepStatusStepMock).toHaveBeenCalledWith(
      JOB_ID,
      "shorts_render",
      "skipped",
      expect.stringContaining("identical propsHash"),
    )
    expect(lastPersistedReport()).toMatchObject({
      phase: "completed",
      output: { muxAssetId: "mux-out-1", ready: true },
    })
  })

  it("creates a fresh Mux asset when re-rendering a changed draft (stale record propsHash)", async () => {
    // The core edit -> re-render loop (todo 007): render #1 records asset A;
    // the operator edits the draft (new propsHash); render #2 must mint a
    // NEW Mux asset from the new output bytes — never return asset A.
    seedPrepareArtifacts()
    seedDraft(2)
    await runShortsRender({ jobId: JOB_ID })

    const firstRecord = readSeededArtifact(
      ASSET_ID,
      "shorts-mux-output-v1",
    ) as { muxAssetId: string; propsHash: string }
    expect(firstRecord).toMatchObject({ muxAssetId: "mux-out-1" })
    expect(firstRecord.propsHash).toMatch(/^[a-f0-9]{64}$/)

    seedDraft(3, "#ff0000") // operator edit — different propsHash
    createMuxAssetMock.mockResolvedValue({
      assetId: "mux-out-2",
      playbackId: "",
      status: "preparing",
      duration: null,
    })

    await runShortsRender({ jobId: JOB_ID })

    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(2)
    expect(createMuxAssetMock).toHaveBeenCalledTimes(2)
    const secondRecord = readSeededArtifact(
      ASSET_ID,
      "shorts-mux-output-v1",
    ) as { muxAssetId: string; propsHash: string; ready: boolean }
    expect(secondRecord.muxAssetId).toBe("mux-out-2")
    expect(secondRecord.ready).toBe(true)
    expect(secondRecord.propsHash).not.toBe(firstRecord.propsHash)
    expect(lastPersistedReport()).toMatchObject({
      phase: "completed",
      lastRenderedDraftVersion: 3,
      lastRenderedPropsHash: secondRecord.propsHash,
      output: { muxAssetId: "mux-out-2", ready: true },
    })
  })

  it("treats a legacy mux-output record without propsHash as stale", async () => {
    seedPrepareArtifacts()
    seedDraft(2)
    // Ready record written before the propsHash field existed — no
    // provenance, so it must never be reused.
    seedArtifact(ASSET_ID, "shorts-mux-output-v1", "json", {
      version: 1,
      kind: "shorts-mux-output",
      jobId: JOB_ID,
      muxAssetId: "mux-out-legacy",
      ready: true,
      createdAt: "2026-06-10T00:00:00.000Z",
    })
    createMuxAssetMock.mockResolvedValue({
      assetId: "mux-out-fresh",
      playbackId: "",
      status: "preparing",
      duration: null,
    })

    await runShortsRender({ jobId: JOB_ID })

    expect(createMuxAssetMock).toHaveBeenCalledTimes(1)
    expect(readSeededArtifact(ASSET_ID, "shorts-mux-output-v1")).toMatchObject({
      muxAssetId: "mux-out-fresh",
      ready: true,
    })
    expect(lastPersistedReport()).toMatchObject({
      output: { muxAssetId: "mux-out-fresh", ready: true },
    })
  })

  it("resumes polling a not-ready record with the same propsHash instead of duplicating", async () => {
    seedPrepareArtifacts()
    seedDraft(2)
    await runShortsRender({ jobId: JOB_ID })

    // Simulate a prior attempt where the asset was created but readiness was
    // never recorded (same propsHash — same render).
    const record = readSeededArtifact(ASSET_ID, "shorts-mux-output-v1") as {
      muxAssetId: string
    }
    seedArtifact(ASSET_ID, "shorts-mux-output-v1", "json", {
      ...record,
      ready: false,
    })
    createMuxAssetMock.mockClear()

    await runShortsRender({ jobId: JOB_ID })

    expect(createMuxAssetMock).not.toHaveBeenCalled()
    expect(readSeededArtifact(ASSET_ID, "shorts-mux-output-v1")).toMatchObject({
      muxAssetId: "mux-out-1",
      ready: true,
    })
  })

  it("refuses to render a draft with stale captions provenance", async () => {
    seedPrepareArtifacts()
    seedArtifact(ASSET_ID, "shorts-draft-v1", "json", {
      draftVersion: 2,
      captionsGeneratedAt: "2026-06-09T00:00:00.000Z", // stale
      updatedBy: "vlad@example.test",
      updatedAt: "2026-06-11T11:00:00.000Z",
      draft: {
        templateId: "focus",
        accentColor: "#facc15",
        captionPosition: "lower",
        captionFont: "montserrat",
        waveformStyle: "bars",
        showCaptions: true,
        captionPages: [],
      },
    })

    await expect(runShortsRender({ jobId: JOB_ID })).rejects.toThrow(
      /draft_provenance_mismatch/,
    )
    expect(runShortsWorkerJobMock).not.toHaveBeenCalled()
    expect(lastPersistedReport()).toMatchObject({ phase: "render_failed" })
  })

  it("completes with output.ready=false when presigning is unavailable", async () => {
    seedPrepareArtifacts()
    seedDraft(2)
    createPresignedArtifactUrlMock.mockResolvedValue(null)

    await runShortsRender({ jobId: JOB_ID })

    expect(createMuxAssetMock).not.toHaveBeenCalled()
    expect(updateStepStatusStepMock).toHaveBeenCalledWith(
      JOB_ID,
      "shorts_mux_output",
      "skipped",
      expect.stringContaining("storage_presign_unavailable"),
    )
    expect(lastPersistedReport()).toMatchObject({
      phase: "completed",
      output: { muxAssetId: null, playbackId: null, ready: false },
    })
    expect(updateJobMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "completed" }),
    )
  })

  it("recreates an errored recorded Mux asset instead of resuming it", async () => {
    seedPrepareArtifacts()
    seedDraft(2)
    await runShortsRender({ jobId: JOB_ID })

    // Simulate a prior attempt whose asset errored before readiness was
    // recorded — SAME propsHash (same render), so this exercises the
    // errored→recreate path, not the stale-hash path.
    const record = readSeededArtifact(ASSET_ID, "shorts-mux-output-v1") as {
      propsHash: string
    }
    seedArtifact(ASSET_ID, "shorts-mux-output-v1", "json", {
      version: 1,
      kind: "shorts-mux-output",
      jobId: JOB_ID,
      muxAssetId: "mux-out-errored",
      propsHash: record.propsHash,
      ready: false,
      createdAt: "2026-06-11T11:30:00.000Z",
    })
    getMuxAssetMock.mockImplementation(async (muxAssetId: string) => ({
      assetId: muxAssetId,
      playbackId: "pb-out-2",
      status: muxAssetId === "mux-out-errored" ? "errored" : "ready",
      duration: 30,
    }))
    createMuxAssetMock.mockClear()
    createMuxAssetMock.mockResolvedValue({
      assetId: "mux-out-fresh",
      playbackId: "",
      status: "preparing",
      duration: null,
    })

    await runShortsRender({ jobId: JOB_ID })

    expect(createMuxAssetMock).toHaveBeenCalledTimes(1)
    expect(readSeededArtifact(ASSET_ID, "shorts-mux-output-v1")).toMatchObject({
      muxAssetId: "mux-out-fresh",
      ready: true,
      playbackId: "pb-out-2",
    })
    expect(lastPersistedReport()).toMatchObject({
      output: { muxAssetId: "mux-out-fresh", ready: true },
    })
  })

  it("re-renders an unchanged draft when render meta carries a stale compositions version", async () => {
    // Todo 012: after a @forge/shorts-compositions deploy, the reuse gate
    // must NOT skip the worker for an unchanged draft — the stored output
    // was rendered by an older template revision.
    seedPrepareArtifacts()
    seedDraft(2)
    await runShortsRender({ jobId: JOB_ID })
    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(1)

    const meta = readSeededArtifact(ASSET_ID, "shorts-render-meta-v1") as {
      propsHash: string
    }
    seedArtifact(ASSET_ID, "shorts-render-meta-v1", "json", {
      propsHash: meta.propsHash, // unchanged draft — hash still matches
      renderedDraftVersion: 2,
      compositionsVersion: "2020-01-01.0", // pre-deploy revision
      generatedAt: "2026-06-10T00:00:00.000Z",
    })

    await runShortsRender({ jobId: JOB_ID })

    expect(runShortsWorkerJobMock).toHaveBeenCalledTimes(2)
    expect(updateStepStatusStepMock).toHaveBeenCalledWith(
      JOB_ID,
      "shorts_render",
      "completed",
    )
    // The worker re-stamped the current version into fresh render meta.
    expect(readSeededArtifact(ASSET_ID, "shorts-render-meta-v1")).toMatchObject(
      { compositionsVersion: COMPOSITIONS_VERSION },
    )
  })

  it("preserves persisted report fields when a render fails before the snapshot hydrates", async () => {
    // Todo 009: failJob merges ONLY the failure phase via the locked
    // field-level merge — an early failure (context read threw) must not
    // wipe a previously completed short's report.
    jobArtifacts = buildShortsMetadataArtifact({
      domain: "shorts",
      phase: "completed",
      annotation: null,
      hasAudio: true,
      clipDurationSec: 30,
      captionsCount: 2,
      draftVersion: 3,
      lastRenderedDraftVersion: 3,
      lastRenderedPropsHash: "a".repeat(64),
      output: { muxAssetId: "mux-keep", playbackId: "pb-keep", ready: true },
      updatedAt: "2026-06-11T11:00:00.000Z",
    })
    getJobMock.mockRejectedValue(new Error("transient job-state read failure"))

    await expect(runShortsRender({ jobId: JOB_ID })).rejects.toThrow(
      /transient job-state read failure/,
    )

    expect(lastPersistedReport()).toMatchObject({
      phase: "render_failed",
      hasAudio: true,
      captionsCount: 2,
      draftVersion: 3,
      lastRenderedDraftVersion: 3,
      output: { muxAssetId: "mux-keep", playbackId: "pb-keep", ready: true },
    })
    expect(updateJobMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    )
  })

  it("failJob falls back to the local snapshot when the locked merge is unavailable", async () => {
    seedPrepareArtifacts()
    seedDraft(2)
    mergeShortsReportEntryMock.mockRejectedValue(new Error("admin unreachable"))

    await expect(runShortsRender({ jobId: JOB_ID })).rejects.toThrow(
      /admin unreachable/,
    )

    // The wholesale fallback still landed the terminal phase.
    expect(lastPersistedReport()).toMatchObject({ phase: "render_failed" })
    expect(updateJobMock).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({ status: "failed" }),
    )
  })

  it("does not clobber an interim draftVersion mirror written during the render", async () => {
    // Todo 011 (workflow half): the draft route's draftVersion mirror lands
    // while the worker renders; the workflow's completed persist re-reads
    // the current entry inside the lock, so the mirror survives.
    seedPrepareArtifacts()
    seedDraft(2)

    const baseWorkerImpl = runShortsWorkerJobMock.getMockImplementation()
    runShortsWorkerJobMock.mockImplementation(async (input: unknown) => {
      const result = await baseWorkerImpl?.(
        input as Parameters<NonNullable<typeof baseWorkerImpl>>[0],
      )
      // Interleaved writer: mirror draftVersion 9 into the persisted entry
      // (what state.mergeShortsReportEntry does for the draft route).
      const merged = mergeShortsReport(getShortsReport(jobArtifacts), {
        draftVersion: 9,
      })
      jobArtifacts = { ...jobArtifacts, ...buildShortsMetadataArtifact(merged) }
      return result
    })

    await runShortsRender({ jobId: JOB_ID })

    expect(lastPersistedReport()).toMatchObject({
      phase: "completed",
      draftVersion: 9, // interim mirror survived the completed persist
      output: { muxAssetId: "mux-out-1", ready: true },
    })
  })
})
