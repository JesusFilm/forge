// @vitest-environment node
// The module under test is server-only (config/env reads) — no DOM needed.
import { describe, expect, it, vi } from "vitest"

import type { ChatIdentity } from "@/auth/session-cookie"

import { resolveSeekerGate } from "./seeker-gate"

const RAW_EMAIL = "  Person@Example.COM "
const NORMALIZED_EMAIL = "person@example.com"

const verifiedIdentity: ChatIdentity = {
  sub: "auth0|dogfooder-1",
  email: RAW_EMAIL,
  emailVerified: true,
}

/**
 * Builds the injectable dependency set with a controllable membership answer.
 * The membership check defaults to GRANTING so every pre-membership branch
 * test fails observably (as `granted`) if its branch is removed — the
 * branch-unique discipline from the plan.
 */
function createDeps(allowed = true) {
  return {
    isSeekerChatEnabled: () => true,
    isEmailAllowed: vi.fn((_email: string) => allowed),
    logger: { log: vi.fn() },
  }
}

describe("resolveSeekerGate", () => {
  it("AE8: kill switch off denies an allowlisted, verified identity without consulting the allowlist", async () => {
    const deps = createDeps(true)

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "page",
      ...deps,
      isSeekerChatEnabled: () => false,
    })

    expect(decision).toEqual({ seekerEnabled: false, outcome: "kill_switch" })
    expect(deps.isEmailAllowed).not.toHaveBeenCalled()
    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=page outcome=kill_switch sub=auth0|dogfooder-1",
    )
  })

  it("AE3: anonymous short-circuits — no membership check, no log line at all", async () => {
    const deps = createDeps(true)

    const decision = await resolveSeekerGate(null, {
      surface: "route",
      ...deps,
    })

    expect(decision.seekerEnabled).toBe(false)
    expect(decision.outcome).toBe("anonymous")
    expect(deps.isEmailAllowed).not.toHaveBeenCalled()
    expect(deps.logger.log).not.toHaveBeenCalled()
  })

  it("anonymous with the kill switch off denies without logging or dereferencing null", async () => {
    // Exercises the `identity !== null` guard in the kill_switch branch: the
    // kill switch is checked before the anonymous short-circuit, so an
    // anonymous caller on a kill-switched deploy hits it. It must not log (no
    // sub) and must not throw — removing the guard would deref identity.sub.
    const deps = createDeps(true)

    const decision = await resolveSeekerGate(null, {
      surface: "route",
      ...deps,
      isSeekerChatEnabled: () => false,
    })

    expect(decision).toEqual({ seekerEnabled: false, outcome: "kill_switch" })
    expect(deps.logger.log).not.toHaveBeenCalled()
    expect(deps.isEmailAllowed).not.toHaveBeenCalled()
  })

  it.each([
    ["no email claim", { sub: "auth0|no-email" } satisfies ChatIdentity],
    [
      "email present but emailVerified false",
      {
        sub: "auth0|unverified",
        email: "unverified@example.com",
        emailVerified: false,
      } satisfies ChatIdentity,
    ],
    [
      "email present but emailVerified undefined",
      {
        sub: "auth0|unclaimed",
        email: "unclaimed@example.com",
      } satisfies ChatIdentity,
    ],
  ])(
    "AE7: %s denies as no_email without a membership check",
    async (_label, identity) => {
      const deps = createDeps(true)

      const decision = await resolveSeekerGate(identity, {
        surface: "page",
        ...deps,
      })

      expect(decision).toEqual({ seekerEnabled: false, outcome: "no_email" })
      expect(deps.isEmailAllowed).not.toHaveBeenCalled()
      expect(deps.logger.log).toHaveBeenCalledTimes(1)
      expect(deps.logger.log).toHaveBeenCalledWith(
        `[seeker-gate] event=gate_decision surface=page outcome=no_email sub=${identity.sub}`,
      )
    },
  )

  it("AE7: a whitespace-only email reads as no_email, never an empty membership lookup", async () => {
    const deps = createDeps(true)

    const decision = await resolveSeekerGate(
      { sub: "auth0|whitespace", email: "   ", emailVerified: true },
      { surface: "page", ...deps },
    )

    expect(decision).toEqual({ seekerEnabled: false, outcome: "no_email" })
    expect(deps.isEmailAllowed).not.toHaveBeenCalled()
  })

  it("not_allowlisted: a membership miss denies and logs the outcome", async () => {
    const deps = createDeps(false)

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "page",
      ...deps,
    })

    expect(decision).toEqual({
      seekerEnabled: false,
      outcome: "not_allowlisted",
    })
    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=page outcome=not_allowlisted sub=auth0|dogfooder-1",
    )
  })

  it("granted: a membership hit enables seeker and logs surface + sub", async () => {
    const deps = createDeps(true)

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "route",
      ...deps,
    })

    expect(decision).toEqual({ seekerEnabled: true, outcome: "granted" })
    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=route outcome=granted sub=auth0|dogfooder-1",
    )
  })

  it("R14: the membership check receives the trimmed, lowercased email — nothing else", async () => {
    const deps = createDeps(true)

    await resolveSeekerGate(verifiedIdentity, { surface: "page", ...deps })

    expect(deps.isEmailAllowed).toHaveBeenCalledTimes(1)
    expect(deps.isEmailAllowed).toHaveBeenCalledWith(NORMALIZED_EMAIL)
  })

  it("KTD8: the log line is one plain string in the fixed format and never contains the email", async () => {
    const deps = createDeps(true)

    await resolveSeekerGate(verifiedIdentity, { surface: "page", ...deps })

    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    const call = deps.logger.log.mock.calls[0]
    expect(call).toHaveLength(1)
    const line = call[0]
    expect(line).toBe(
      "[seeker-gate] event=gate_decision surface=page outcome=granted sub=auth0|dogfooder-1",
    )
    expect(line).not.toContain(RAW_EMAIL.trim())
    expect(line).not.toContain(NORMALIZED_EMAIL)
  })
})
