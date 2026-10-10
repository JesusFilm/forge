import { resolveSignInAvailable } from "../signInGateState"

// SYNC: the truth table of apps/tv/src/lib/auth/profileFlagState.test.ts, plus
// the mobile cases for a mixed-case value and for whitespace around `1`.
describe("resolveSignInAvailable", () => {
  it.each([undefined, "", "0", "false", "1"])(
    "shows sign-in in a development bundle for %p",
    (value) => {
      expect(resolveSignInAvailable(true, value)).toBe(true)
    },
  )

  it.each(["1", "true"])(
    "shows sign-in in a release bundle for %p",
    (value) => {
      expect(resolveSignInAvailable(false, value)).toBe(true)
    },
  )

  // An opt-in gate, not a boolean parser: every other value fails closed.
  it.each([undefined, "", "0", "false", "TRUE", "True", "yes", " 1", "1\n"])(
    "hides sign-in in a release bundle for %p",
    (value) => {
      expect(resolveSignInAvailable(false, value)).toBe(false)
    },
  )
})
