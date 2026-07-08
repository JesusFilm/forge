// @vitest-environment node
// The module under test is server-only and transitively pulls the LD node SDK
// via ./feature-flags — no DOM needed.
import type {
  BooleanVariationDetail,
  FeatureFlagContext,
} from "@forge/feature-flags"
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
 * Builds the injectable dependency set with a controllable evaluator result.
 * The evaluator defaults to a GRANTING launchdarkly answer so every pre-
 * evaluation branch test fails observably (as `granted`) if its branch is
 * removed — the branch-unique discipline from the plan.
 */
function createDeps(
  detail: BooleanVariationDetail = { value: true, source: "launchdarkly" },
) {
  return {
    isSeekerChatEnabled: () => true,
    evaluateFlagDetail: vi.fn(async (_context: FeatureFlagContext) => detail),
    logger: { log: vi.fn() },
  }
}

describe("resolveSeekerGate", () => {
  it("AE8: kill switch off denies a targeted, verified identity without evaluating the flag", async () => {
    const deps = createDeps({ value: true, source: "launchdarkly" })

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "page",
      ...deps,
      isSeekerChatEnabled: () => false,
    })

    expect(decision).toEqual({ seekerEnabled: false, outcome: "kill_switch" })
    expect(deps.evaluateFlagDetail).not.toHaveBeenCalled()
    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=page outcome=kill_switch sub=auth0|dogfooder-1",
    )
  })

  it("AE3: anonymous short-circuits — no flag evaluation, no log line at all", async () => {
    const deps = createDeps({ value: true, source: "launchdarkly" })

    const decision = await resolveSeekerGate(null, {
      surface: "route",
      ...deps,
    })

    expect(decision.seekerEnabled).toBe(false)
    expect(decision.outcome).toBe("anonymous")
    expect(deps.evaluateFlagDetail).not.toHaveBeenCalled()
    expect(deps.logger.log).not.toHaveBeenCalled()
  })

  it("anonymous with the kill switch off denies without logging or dereferencing null", async () => {
    // Exercises the `identity !== null` guard in the kill_switch branch: the
    // kill switch is checked before the anonymous short-circuit, so an
    // anonymous caller on a kill-switched deploy hits it. It must not log (no
    // sub) and must not throw — removing the guard would deref identity.sub.
    const deps = createDeps({ value: true, source: "launchdarkly" })

    const decision = await resolveSeekerGate(null, {
      surface: "route",
      ...deps,
      isSeekerChatEnabled: () => false,
    })

    expect(decision).toEqual({ seekerEnabled: false, outcome: "kill_switch" })
    expect(deps.logger.log).not.toHaveBeenCalled()
    expect(deps.evaluateFlagDetail).not.toHaveBeenCalled()
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
    "AE7: %s denies as no_email without evaluating",
    async (_label, identity) => {
      const deps = createDeps({ value: true, source: "launchdarkly" })

      const decision = await resolveSeekerGate(identity, {
        surface: "page",
        ...deps,
      })

      expect(decision).toEqual({ seekerEnabled: false, outcome: "no_email" })
      expect(deps.evaluateFlagDetail).not.toHaveBeenCalled()
      expect(deps.logger.log).toHaveBeenCalledTimes(1)
      expect(deps.logger.log).toHaveBeenCalledWith(
        `[seeker-gate] event=gate_decision surface=page outcome=no_email sub=${identity.sub}`,
      )
    },
  )

  it("AE7: a whitespace-only email reads as no_email, never an empty context key", async () => {
    const deps = createDeps({ value: true, source: "launchdarkly" })

    const decision = await resolveSeekerGate(
      { sub: "auth0|whitespace", email: "   ", emailVerified: true },
      { surface: "page", ...deps },
    )

    expect(decision).toEqual({ seekerEnabled: false, outcome: "no_email" })
    expect(deps.evaluateFlagDetail).not.toHaveBeenCalled()
  })

  it("not_targeted: a genuine LD false answer logs with source=launchdarkly", async () => {
    const deps = createDeps({ value: false, source: "launchdarkly" })

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "page",
      ...deps,
    })

    expect(decision).toEqual({ seekerEnabled: false, outcome: "not_targeted" })
    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=page outcome=not_targeted sub=auth0|dogfooder-1 source=launchdarkly",
    )
  })

  it.each(["default", "override"] as const)(
    "AE6: a fallback-chain false (source=%s) denies as ld_unavailable",
    async (source) => {
      const deps = createDeps({ value: false, source })

      const decision = await resolveSeekerGate(verifiedIdentity, {
        surface: "page",
        ...deps,
      })

      expect(decision).toEqual({
        seekerEnabled: false,
        outcome: "ld_unavailable",
      })
      expect(deps.logger.log).toHaveBeenCalledTimes(1)
      expect(deps.logger.log).toHaveBeenCalledWith(
        `[seeker-gate] event=gate_decision surface=page outcome=ld_unavailable sub=auth0|dogfooder-1 source=${source}`,
      )
    },
  )

  it("granted: an LD true answer enables seeker and logs surface, sub, and source", async () => {
    const deps = createDeps({ value: true, source: "launchdarkly" })

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "route",
      ...deps,
    })

    expect(decision).toEqual({ seekerEnabled: true, outcome: "granted" })
    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=route outcome=granted sub=auth0|dogfooder-1 source=launchdarkly",
    )
  })

  it("granted via a dev override logs source=override (provenance split)", async () => {
    const deps = createDeps({ value: true, source: "override" })

    const decision = await resolveSeekerGate(verifiedIdentity, {
      surface: "page",
      ...deps,
    })

    expect(decision).toEqual({ seekerEnabled: true, outcome: "granted" })
    expect(deps.logger.log).toHaveBeenCalledWith(
      "[seeker-gate] event=gate_decision surface=page outcome=granted sub=auth0|dogfooder-1 source=override",
    )
  })

  it("R14: the evaluator receives a kind:user context keyed on the trimmed, lowercased email — nothing else", async () => {
    const deps = createDeps({ value: true, source: "launchdarkly" })

    await resolveSeekerGate(verifiedIdentity, { surface: "page", ...deps })

    expect(deps.evaluateFlagDetail).toHaveBeenCalledTimes(1)
    // toEqual is exact: no name, no email attribute — the key IS the email.
    expect(deps.evaluateFlagDetail).toHaveBeenCalledWith({
      kind: "user",
      key: NORMALIZED_EMAIL,
    })
  })

  it("KTD8: the log line is one plain string in the fixed format and never contains the email", async () => {
    const deps = createDeps({ value: true, source: "launchdarkly" })

    await resolveSeekerGate(verifiedIdentity, { surface: "page", ...deps })

    expect(deps.logger.log).toHaveBeenCalledTimes(1)
    const call = deps.logger.log.mock.calls[0]
    expect(call).toHaveLength(1)
    const line = call[0]
    expect(line).toBe(
      "[seeker-gate] event=gate_decision surface=page outcome=granted sub=auth0|dogfooder-1 source=launchdarkly",
    )
    expect(line).not.toContain(RAW_EMAIL.trim())
    expect(line).not.toContain(NORMALIZED_EMAIL)
  })
})
