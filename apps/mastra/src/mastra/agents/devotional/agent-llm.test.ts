import { describe, expect, it, vi } from "vitest"

vi.mock("../../../services/devotional/llm", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/devotional/llm")>()
  return {
    ...actual,
    createDevotionalLlm: vi.fn(() => {
      throw new actual.DevotionalLlmError(
        "missing_credentials",
        "OpenRouter credentials are unavailable",
      )
    }),
  }
})

import type { Agent } from "@mastra/core/agent"

import { createAgentLlm } from "./agent-llm"

describe("createAgentLlm", () => {
  it("does not construct the credential-bearing client until completion", async () => {
    const agent = {
      id: "keyless-boot-test",
      getInstructions: async () => "Keep the devotional grounded in scripture.",
    } as unknown as Agent

    let llm: ReturnType<typeof createAgentLlm> | undefined
    expect(() => {
      llm = createAgentLlm(agent, "test/model")
    }).not.toThrow()

    await expect(
      llm?.complete({
        system: "unused adapter input",
        user: "Write a devotional.",
        jsonSchema: {
          name: "test",
          schema: { type: "object", properties: {} },
        },
        schema: { parse: (value: unknown) => value } as never,
      }),
    ).rejects.toMatchObject({ code: "missing_credentials" })
  })
})
