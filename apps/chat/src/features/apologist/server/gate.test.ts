// @vitest-environment node
import { describe, expect, it } from "vitest"
import { comparisonAllowed } from "./gate"

describe("comparison access", () => {
  const identity = {
    sub: "tester",
    email: " Agent@Local ",
    emailVerified: true,
  }
  const env = {
    APOLOGIST_COMPARE_ENABLED: "true",
    APOLOGIST_ALLOWED_EMAILS: "agent@local",
  }
  it("requires the switch, Seeker, and a verified allowlisted identity", () => {
    expect(comparisonAllowed(identity, true, env)).toBe(true)
    expect(comparisonAllowed(identity, false, env)).toBe(false)
    expect(comparisonAllowed(null, true, env)).toBe(false)
    expect(
      comparisonAllowed({ ...identity, emailVerified: false }, true, env),
    ).toBe(false)
    expect(comparisonAllowed(identity, true, {})).toBe(false)
    expect(
      comparisonAllowed(identity, true, {
        ...env,
        APOLOGIST_ALLOWED_EMAILS: "",
      }),
    ).toBe(false)
  })
})
