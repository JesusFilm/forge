import { describe, expect, it } from "vitest"

import { createSmokeResponse, smokeAgent } from "./smoke-agent"

describe("smoke agent", () => {
  it("registers a stable smoke agent id", () => {
    expect(smokeAgent.name).toBe("Smoke Agent")
  })

  it("returns a deterministic smoke response", () => {
    expect(createSmokeResponse("hello")).toEqual({
      ok: true,
      agentId: "smokeAgent",
      echo: "hello",
    })
  })
})
