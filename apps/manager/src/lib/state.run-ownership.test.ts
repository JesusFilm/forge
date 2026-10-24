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
