import { describe, expect, it, vi } from "vitest"

import {
  forgeVideoEnrichmentWorkflow,
  handleForgeVideoEnrichmentRouteRequest,
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
})
