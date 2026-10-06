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
  it("authenticates and validates before launching the same resumable build path", async () => {
    const launch = vi.fn().mockResolvedValue("run-one")
    expect(
      await handlePrecomputedCatalogRouteRequest({
        authHeader: null,
        serviceKeys: ["secret"],
        request: request(body),
        launch,
      }),
    ).toMatchObject({ status: 401 })
    expect(launch).not.toHaveBeenCalled()
    expect(
      await handlePrecomputedCatalogRouteRequest({
        authHeader: "Bearer secret",
        serviceKeys: ["secret"],
        request: request({ ...body, sql: "SELECT * FROM users" }),
        launch,
      }),
    ).toMatchObject({ status: 400 })
    expect(launch).not.toHaveBeenCalled()
    expect(
      await handlePrecomputedCatalogRouteRequest({
        authHeader: "Bearer secret",
        serviceKeys: ["secret"],
        request: request(body),
        launch,
      }),
    ).toMatchObject({
      status: 202,
      body: { runId: "run-one", generationId: body.generationId },
    })
    expect(launch).toHaveBeenCalledExactlyOnceWith(body)
  })

  it("stamps private catalog trace identity independently of snapshots", async () => {
    const startAsync = vi.fn().mockResolvedValue({ runId: "run-one" })
    const createRun = vi
      .spyOn(precomputedCatalogGenerationWorkflow, "createRun")
      .mockResolvedValue({ startAsync } as never)
    try {
      expect(
        await handlePrecomputedCatalogRouteRequest({
          authHeader: "Bearer secret",
          serviceKeys: ["secret"],
          request: request(body),
        }),
      ).toMatchObject({ status: 202 })
      expect(startAsync).toHaveBeenCalledWith({
        inputData: body,
        tracingOptions: {
          hideInput: true,
          hideOutput: true,
          metadata: {
            precomputedGenerationId: body.generationId,
            precomputedInputCutoff: body.inputCutoff,
            precomputedHistoryRequired: true,
          },
        },
      })
    } finally {
      createRun.mockRestore()
    }
  })
})
