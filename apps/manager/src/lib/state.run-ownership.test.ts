import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const { backend } = vi.hoisted(() => ({
  backend: { getJob: vi.fn(), updateJob: vi.fn() },
}))
vi.mock("@/config/env", () => ({
  env: { ADMIN_GRAPHQL_URL: "https://admin.test/graphql" },
}))
vi.mock("@/cms/gateway", () => ({
  getCmsGateway: () => ({ mode: "admin" }),
  readMockCmsState: async () => null,
}))
vi.mock("@/backend/admin-client", () => ({
  AdminGraphqlClient: vi.fn(function () {
    return backend
  }),
}))
vi.mock("@/lib/job-events", () => ({ publishJobEvent: vi.fn() }))
import {
  applyJobCallbackUpdate,
  failMastraEnrichmentIfNoCallback,
  markEnrichmentDispatched,
  resetEnrichmentForRerun,
  restampEngine,
} from "@/lib/state"
import { buildInitialSteps } from "@/lib/workflow-steps"

let persisted: JobRecord
beforeEach(() => {
  vi.resetAllMocks()
  persisted = {
    id: "dummy-job",
    muxAssetId: "dummy-asset",
    muxPlaybackId: "dummy-playback",
    languages: ["fr"],
    options: {
      engine: "mastra",
      currentRunId: "old-run",
      dispatchedAt: "2026-10-23T00:00:00.000Z",
      generateVoiceover: true,
      uploadMux: true,
      notifyCms: true,
    },
    status: "pending",
    artifacts: {},
    steps: buildInitialSteps(),
    errors: [],
    retries: 0,
    sourceLanguageCode: "en",
    sourceMediaTitle: "Dummy source",
    createdAt: "",
    updatedAt: "",
  }
  backend.getJob.mockImplementation(async () => structuredClone(persisted))
  // Match Admin's whole-options replacement, never a field-level merge.
  backend.updateJob.mockImplementation(
    async (_id: string, updates: Record<string, unknown>) => {
      Object.assign(persisted, structuredClone(updates))
      return structuredClone(persisted)
    },
  )
})

