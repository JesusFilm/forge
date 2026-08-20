import { describe, expect, it } from "vitest"

import type { ChatIdentity } from "@/auth/session-cookie"

import { resolveDeepLinkEntry } from "./deep-link-entry"

// A signed-in-shaped identity: the gate-granted dogfooder claim set.
const identity: ChatIdentity = {
  sub: "user-1",
  email: "dogfooder@example.com",
  emailVerified: true,
}

describe("resolveDeepLinkEntry", () => {
  it("resolves an invalid id to unavailable, never sign_in, for anonymous (AE3/AE4)", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: true,
        identity: null,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves an invalid id to unavailable even for a full-grant identity", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: false,
        authConfigured: true,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves unconfigured auth to unavailable for anonymous", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: false,
        identity: null,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves unconfigured auth to unavailable even with a signed-in-shaped identity", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: false,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves a valid id with configured auth and no identity to sign_in", () => {
    // seekerEnabled: false is the discriminating fixture — sign_in must win
    // BEFORE the seekerEnabled check, or this would read unavailable.
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: true,
        identity: null,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "sign_in" })
  })

  it("resolves a signed-in but gate-denied user to unavailable", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: true,
        identity,
        seekerEnabled: false,
      }),
    ).toEqual({ kind: "unavailable" })
  })

  it("resolves a valid id with a gate-granted identity to granted", () => {
    expect(
      resolveDeepLinkEntry({
        idValid: true,
        authConfigured: true,
        identity,
        seekerEnabled: true,
      }),
    ).toEqual({ kind: "granted" })
  })
})
