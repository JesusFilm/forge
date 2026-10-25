import { describe, expect, it } from "vitest"

import { createOAuthState } from "./oauth-state"

describe("createOAuthState", () => {
  it("creates independent state, verifier, and challenge values", () => {
    const first = createOAuthState()
    const second = createOAuthState()

    expect(first.state).not.toBe(second.state)
    expect(first.codeVerifier).not.toBe(second.codeVerifier)
    expect(first.codeChallenge).not.toBe(first.codeVerifier)
    expect(first.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
