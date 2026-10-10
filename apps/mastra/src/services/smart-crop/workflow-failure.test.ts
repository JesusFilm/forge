import { describe, expect, it } from "vitest"

import { SmartCropProviderError } from "./openrouter-vision"
import {
  SmartCropWorkflowFailureSchema,
  smartCropFailureFromError,
  smartCropFailureFromRunResult,
  smartCropRouteStatus,
  type SmartCropWorkflowFailure,
} from "./workflow-failure"

const PREFIX = "SMART_CROP_PLAN_WORKFLOW_FAILED:"
const rateLimitedFailure: SmartCropWorkflowFailure = {
  ok: false,
  reason: "provider_rate_limited",
  retryable: false,
  message: "smart crop vision rate limited after 3 attempts (status 429)",
  mastraRunId: "run-rate-limited",
}

function serializedFailure(failure = rateLimitedFailure) {
  return {
    name: "SmartCropWorkflowFailureError",
    message: `Step failed: ${PREFIX}${JSON.stringify(failure)}`,
  }
}

describe("smart crop workflow failures", () => {
  it("accepts terminal rate limits and maps them to service unavailable", () => {
    expect(SmartCropWorkflowFailureSchema.parse(rateLimitedFailure)).toEqual(
      rateLimitedFailure,
    )
    expect(smartCropRouteStatus(rateLimitedFailure)).toBe(503)
    expect(
      SmartCropWorkflowFailureSchema.safeParse({
        ...rateLimitedFailure,
        retryable: true,
      }).success,
    ).toBe(false)
  })

  it("keeps top-level WorkflowResult error extraction", () => {
    const result = {
      status: "failed",
      input: {},
      steps: {},
      error: new Error(serializedFailure().message),
    }

    expect(smartCropFailureFromRunResult(PREFIX, result)).toEqual(
      rateLimitedFailure,
    )
  })

  it("extracts a serialized failure from a realistic failed step", () => {
    const result = {
      status: "failed",
      input: {},
      error: new Error("Workflow execution failed"),
      steps: {
        "plan-smart-crop-segments": {
          status: "failed",
          error: serializedFailure(),
          payload: {},
          startedAt: 1,
          endedAt: 2,
        },
      },
    }

    expect(smartCropFailureFromRunResult(PREFIX, result)).toEqual(
      rateLimitedFailure,
    )
  })

  it("extracts failures from persisted snapshot step context", () => {
    const result = {
      status: "failed",
      snapshot: {
        status: "failed",
        error: { name: "Error", message: "Workflow execution failed" },
        context: {
          input: {},
          "plan-smart-crop-segments": {
            status: "failed",
            error: serializedFailure(),
          },
        },
      },
    }

    expect(smartCropFailureFromRunResult(PREFIX, result)).toEqual(
      rateLimitedFailure,
    )
  })

  it("bounds traversal and tolerates cycles and unrelated results", () => {
    const cyclic: Record<string, unknown> = { status: "failed" }
    cyclic.snapshot = cyclic
    expect(smartCropFailureFromRunResult(PREFIX, cyclic)).toBeNull()

    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let depth = 0; depth < 12; depth += 1) {
      const cause: Record<string, unknown> = {}
      cursor.cause = cause
      cursor = cause
    }
    cursor.error = serializedFailure()
    expect(smartCropFailureFromRunResult(PREFIX, deep)).toBeNull()
    expect(
      smartCropFailureFromRunResult(PREFIX, {
        status: "failed",
        steps: { unrelated: { status: "success", output: { ok: true } } },
      }),
    ).toBeNull()
  })

  it("continues past throwing getters to a valid sibling failure", () => {
    const hostile = Object.defineProperty({}, "ok", {
      enumerable: true,
      get() {
        throw new Error("hostile getter")
      },
    })
    const result = Object.defineProperty(
      {
        status: "failed",
        steps: {
          hostile,
          valid: { status: "failed", error: serializedFailure() },
        },
      },
      "ok",
      {
        enumerable: true,
        get() {
          throw new Error("hostile root getter")
        },
      },
    )

    expect(smartCropFailureFromRunResult(PREFIX, result)).toEqual(
      rateLimitedFailure,
    )
  })

  it("preserves provider rate-limit metadata in the terminal envelope", () => {
    const failure = smartCropFailureFromError(
      new SmartCropProviderError(
        "provider_rate_limited",
        false,
        "smart crop vision rate limited after 3 attempts (status 429)",
      ),
      "run-rate-limited",
    )

    expect(failure).toEqual(rateLimitedFailure)
  })
})
