import { describe, expect, it, vi } from "vitest"

import {
  dispatchMastraVideoEnrichment,
  startMastraVideoEnrichment,
} from "@/services/mastra-enrichment"
import type { VideoEnrichmentInput } from "@/workflows/videoEnrichment"

const input: VideoEnrichmentInput = {
  jobId: "job-1",
  assetId: "asset-1",
  muxAssetId: "mux-1",
  translateTo: ["fr"],
}

describe("dispatchMastraVideoEnrichment", () => {
  it("returns config_missing when Mastra dispatch env is absent", async () => {
    await expect(
      dispatchMastraVideoEnrichment(input, { baseUrl: "", bearer: "" }),
    ).resolves.toEqual({ ok: false, reason: "config_missing" })
  })

  it("posts the enrichment payload and reads the run id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, runId: "run-1" }, { status: 202 }),
    ) as unknown as typeof fetch

    await expect(
      dispatchMastraVideoEnrichment(input, {
        baseUrl: "https://mastra.internal",
        bearer: "secret",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, runId: "run-1" })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("/forge-video-enrichment", "https://mastra.internal"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer secret",
          "content-type": "application/json",
        }),
        body: JSON.stringify(input),
      }),
    )
  })

  it("maps a 401 response to auth_failed", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "nope" }, { status: 401 }),
    ) as unknown as typeof fetch

    await expect(
      dispatchMastraVideoEnrichment(input, {
        baseUrl: "https://mastra.internal",
        bearer: "secret",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, reason: "auth_failed", status: 401 })
  })

  it("starts the accepted run with the persisted run id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, runId: "run-1" }, { status: 202 }),
    ) as unknown as typeof fetch

    await expect(
      startMastraVideoEnrichment(input, "run-1", {
        baseUrl: "https://mastra.internal",
        bearer: "secret",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, runId: "run-1" })

    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("/forge-video-enrichment/start", "https://mastra.internal"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ runId: "run-1", input }),
      }),
    )
  })

  it("rejects a start ack for a different run id", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ ok: true, runId: "run-2" }, { status: 202 }),
    ) as unknown as typeof fetch

    await expect(
      startMastraVideoEnrichment(input, "run-1", {
        baseUrl: "https://mastra.internal",
        bearer: "secret",
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: false, reason: "invalid_response" })
  })
})
