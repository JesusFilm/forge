import { describe, expect, it, vi } from "vitest"

import { createSubtitleEnrichmentRunRoute } from "./subtitle-enrichment-run"

const validSubtitleRunRequest = {
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
  requestedBy: { kind: "service", id: "manager" },
  idempotencyKey: "manager:job-1:subtitle:fr",
}

function jsonRequest(input: unknown, headers: HeadersInit = {}) {
  return new Request("http://localhost:4111/forge/subtitle-enrichment-runs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer service-key",
      ...headers,
    },
    body: JSON.stringify(input),
  })
}

describe("subtitle enrichment run API route", () => {
  it("rejects invalid service bearer tokens before workflow launch", async () => {
    const launcher = vi.fn()
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: launcher,
    })

    const response = await route.handler(
      jsonRequest(validSubtitleRunRequest, {
        authorization: "Bearer wrong-key",
      }),
    )

    expect(response.status).toBe(401)
    expect(launcher).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "unauthorized",
    })
  })

  it("rejects malformed payloads before workflow launch", async () => {
    const launcher = vi.fn()
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: launcher,
    })

    const response = await route.handler(
      jsonRequest({ ...validSubtitleRunRequest, jobId: "" }),
    )

    expect(response.status).toBe(400)
    expect(launcher).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_request",
    })
  })

  it("launches valid subtitle runs with idempotency key", async () => {
    const launcher = vi.fn().mockResolvedValue({
      ok: true,
      agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
      managerJobId: "job-1",
      status: "queued",
      summary: "Subtitle enrichment run queued.",
    })
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: launcher,
    })

    const response = await route.handler(jsonRequest(validSubtitleRunRequest))

    expect(response.status).toBe(202)
    expect(launcher).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        targetLanguage: "fr",
        idempotencyKey: "manager:job-1:subtitle:fr",
      }),
      undefined,
    )
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      managerJobId: "job-1",
    })
  })

  it("returns the stable result for duplicate idempotency keys with the same payload", async () => {
    const launcher = vi.fn().mockResolvedValue({
      ok: true,
      agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
      managerJobId: "job-1",
      status: "queued",
      summary: "Subtitle enrichment run queued.",
    })
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: launcher,
    })

    const firstResponse = await route.handler(
      jsonRequest(validSubtitleRunRequest),
    )
    const secondResponse = await route.handler(
      jsonRequest(validSubtitleRunRequest),
    )

    expect(firstResponse.status).toBe(202)
    expect(secondResponse.status).toBe(202)
    expect(launcher).toHaveBeenCalledTimes(1)
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
    })
  })

  it("rejects duplicate idempotency keys with different payloads", async () => {
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: vi.fn().mockResolvedValue({
        ok: true,
        agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
        managerJobId: "job-1",
        status: "queued",
        summary: "Subtitle enrichment run queued.",
      }),
    })

    const firstResponse = await route.handler(
      jsonRequest(validSubtitleRunRequest),
    )
    const secondResponse = await route.handler(
      jsonRequest({
        ...validSubtitleRunRequest,
        targetLanguage: "es",
      }),
    )

    expect(firstResponse.status).toBe(202)
    expect(secondResponse.status).toBe(409)
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: false,
      code: "idempotency_conflict",
    })
  })

  it("maps unexpected workflow launch failures to the runtime error contract", async () => {
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: vi.fn().mockRejectedValue(new Error("boom")),
    })

    const response = await route.handler(jsonRequest(validSubtitleRunRequest))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "mastra_runtime_error",
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
        agenticRunId: "subtitle-enrichment:manager:job-1:subtitle:fr",
        managerJobId: "job-1",
        status: "queued",
        summary: "Subtitle enrichment run queued.",
      })
    const route = createSubtitleEnrichmentRunRoute({
      serviceApiKey: "service-key",
      launchRun: launcher,
    })

    const firstResponse = await route.handler(
      jsonRequest(validSubtitleRunRequest),
    )
    const secondResponse = await route.handler(
      jsonRequest(validSubtitleRunRequest),
    )

    expect(firstResponse.status).toBe(502)
    expect(secondResponse.status).toBe(202)
    expect(launcher).toHaveBeenCalledTimes(2)
    await expect(secondResponse.json()).resolves.toMatchObject({
      ok: true,
      managerJobId: "job-1",
    })
  })
})
