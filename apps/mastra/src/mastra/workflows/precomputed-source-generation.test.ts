import { describe, expect, it, vi } from "vitest"

import { isAstraAccessFailure } from "../../services/precomputed-recommendations/astra-provider"
import {
  handlePrecomputedSourceRouteRequest,
  precomputedSourceGenerationWorkflow,
} from "./precomputed-source-generation"

function request(body: unknown) {
  return new Request(
    "https://mastra.example/forge-precomputed-source-generation",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("private Astra source route", () => {
  const body = {
    generationId: "test-generation",
    sourceVideoId: "test-source",
    inputCutoff: "2026-10-05T00:00:00.000Z",
  }

  it("authenticates before parsing and only launches structured source inputs", async () => {
    const launch = vi.fn().mockResolvedValue("run-one")
    expect(
      await handlePrecomputedSourceRouteRequest({
        authHeader: null,
        serviceKeys: ["secret"],
        request: request(body),
        launch,
      }),
    ).toMatchObject({ status: 401 })
    expect(launch).not.toHaveBeenCalled()
    expect(
      await handlePrecomputedSourceRouteRequest({
        authHeader: "Bearer secret",
        serviceKeys: ["secret"],
        request: request({
          ...body,
          historyRequired: true,
          sql: "CREATE TABLE exported AS SELECT * FROM events",
        }),
        launch,
      }),
    ).toMatchObject({ status: 400 })
    expect(launch).not.toHaveBeenCalled()
    expect(
      await handlePrecomputedSourceRouteRequest({
        authHeader: "Bearer secret",
        serviceKeys: ["secret"],
        request: request({ ...body, sourceVideoId: "" }),
        launch,
      }),
    ).toMatchObject({ status: 400 })
    expect(
      await handlePrecomputedSourceRouteRequest({
        authHeader: "Bearer secret",
        serviceKeys: ["secret"],
        request: request(body),
        launch,
      }),
    ).toMatchObject({
      status: 202,
      body: { runId: "run-one", generationId: "test-generation" },
    })
    expect(launch).toHaveBeenCalledOnce()
  })

  it("recognizes project/model access errors without returning raw provider data", () => {
    expect(
      isAstraAccessFailure({
        statusCode: 401,
        responseBody: "private details",
      }),
    ).toBe(true)
    expect(isAstraAccessFailure({ statusCode: 404 })).toBe(true)
    expect(isAstraAccessFailure({ code: "model_not_found" })).toBe(true)
    expect(isAstraAccessFailure({ statusCode: 429 })).toBe(false)
  })

  it("stamps private root-trace identity without retaining trace input or output", async () => {
    const startAsync = vi.fn().mockResolvedValue({ runId: "run-one" })
    const createRun = vi
      .spyOn(precomputedSourceGenerationWorkflow, "createRun")
      .mockResolvedValue({ startAsync } as never)
    try {
      expect(
        await handlePrecomputedSourceRouteRequest({
          authHeader: "Bearer secret",
          serviceKeys: ["secret"],
          request: request(body),
        }),
      ).toMatchObject({ status: 202 })
      expect(startAsync).toHaveBeenCalledWith({
        inputData: { ...body, historyRequired: false },
        tracingOptions: {
          hideInput: true,
          hideOutput: true,
          metadata: {
            precomputedGenerationId: body.generationId,
            precomputedInputCutoff: body.inputCutoff,
            precomputedHistoryRequired: false,
          },
        },
      })
    } finally {
      createRun.mockRestore()
    }
  })
})