function holdNextRead() {
  let release!: () => void
  let signal!: () => void
  const reached = new Promise<void>((resolve) => {
    signal = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  backend.getJob.mockImplementationOnce(async () => {
    const snapshot = structuredClone(persisted)
    signal()
    await gate
    return snapshot
  })
  return { reached, release }
}

const oldCallback = () =>
  applyJobCallbackUpdate({
    jobId: "dummy-job",
    runId: "old-run",
    sequence: 2,
    step: "transcription",
    status: "failed",
    error: "old failure",
    jobStatus: "failed",
  })
const oldWatchdog = () =>
  failMastraEnrichmentIfNoCallback("dummy-job", "old-run")

// Release before awaiting both: supports a correctly queued implementation and
// still gives an unlocked writer time to expose the original stale snapshot bug.
async function overlap(
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  const held = holdNextRead()
  const a = first()
  await held.reached
  const b = second()
  await new Promise((resolve) => setTimeout(resolve, 0))
  held.release()
  await Promise.all([a, b])
}

function expectSiblingsPreserved() {
  expect(persisted.options).toMatchObject({
    generateVoiceover: true,
    uploadMux: true,
    notifyCms: true,
  })
  expect(persisted.sourceLanguageCode).toBe("en")
  expect(persisted.sourceMediaTitle).toBe("Dummy source")
  // Omitted materialization fields must not null-clear persisted provenance.
  for (const [, updates] of backend.updateJob.mock.calls) {
    expect(updates).not.toHaveProperty("sourceLanguageCode")
    expect(updates).not.toHaveProperty("sourceMediaTitle")
  }
}

for (const [name, oldUpdate] of [
  ["callback", oldCallback],
  ["watchdog", oldWatchdog],
] as const) {
  describe(`old ${name} versus run ownership`, () => {
    it.each(["old-first", "dispatch-first"])(
      "keeps new dispatch in %s ordering",
      async (order) => {
        const dispatch = () => markEnrichmentDispatched("dummy-job", "new-run")
        await overlap(
          order === "old-first" ? oldUpdate : dispatch,
          order === "old-first" ? dispatch : oldUpdate,
        )
        expect(persisted.options.currentRunId).toBe("new-run")
        expect(persisted.status).toBe("running")
        expect(persisted.options.callbackSequences).toBeUndefined()
        await expect(oldUpdate()).resolves.toMatchObject({
          status: "dropped",
          reason: "stale_run",
        })
        expect(persisted.status).toBe("running")
        expectSiblingsPreserved()
      },
    )

    it.each(["old-first", "reset-first"])(
      "retires old ownership atomically in %s ordering",
      async (order) => {
        const reset = () =>
          resetEnrichmentForRerun("dummy-job", {
            materialization: { kind: "metadata", data: { source: "admin" } },
          })
        await overlap(
          order === "old-first" ? oldUpdate : reset,
          order === "old-first" ? reset : oldUpdate,
        )
        expect(persisted.status).toBe("pending")
        expect(persisted.steps).toMatchObject(buildInitialSteps())
        expect(persisted.errors).toEqual([])
        expect(persisted.options.currentRunId).toBeUndefined()
        expect(persisted.options.dispatchedAt).toBeUndefined()
        expect(persisted.options.callbackSequences).toBeUndefined()
        await expect(oldUpdate()).resolves.toMatchObject({
          status: "dropped",
          reason: "stale_run",
        })
        await restampEngine("dummy-job", "mastra")
        await markEnrichmentDispatched("dummy-job", "new-run")
        await expect(oldUpdate()).resolves.toMatchObject({
          status: "dropped",
          reason: "stale_run",
        })
        expect(persisted.status).toBe("running")
        expect(persisted.steps).toMatchObject(buildInitialSteps())
        expectSiblingsPreserved()
      },
    )

    it.each(["old-first", "stamp-first"])(
      "preserves selected rollback engine in %s ordering",
      async (order) => {
        const stamp = () => restampEngine("dummy-job", "workflow")
        await overlap(
          order === "old-first" ? oldUpdate : stamp,
          order === "old-first" ? stamp : oldUpdate,
        )
        expect(persisted.options.engine).toBe("workflow")
        await expect(oldUpdate()).resolves.toMatchObject({
          status: "dropped",
          reason: "engine_mismatch",
        })
        expectSiblingsPreserved()
      },
    )
  })
}

it.each(["null", "error"])(
  "reports %s restamp persistence failure",
  async (mode) => {
    if (mode === "null") backend.updateJob.mockResolvedValueOnce(null)
    else
      backend.updateJob.mockRejectedValueOnce(new Error("dummy storage down"))
    await expect(restampEngine("dummy-job", "workflow")).resolves.toBeNull()
    expect(persisted.options.engine).toBe("mastra")
  },
)

describe("run-bound callback recovery", () => {
  it("resets failed steps when a different run takes ownership", async () => {
    persisted.status = "failed"
    persisted.steps[0] = {
      ...persisted.steps[0]!,
      name: "transcription",
      status: "failed",
      error: "old failure",
      finishedAt: "old",
      details: { message: "old" },
    }
    persisted.errors = [
      { step: "transcription", message: "old failure", at: "old" },
    ]
    persisted.options.callbackSequences = { transcription: 12 }
    await markEnrichmentDispatched(persisted.id, "new-run")
    await expect(
      applyJobCallbackUpdate({
        jobId: persisted.id,
        runId: "new-run",
        step: "transcription",
        sequence: 1,
        status: "running",
      }),
    ).resolves.toMatchObject({ status: "applied" })
    expect(persisted.errors).toEqual([])
    expect(
      persisted.steps.find((s) => s.name === "transcription")?.error,
    ).toBeFalsy()
  })

  it("treats repeated dispatch of the same run as an idempotent read", async () => {
    persisted.status = "failed"
    persisted.steps[0] = { ...persisted.steps[0]!, status: "failed" }
    persisted.options.callbackSequences = { transcription: 12 }
    const before = structuredClone(persisted)
    await markEnrichmentDispatched(persisted.id, "old-run")
    expect(persisted).toEqual(before)
    expect(backend.updateJob).not.toHaveBeenCalled()
  })

  it("admits correction artifacts and validation only for owned languages", async () => {
    const base = {
      jobId: persisted.id,
      runId: "old-run",
      sequence: 1,
      status: "completed" as const,
    }
    await expect(
      applyJobCallbackUpdate({
        ...base,
        step: "structured_transcript",
        artifactsDelta: [
          "transcript-correction-report",
          "transcript-raw",
          "subtitles-raw",
          "transcript",
          "subtitles",
          "subtitlesVtt",
        ],
      }),
    ).resolves.toMatchObject({ status: "applied" })
    await expect(
      applyJobCallbackUpdate({
        ...base,
        step: "translation",
        artifactsDelta: ["subtitle-validation-fr"],
      }),
    ).resolves.toMatchObject({ status: "applied" })
    await expect(
      applyJobCallbackUpdate({
        ...base,
        sequence: 2,
        step: "translation",
        artifactsDelta: ["subtitle-validation-de"],
      }),
    ).resolves.toMatchObject({ status: "invalid" })
  })
})

it("persists reports and details while keeping language and step authority narrow", async () => {
  const fixtures = (
    await import("../../../../docs/fixtures/manager-enrichment-callbacks.json")
  ).default
  for (const fixture of [
    fixtures.correctionWithSummary,
    fixtures.validationWithSummary,
    fixtures.routingWithSummary,
    fixtures.muxWithSummary,
  ]) {
    const { EnrichmentCallbackSchema } = await import("./enrichment-callback")
    const callback = EnrichmentCallbackSchema.parse(fixture)
    if (callback.status !== "completed")
      throw new Error("fixture must be completed")
    await expect(
      applyJobCallbackUpdate({
        ...callback,
        jobId: persisted.id,
        runId: "old-run",
        details: {
          ...callback.details,
          ...(callback.languageResults
            ? { languageResults: callback.languageResults }
            : {}),
        },
      }),
    ).resolves.toMatchObject({ status: "applied" })
  }
  expect(persisted.artifacts.transcriptionRouting).toMatchObject({
    kind: "metadata",
    data: fixtures.routingWithSummary.reports.transcriptionRouting,
  })
  expect(persisted.artifacts.muxSync).toMatchObject({
    kind: "metadata",
    data: fixtures.muxWithSummary.reports.muxSync,
  })
  expect(
    persisted.steps.find((step) => step.name === "structured_transcript")
      ?.details?.mastra,
  ).toEqual(fixtures.correctionWithSummary.details.mastra)
  await expect(
    applyJobCallbackUpdate({
      jobId: persisted.id,
      runId: "old-run",
      step: "chapters",
      status: "completed",
      sequence: 4,
      reports: fixtures.muxWithSummary.reports as never,
    }),
  ).resolves.toMatchObject({ status: "invalid" })
})

it("recognizes a duplicate terminal callback receipt without reopening the job", async () => {
  const callback = {
    jobId: persisted.id,
    runId: "old-run",
    step: "transcription" as const,
    sequence: 8,
    status: "completed" as const,
    jobStatus: "completed" as const,
  }
  await expect(applyJobCallbackUpdate(callback)).resolves.toMatchObject({
    status: "applied",
  })
  await expect(applyJobCallbackUpdate(callback)).resolves.toMatchObject({
    status: "dropped",
    reason: "stale_sequence",
  })
  expect(persisted.status).toBe("completed")
})

it("does not treat missing job languages as permission for arbitrary language artifacts", async () => {
  persisted.languages = []
  persisted.sourceLanguageCode = undefined
  await expect(
    applyJobCallbackUpdate({
      jobId: persisted.id,
      runId: "old-run",
      step: "translation",
      status: "completed",
      sequence: 1,
      artifactsDelta: ["subtitle-validation-fr"],
    }),
  ).resolves.toMatchObject({ status: "invalid" })
})

it("records source verification only after the current run completes canonical source artifacts", async () => {
  persisted.status = "running"
  persisted.options.enrichmentArtifacts = {
    assetId: "owned-artifacts",
    status: "ready",
    sourceVerified: false,
  }
  await applyJobCallbackUpdate({
    jobId: persisted.id,
    runId: "stale-run",
    sequence: 1,
    step: "transcription",
    status: "completed",
    artifactsDelta: ["transcript", "subtitles"],
  })
  expect(persisted.options.enrichmentArtifacts.sourceVerified).toBe(false)
  await applyJobCallbackUpdate({
    jobId: persisted.id,
    runId: "old-run",
    sequence: 1,
    step: "transcription",
    status: "running",
  })
  expect(persisted.options.enrichmentArtifacts.sourceVerified).toBe(false)
  await applyJobCallbackUpdate({
    jobId: persisted.id,
    runId: "old-run",
    sequence: 2,
    step: "transcription",
    status: "completed",
    artifactsDelta: ["transcript", "subtitles"],
  })
  expect(persisted.options.enrichmentArtifacts.sourceVerified).toBe(true)
  expect(persisted.artifacts.transcript).toEqual({ kind: "downloadable" })
})
