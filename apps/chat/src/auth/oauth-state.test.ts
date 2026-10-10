import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { base64Url, createOAuthState } from "./oauth-state"

const URL_SAFE = /^[A-Za-z0-9_-]+$/

describe("createOAuthState", () => {
  it("derives code_challenge as base64url(sha256(code_verifier)) — S256 contract", () => {
    const { codeVerifier, codeChallenge } = createOAuthState()
    const expected = base64Url(
      createHash("sha256").update(codeVerifier).digest(),
    )
    expect(codeChallenge).toBe(expected)
  })

  it("produces non-empty, URL-safe state and code_verifier", () => {
    const { state, codeVerifier, codeChallenge } = createOAuthState()
    expect(state).not.toBe("")
    expect(codeVerifier).not.toBe("")
    expect(state).toMatch(URL_SAFE)
    expect(codeVerifier).toMatch(URL_SAFE)
    expect(codeChallenge).toMatch(URL_SAFE)
  })

  it("differs across calls (randomness)", () => {
    const a = createOAuthState()
    const b = createOAuthState()
    expect(a.state).not.toBe(b.state)
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
  })
})
