// jest-expo sets __DEV__ to true, so every other suite sees an open gate. These
// cases set the REAL global to false and re-require the binder, so a revert to
// `return true` or a hardcoded `__DEV__` value fails here.
/* eslint-disable @typescript-eslint/no-require-imports */
const mockEnv: { EXPO_PUBLIC_SIGN_IN_ENABLED: string | undefined } = {
  EXPO_PUBLIC_SIGN_IN_ENABLED: undefined,
}

jest.mock("../../env", () => ({ env: mockEnv }))

const devFlag = globalThis as unknown as { __DEV__: boolean }

function isSignInAvailableFor(
  isDev: boolean,
  value: string | undefined,
): boolean {
  devFlag.__DEV__ = isDev
  mockEnv.EXPO_PUBLIC_SIGN_IN_ENABLED = value
  jest.resetModules()
  return require("../signInGate").isSignInAvailable()
}

describe("isSignInAvailable", () => {
  let previousDev: boolean

  beforeEach(() => {
    previousDev = devFlag.__DEV__
  })

  afterEach(() => {
    devFlag.__DEV__ = previousDev
    mockEnv.EXPO_PUBLIC_SIGN_IN_ENABLED = undefined
  })

  it("hides sign-in in a release bundle when the value is not set (AE1)", () => {
    expect(isSignInAvailableFor(false, undefined)).toBe(false)
  })

  it("hides sign-in in a release bundle for the wrong case of true (AE2)", () => {
    expect(isSignInAvailableFor(false, "TRUE")).toBe(false)
  })

  // The anti-vacuous companion: without it, a binder that always returns false
  // would pass the two cases above.
  it("shows sign-in in a release bundle when the value is 1 (AE7)", () => {
    expect(isSignInAvailableFor(false, "1")).toBe(true)
  })

  it("shows sign-in in a development bundle when the value is not set (AE4)", () => {
    expect(isSignInAvailableFor(true, undefined)).toBe(true)
  })
})
