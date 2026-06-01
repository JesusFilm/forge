import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateServiceBearerRequestMock,
  getRuntimeEnrichmentEngineOverrideMock,
  isMastraEnrichmentRampEnabledMock,
  resolveEnrichmentEngineMock,
  setRuntimeEnrichmentEngineOverrideMock,
} = vi.hoisted(() => ({
  authenticateServiceBearerRequestMock: vi.fn(),
  getRuntimeEnrichmentEngineOverrideMock: vi.fn(),
  isMastraEnrichmentRampEnabledMock: vi.fn(),
  resolveEnrichmentEngineMock: vi.fn(),
  setRuntimeEnrichmentEngineOverrideMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateServiceBearerRequest: authenticateServiceBearerRequestMock,
}))

vi.mock("@/lib/enrichment-engine", () => ({
  getRuntimeEnrichmentEngineOverride: getRuntimeEnrichmentEngineOverrideMock,
  isMastraEnrichmentRampEnabled: isMastraEnrichmentRampEnabledMock,
  resolveEnrichmentEngine: resolveEnrichmentEngineMock,
  setRuntimeEnrichmentEngineOverride: setRuntimeEnrichmentEngineOverrideMock,
}))

import { GET, PUT } from "@/app/api/admin/engine-flag/route"
import type { EnrichmentEngine } from "@/types/job"

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("https://manager.test/api/admin/engine-flag", {
    method,
    headers: {
      authorization: "Bearer manager-key",
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe("/api/admin/engine-flag", () => {
  let override: EnrichmentEngine | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    override = undefined
    authenticateServiceBearerRequestMock.mockReturnValue(null)
    getRuntimeEnrichmentEngineOverrideMock.mockImplementation(() => override)
    isMastraEnrichmentRampEnabledMock.mockReturnValue(true)
    setRuntimeEnrichmentEngineOverrideMock.mockImplementation(
      (engine: EnrichmentEngine | undefined) => {
        override = engine
      },
    )
    resolveEnrichmentEngineMock.mockImplementation(async () => {
      return override ?? "workflow"
    })
  })

  it("requires the Manager service bearer", async () => {
    authenticateServiceBearerRequestMock.mockReturnValueOnce(
      Response.json(
        { error: "Service bearer token required" },
        { status: 403 },
      ),
    )

    const response = await GET(request("GET"))

    expect(response.status).toBe(403)
    expect(resolveEnrichmentEngineMock).not.toHaveBeenCalled()
  })

  it("returns the resolved engine and current override", async () => {
    override = "mastra"

    const response = await GET(request("GET"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      engine: "mastra",
      override: "mastra",
    })
  })

  it("sets the runtime override to mastra", async () => {
    const response = await PUT(request("PUT", { engine: "mastra" }))

    expect(response.status).toBe(200)
    expect(setRuntimeEnrichmentEngineOverrideMock).toHaveBeenCalledWith(
      "mastra",
    )
    await expect(response.json()).resolves.toEqual({
      engine: "mastra",
      override: "mastra",
    })
  })

  it("rejects mastra override while the Mastra ramp guard is disabled", async () => {
    isMastraEnrichmentRampEnabledMock.mockReturnValueOnce(false)

    const response = await PUT(request("PUT", { engine: "mastra" }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error:
        "Mastra enrichment ramp is disabled until the Mastra workflow emits Manager callbacks.",
      code: "mastra_ramp_disabled",
    })
    expect(setRuntimeEnrichmentEngineOverrideMock).not.toHaveBeenCalled()
  })

  it("sets the runtime override to workflow", async () => {
    const response = await PUT(request("PUT", { engine: "workflow" }))

    expect(response.status).toBe(200)
    expect(setRuntimeEnrichmentEngineOverrideMock).toHaveBeenCalledWith(
      "workflow",
    )
    await expect(response.json()).resolves.toEqual({
      engine: "workflow",
      override: "workflow",
    })
  })

  it("clears the runtime override", async () => {
    override = "mastra"

    const response = await PUT(request("PUT", { clearOverride: true }))

    expect(response.status).toBe(200)
    expect(setRuntimeEnrichmentEngineOverrideMock).toHaveBeenCalledWith(
      undefined,
    )
    await expect(response.json()).resolves.toEqual({
      engine: "workflow",
      override: null,
    })
  })

  it("rejects invalid JSON bodies", async () => {
    const response = await PUT(
      new Request("https://manager.test/api/admin/engine-flag", {
        method: "PUT",
        headers: {
          authorization: "Bearer manager-key",
          "content-type": "application/json",
        },
        body: "{bad-json",
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    })
  })

  it("rejects invalid update bodies", async () => {
    const response = await PUT(request("PUT", {}))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "Validation failed",
    })
    expect(setRuntimeEnrichmentEngineOverrideMock).not.toHaveBeenCalled()
  })
})
