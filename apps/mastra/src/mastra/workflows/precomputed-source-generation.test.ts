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

  it("requires a local operator before parsing or creating a hosted workflow", async () => {
    const createRun = vi
      .spyOn(precomputedSourceGenerationWorkflow, "createRun")
      .mockRejectedValue(new Error("hosted_workflow_creation_attempted"))
    try {
      const unauthorized = request(body)
      expect(
        await handlePrecomputedSourceRouteRequest({
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
          await handlePrecomputedSourceRouteRequest({
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
