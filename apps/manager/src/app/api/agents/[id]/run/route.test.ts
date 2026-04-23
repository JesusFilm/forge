import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  runSharedAgentMock,
  SharedAgentNotFoundErrorMock,
  SharedAgentValidationErrorMock,
} = vi.hoisted(() => {
  class SharedAgentNotFoundError extends Error {
    constructor(agentId: string) {
      super(`Shared agent "${agentId}" was not found.`)
      this.name = "SharedAgentNotFoundError"
    }
  }

  class SharedAgentValidationError extends Error {
    details: string[]

    constructor(details: string[]) {
      super("Shared agent input validation failed.")
      this.name = "SharedAgentValidationError"
      this.details = details
    }
  }

  return {
    authenticateRequestMock: vi.fn(),
    runSharedAgentMock: vi.fn(),
    SharedAgentNotFoundErrorMock: SharedAgentNotFoundError,
    SharedAgentValidationErrorMock: SharedAgentValidationError,
  }
})

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/shared-agent-runtime", () => ({
  runSharedAgent: runSharedAgentMock,
  SharedAgentNotFoundError: SharedAgentNotFoundErrorMock,
  SharedAgentValidationError: SharedAgentValidationErrorMock,
}))

import { POST } from "@/app/api/agents/[id]/run/route"

function buildRequest(body: unknown) {
  return new Request("http://example.test/api/agents/translation/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/agents/[id]/run", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    runSharedAgentMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
  })

  it("runs the requested shared agent", async () => {
    runSharedAgentMock.mockResolvedValue({
      agent: { id: "translation", name: "Translation Agent" },
      output: "Hola mundo",
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      generatedAt: "2026-04-16T00:00:00.000Z",
    })

    const response = await POST(
      buildRequest({
        goal: "Translate this",
        supportingContext: "For Easter launch",
        fields: {
          source_text: "Hello world",
          target_language: "Spanish",
        },
      }),
      { params: Promise.resolve({ id: "translation" }) },
    )

    expect(response.status).toBe(200)
    expect(runSharedAgentMock).toHaveBeenCalledWith({
      agentId: "translation",
      payload: {
        goal: "Translate this",
        supportingContext: "For Easter launch",
        fields: {
          source_text: "Hello world",
          target_language: "Spanish",
        },
      },
    })
  })

  it("rejects malformed request payloads before runtime execution", async () => {
    const response = await POST(
      buildRequest({
        supportingContext: "Missing goal",
        fields: {},
      }),
      { params: Promise.resolve({ id: "translation" }) },
    )

    expect(response.status).toBe(400)
    expect(runSharedAgentMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({
      error: "Validation failed",
      details: ["goal: Invalid input: expected string, received undefined"],
    })
  })

  it("maps missing shared agents to 404", async () => {
    runSharedAgentMock.mockRejectedValue(
      new SharedAgentNotFoundErrorMock("missing"),
    )

    const response = await POST(
      buildRequest({
        goal: "Do the thing",
        fields: {},
      }),
      { params: Promise.resolve({ id: "missing" }) },
    )

    expect(response.status).toBe(404)
  })

  it("maps agent-specific validation errors to 400", async () => {
    runSharedAgentMock.mockRejectedValue(
      new SharedAgentValidationErrorMock(["Target language is required."]),
    )

    const response = await POST(
      buildRequest({
        goal: "Translate this",
        fields: {
          source_text: "Hello world",
        },
      }),
      { params: Promise.resolve({ id: "translation" }) },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Shared agent input validation failed.",
      details: ["Target language is required."],
    })
  })
})
