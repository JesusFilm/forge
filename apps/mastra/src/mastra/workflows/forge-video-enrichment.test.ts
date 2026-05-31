import { describe, expect, it, vi } from "vitest"

import {
  ForgeVideoEnrichmentWorkflowError,
  forgeVideoEnrichmentWorkflow,
  handleForgeVideoEnrichmentRouteRequest,
  launchForgeVideoEnrichmentWorkflow,
  reportForgeVideoEnrichmentNotImplemented,
  type ForgeVideoEnrichmentInput,
} from "./forge-video-enrichment"

const validInput = {
  jobId: "job-1",
  assetId: "asset-1",
  muxAssetId: "mux-1",
  translateTo: ["fr"],
}

describe("forge video enrichment route", () => {
  it("requires the enrichment-specific receiver key to be configured", async () => {
    const outcome = await handleForgeVideoEnrichmentRouteRequest({
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
      authHeader: "Bearer wrong",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => validInput,
    })

    expect(outcome.status).toBe(401)
  })

  it("acks with a server-minted run id after the workflow accepts the run", async () => {
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

    const outcome = await handleForgeVideoEnrichmentRouteRequest({
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => validInput,
      launch,
    })

    expect(outcome.status).toBe(202)
    expect(outcome.body).toMatchObject({ ok: true, runId: expect.any(String) })
    expect(launch).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledWith(
      validInput,
      expect.objectContaining({ runId: outcome.body.runId }),
    )
  })

  it("returns a retryable failure if the workflow cannot accept the run", async () => {
    const launch = vi.fn(async () => {
      throw new Error("storage down")
    })

    const outcome = await handleForgeVideoEnrichmentRouteRequest({
      authHeader: "Bearer key",
      serviceKeys: ["key"],
      configured: true,
      readJson: async () => validInput,
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

  it("emits a safe failed callback until the real graph is ported", async () => {
    const sendCallback = vi.fn(async () => {})

    await expect(
      reportForgeVideoEnrichmentNotImplemented(
        {
          ok: true,
          jobId: "job-1",
          runId: "run-1",
          acceptedAt: "2026-05-31T00:00:00.000Z",
        },
        sendCallback,
      ),
    ).rejects.toThrow(
      "Mastra video enrichment workflow graph is not implemented",
    )

    expect(sendCallback).toHaveBeenCalledTimes(2)
    expect(sendCallback).toHaveBeenNthCalledWith(1, {
      jobId: "job-1",
      engine: "mastra",
      runId: "run-1",
      sequence: 1,
      status: "running",
      step: "transcription",
    })
    expect(sendCallback).toHaveBeenNthCalledWith(2, {
      jobId: "job-1",
      engine: "mastra",
      runId: "run-1",
      sequence: 2,
      status: "failed",
      step: "transcription",
      error: "Mastra video enrichment workflow graph is not implemented yet",
      jobStatus: "failed",
    })
  })
})
