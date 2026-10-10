import { beforeEach, describe, expect, it, vi } from "vitest"

const mockEnv = vi.hoisted(() => ({
  env: { ADMIN_AGENT_TOOLS_API_KEYS: undefined as string | undefined },
}))

vi.mock("@/config/env", () => mockEnv)

import { isValidAgentToolsBearer } from "./agent-tools-bearer"

describe("isValidAgentToolsBearer", () => {
  beforeEach(() => {
    mockEnv.env.ADMIN_AGENT_TOOLS_API_KEYS = undefined
  })

  it("returns false when the CSV is unset (keyring-first: no key can match)", () => {
    expect(isValidAgentToolsBearer("Bearer anything")).toBe(false)
  })

  it("returns false for a missing or malformed header", () => {
    mockEnv.env.ADMIN_AGENT_TOOLS_API_KEYS = "key-a"
    expect(isValidAgentToolsBearer(null)).toBe(false)
    expect(isValidAgentToolsBearer("key-a")).toBe(false) // no "Bearer " prefix
    expect(isValidAgentToolsBearer("Bearer ")).toBe(false)
  })

  it("returns true for a matching key (case-insensitive Bearer prefix)", () => {
    mockEnv.env.ADMIN_AGENT_TOOLS_API_KEYS = "key-a,key-b"
    expect(isValidAgentToolsBearer("Bearer key-a")).toBe(true)
    expect(isValidAgentToolsBearer("bearer key-b")).toBe(true)
  })

  it("returns false for a non-matching key (and tolerates length-mismatch timing-safely)", () => {
    mockEnv.env.ADMIN_AGENT_TOOLS_API_KEYS = "key-a"
    expect(isValidAgentToolsBearer("Bearer nope")).toBe(false)
    expect(isValidAgentToolsBearer("Bearer key-a-longer")).toBe(false)
  })
})
