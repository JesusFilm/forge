import type { EnrichmentAdmissionStore } from "../../server/enrichment-admission-store"
function fakeStore(): EnrichmentAdmissionStore {
  return {
    reserve: async () => {},
    claim: async () => "claimed",
    finish: async () => {},
  }
}
import { describe, expect, it, vi } from "vitest"

import {
  ForgeVideoEnrichmentWorkflowError,
  forgeVideoEnrichmentWorkflow,
  handleForgeVideoEnrichmentRouteRequest,
  handleForgeVideoEnrichmentStartRouteRequest,
  launchForgeVideoEnrichmentWorkflow,
  type ForgeVideoEnrichmentInput,
} from "./forge-video-enrichment"

const validInput = {
  jobId: "job-1",
  assetId: "asset-1",
  muxAssetId: "mux-1",
  translateTo: ["fr"],
}

describe("forge video enrichment route", () => {
  it("accepts and preserves the full current Manager caller shape through start", async () => {
    const input = {
      ...validInput,
      playbackId: "playback-1",
      language: "en",
      runSceneAnalysis: false,
      runAudioCleanup: false,
      videoTitle: "Dummy source title",
      videoLabel: "clip",
      bibleVerses: ["John 3:16"],
      videoDocumentId: "video-1",
      requestedTranscriptionProvider: "automatic" as const,
      initialArtifacts: {
        transcript: { kind: "downloadable" as const },
        materialization: {
          kind: "metadata" as const,
          data: { sourceLanguageCode: "en" },
        },
      },
    }
    const auth = {
      authHeader: "Bearer dummy-key",
      serviceKeys: ["dummy-key"],
      configured: true,
    }
    const accepted = await handleForgeVideoEnrichmentRouteRequest({
      store: fakeStore(),
      ...auth,
      readJson: async () => input,
    })
    expect(accepted.status).toBe(202)
    const start = vi.fn(() => new Promise<never>(() => {}))
    const createRun = vi.fn(async () => ({ start }))
    const launch = vi.fn(
      (parsed: ForgeVideoEnrichmentInput, options: { runId: string }) =>
        launchForgeVideoEnrichmentWorkflow(parsed, { ...options, createRun }),
    )
    const started = await handleForgeVideoEnrichmentStartRouteRequest({
      store: fakeStore(),
      admit: async () => {},
      ...auth,
      readJson: async () => ({ runId: accepted.body.runId, input }),
      launch,
    })
    expect(started.status).toBe(202)
    expect(launch).toHaveBeenCalledWith(input, { runId: accepted.body.runId })
    expect(start).toHaveBeenCalledWith({ inputData: input })
    for (const invalid of [
      { ...input, unknown: true },
      { ...input, videoTitle: 42 },
    ]) {
      expect(
        (
          await handleForgeVideoEnrichmentRouteRequest({
            ...auth,
            readJson: async () => invalid,
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await handleForgeVideoEnrichmentStartRouteRequest({
            ...auth,
            readJson: async () => ({
              runId: accepted.body.runId,
              input: invalid,
            }),
            launch,
          })
        ).status,
      ).toBe(400)
    }
    expect(launch).toHaveBeenCalledTimes(1)
  })

  it("requires the enrichment-specific receiver key to be configured", async () => {
    const outcome = await handleForgeVideoEnrichmentRouteRequest({
      store: fakeStore(),
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: false,
      readJson: async () => validInput,
    })

    expect(outcome).toMatchObject({
      status: 503,
      body: { error: expect.stringContaining("MASTRA_ENRICHMENT_API_KEYS") },
    })
  })

  it("requires Manager callback credentials before accepting enrichment work", async () => {
    const outcome = await handleForgeVideoEnrichmentRouteRequest({
      store: fakeStore(),
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: true,
      callbackConfigured: false,
      readJson: async () => validInput,
    })

    expect(outcome).toMatchObject({
      status: 503,
      body: {
        error: expect.stringContaining("MANAGER_ENRICHMENT_CALLBACK_URL"),
      },
    })
  })

  it("rejects invalid bearer tokens", async () => {
    const outcome = await handleForgeVideoEnrichmentRouteRequest({
      store: fakeStore(),
      authHeader: "Bearer wrong",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => validInput,
    })

    expect(outcome.status).toBe(401)
  })

  it("acks with a server-minted run id before the workflow starts", async () => {
    const outcome = await handleForgeVideoEnrichmentRouteRequest({
      store: fakeStore(),
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => validInput,
    })

    expect(outcome.status).toBe(202)
    expect(outcome.body).toMatchObject({ ok: true, runId: expect.any(String) })
  })

  it("starts an accepted run when Manager posts the persisted run id", async () => {
    const launch = vi.fn(
      async (
        _input: ForgeVideoEnrichmentInput,
        options: { runId: string },
      ) => ({
        ok: true as const,
        jobId: "job-1",
        runId: options.runId,
        acceptedAt: "2026-05-31T00:00:00.000Z",
      }),
    )

    const outcome = await handleForgeVideoEnrichmentStartRouteRequest({
      store: fakeStore(),
      admit: async () => {},
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => ({ runId: "run-1", input: validInput }),
      launch,
    })

    expect(outcome.status).toBe(202)
    expect(outcome.body).toEqual({ ok: true, runId: "run-1" })
    expect(launch).toHaveBeenCalledWith(validInput, { runId: "run-1" })
  })

  it("returns a retryable failure if the workflow cannot start the run", async () => {
    const launch = vi.fn(async () => {
      throw new Error("storage down")
    })

    const outcome = await handleForgeVideoEnrichmentStartRouteRequest({
      store: fakeStore(),
      admit: async () => {},
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => ({ runId: "run-1", input: validInput }),
      launch,
    })

    expect(outcome).toEqual({
      status: 502,
      body: { error: "forge-video-enrichment workflow failed to start" },
    })
  })
})

describe("forge video enrichment workflow", () => {
  it("is committed for Studio/runtime registration", () => {
    expect(forgeVideoEnrichmentWorkflow.committed).toBe(true)
  })

  it("acks after createRun and schedules the workflow in the background", async () => {
    const start = vi.fn(() => new Promise<never>(() => {}))
    const createRun = vi.fn(async () => ({ start }))

    await expect(
      launchForgeVideoEnrichmentWorkflow(validInput, {
        runId: "run-1",
        createRun,
        now: () => "2026-05-31T00:00:00.000Z",
      }),
    ).resolves.toEqual({
      ok: true,
      jobId: "job-1",
      runId: "run-1",
      acceptedAt: "2026-05-31T00:00:00.000Z",
    })

    expect(createRun).toHaveBeenCalledWith({ runId: "run-1" })
    expect(start).toHaveBeenCalledWith({ inputData: validInput })
  })

  it("reports a sync start failure before acking the route", async () => {
    const createRun = vi.fn(async () => ({
      start: () => {
        throw new Error("runner unavailable")
      },
    }))

    await expect(
      launchForgeVideoEnrichmentWorkflow(validInput, {
        runId: "run-1",
        createRun,
      }),
    ).rejects.toBeInstanceOf(ForgeVideoEnrichmentWorkflowError)
  })
})
