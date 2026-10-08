import { describe, expect, it, vi } from "vitest"

import {
  handlePrecomputedCatalogRouteRequest,
  precomputedCatalogGenerationWorkflow,
} from "./precomputed-catalog-generation"

const body = {
  generationId: "catalog-2026-10-06",
  inputCutoff: "2026-10-06T00:00:00.000Z",
  historyRequired: true,
  capacity: {
    measuredAt: "2026-10-06T00:01:00.000Z",
    clusterSystemId: "1234567890",
    observedDbBytes: 1_000_000,
    availableBytes: 2_000_000,
    reserveBytes: 500_000,
    projectedBytes: 1_000_000,
    sampleSourceCount: 1,
    sampleBytes: 1000,
    source: "operator_verified_pgdata_df",
  },
}
function request(value: unknown) {
  return new Request(
    "https://mastra.example/forge-precomputed-catalog-generation",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    },
  )
}

describe("private catalog build entrypoint", () => {
  it("requires a local operator before parsing or creating a hosted workflow", async () => {
    const createRun = vi
      .spyOn(precomputedCatalogGenerationWorkflow, "createRun")
      .mockRejectedValue(new Error("hosted_workflow_creation_attempted"))
    try {
      const unauthorized = request(body)
      expect(
        await handlePrecomputedCatalogRouteRequest({
          authHeader: null,
          serviceKeys: ["secret"],
          request: unauthorized,
        }),
      ).toMatchObject({ status: 401 })
      expect(unauthorized.bodyUsed).toBe(false)

      for (const value of [
        body,
        { ...body, manualOperator: true, backend: "codex_subscription" },
      ]) {
        const hosted = request(value)
        expect(
          await handlePrecomputedCatalogRouteRequest({
            authHeader: "Bearer secret",
            serviceKeys: ["secret"],
            request: hosted,
          }),
        ).toEqual({
          status: 403,
          body: {
            error: "local_manual_operator_required",
            message:
              "Start or resume this generation from a local operator session.",
          },
        })
        expect(hosted.bodyUsed).toBe(false)
      }
      expect(createRun).not.toHaveBeenCalled()
    } finally {
      createRun.mockRestore()
    }
  })
})
