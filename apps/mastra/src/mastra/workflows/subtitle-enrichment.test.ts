import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  handleSubtitleEnrichmentRouteRequest,
  runSubtitleEnrichmentWorkflow,
  subtitleEnrichmentRunId,
  _internals,
  type SubtitleEnrichmentRunRequest,
} from "./subtitle-enrichment"

const validSubtitleRunRequest: SubtitleEnrichmentRunRequest = {
  jobId: "job-1",
  videoDocumentId: "video-1",
  assetId: "asset-1",
  muxAssetId: "mux-asset-1",
  muxPlaybackId: "mux-playback-1",
  sourceLanguage: "en",
  targetLanguage: "fr",
  materialization: {
    mode: "direct_mux_asset_reuse",
    targetEnvironment: "mux-production",
  },
  requestedTranscriptionProvider: "automatic",
  requestedBy: { kind: "service", id: "manager" },
  idempotencyKey: "manager:job-1:subtitle:fr",
}

describe("subtitle enrichment Mastra workflow", () => {
  beforeEach(() => {
    _internals.clearIdempotencyCache()
  })

  it("queues a subtitle run with a deterministic Mastra run id", async () => {
    await expect(
      runSubtitleEnrichmentWorkflow(validSubtitleRunRequest),
    ).resolves.toEqual({
      ok: true,
      mastraRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
      managerJobId: "job-1",
      status: "queued",
      summary: "Subtitle enrichment run queued.",
    })
  })

  it("emits prototype progress events to Manager with the Mastra callback credential", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }))

    await expect(
      runSubtitleEnrichmentWorkflow(validSubtitleRunRequest, {
        runId: "subtitle-run-1",
        managerBaseUrl: "https://manager.internal",
        managerMastraApiKey: "manager-callback-key",
        fetcher,
      }),
    ).resolves.toMatchObject({
      ok: true,
      mastraRunId: "subtitle-run-1",
    })

    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(fetcher).toHaveBeenCalledWith(
      "https://manager.internal/api/mastra/subtitle-enrichment-runs/subtitle-run-1/events",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer manager-callback-key",
        }),
        body: expect.stringContaining('"type":"workflow_started"'),
      }),
    )
  })

  it("returns manager_unavailable when callback delivery fails", async () => {
    await expect(
      runSubtitleEnrichmentWorkflow(validSubtitleRunRequest, {
        runId: "subtitle-run-1",
        managerBaseUrl: "https://manager.internal",
        managerMastraApiKey: "manager-callback-key",
        fetcher: vi.fn(async () => new Response("no", { status: 503 })),
      }),
    ).resolves.toEqual({
      ok: false,
      code: "manager_unavailable",
      message: "Manager subtitle event callback was unavailable.",
    })
  })

  it("rejects invalid service bearer tokens before launch", async () => {
    const launcher = vi.fn()
    const outcome = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer wrong",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })

    expect(outcome.status).toBe(401)
    expect(outcome.body).toEqual({ error: "Service bearer required" })
    expect(launcher).not.toHaveBeenCalled()
  })

  it("validates payloads before launching", async () => {
    const launcher = vi.fn()
    const outcome = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({
        ...validSubtitleRunRequest,
        materialization: { mode: "unknown" },
      }),
      launch: launcher,
    })

    expect(outcome.status).toBe(400)
    expect(outcome.body).toMatchObject({
      result: { ok: false, code: "invalid_request" },
    })
    expect(launcher).not.toHaveBeenCalled()
  })

  it("launches valid subtitle runs with idempotency", async () => {
    const launcher = vi.fn(async () => ({
      ok: true as const,
      mastraRunId: subtitleEnrichmentRunId(
        validSubtitleRunRequest.idempotencyKey,
      ),
      managerJobId: "job-1",
      status: "queued" as const,
      summary: "Subtitle enrichment run queued.",
    }))

    const outcome = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })

    expect(outcome.status).toBe(202)
    expect(launcher).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        targetLanguage: "fr",
        idempotencyKey: "manager:job-1:subtitle:fr",
      }),
      { runId: "subtitle-enrichment:manager:job-1:subtitle:fr" },
    )
    expect(outcome.body).toMatchObject({
      result: {
        ok: true,
        managerJobId: "job-1",
      },
    })
  })

  it("returns the stable result for duplicate idempotency keys with the same payload", async () => {
    const launcher = vi.fn(async () => ({
      ok: true as const,
      mastraRunId: subtitleEnrichmentRunId(
        validSubtitleRunRequest.idempotencyKey,
      ),
      managerJobId: "job-1",
      status: "queued" as const,
      summary: "Subtitle enrichment run queued.",
    }))

    const first = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })
    const second = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })

    expect(first.status).toBe(202)
    expect(second.status).toBe(202)
    expect(launcher).toHaveBeenCalledTimes(1)
    expect(second.body).toMatchObject({
      result: {
        ok: true,
        mastraRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
      },
    })
  })

  it("rejects duplicate idempotency keys with different payloads", async () => {
    const launcher = vi.fn(async () => ({
      ok: true as const,
      mastraRunId: subtitleEnrichmentRunId(
        validSubtitleRunRequest.idempotencyKey,
      ),
      managerJobId: "job-1",
      status: "queued" as const,
      summary: "Subtitle enrichment run queued.",
    }))

    await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })
    const conflict = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => ({
        ...validSubtitleRunRequest,
        targetLanguage: "es",
      }),
      launch: launcher,
    })

    expect(conflict.status).toBe(409)
    expect(conflict.body).toMatchObject({
      result: { ok: false, code: "idempotency_conflict" },
    })
  })

  it("does not cache transient launch failures for the same idempotency key", async () => {
    const launcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        code: "manager_unavailable",
        message: "Manager subtitle event callback was unavailable.",
      })
      .mockResolvedValueOnce({
        ok: true,
        mastraRunId: subtitleEnrichmentRunId(
          validSubtitleRunRequest.idempotencyKey,
        ),
        managerJobId: "job-1",
        status: "queued",
        summary: "Subtitle enrichment run queued.",
      })

    const first = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })
    const second = await handleSubtitleEnrichmentRouteRequest({
      authHeader: "Bearer service-key",
      serviceKeys: ["service-key"],
      readJson: async () => validSubtitleRunRequest,
      launch: launcher,
    })

    expect(first.status).toBe(502)
    expect(second.status).toBe(202)
    expect(launcher).toHaveBeenCalledTimes(2)
  })
})
