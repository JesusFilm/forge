// Requires the REAL env.ts, which the two mocked suites cannot — proving the
// refusal and report fire at module scope, and that env.ts pulls in no Datadog.
// require() is the point: each case re-evaluates under different process.env.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@datadog/mobile-react-native", () => {
  throw new Error("native module absent")
})

import {
  LOCAL_ADMIN_GRAPHQL_URL,
  PRODUCTION_ADMIN_GRAPHQL_URL,
} from "../lib/adminEndpoint"

const ENDPOINT = "EXPO_PUBLIC_ADMIN_GRAPHQL_URL"
const OVERRIDE = "EXPO_PUBLIC_ALLOW_PRODUCTION_ADMIN"
const SIGN_IN = "EXPO_PUBLIC_SIGN_IN_ENABLED"

function set(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe("env.ts module evaluation", () => {
  const original = {
    [ENDPOINT]: process.env[ENDPOINT],
    [OVERRIDE]: process.env[OVERRIDE],
    [SIGN_IN]: process.env[SIGN_IN],
    CI: process.env.CI,
    EAS_BUILD: process.env.EAS_BUILD,
  }
  let info: jest.SpyInstance

  beforeEach(() => {
    jest.resetModules()
    info = jest.spyOn(console, "info").mockImplementation(() => {})
  })

  afterEach(() => {
    info.mockRestore()
    for (const [name, value] of Object.entries(original)) set(name, value)
  })

  function reports(): string[] {
    return info.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes("admin_endpoint.url="))
  }

  it("resolves the local default and reports it once when nothing is configured", () => {
    set(ENDPOINT, undefined)
    set(OVERRIDE, undefined)

    expect(() => require("../env")).not.toThrow()

    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toContain(LOCAL_ADMIN_GRAPHQL_URL)
  })

  it("refuses production admin and names the host and the override", () => {
    set(ENDPOINT, PRODUCTION_ADMIN_GRAPHQL_URL)
    set(OVERRIDE, undefined)

    expect(() => require("../env")).toThrow(/admin\.jesusfilm\.org/)
    expect(() => require("../env")).toThrow(new RegExp(OVERRIDE))
    expect(reports()).toHaveLength(0)
  })

  it("proceeds and reports production when the override is set", () => {
    set(ENDPOINT, PRODUCTION_ADMIN_GRAPHQL_URL)
    set(OVERRIDE, "1")

    expect(() => require("../env")).not.toThrow()

    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toContain(PRODUCTION_ADMIN_GRAPHQL_URL)
  })

  it("does not refuse a LAN address configured for physical-device work", () => {
    set(ENDPOINT, "http://192.168.1.20:3003/api/graphql")
    set(OVERRIDE, undefined)

    expect(() => require("../env")).not.toThrow()

    expect(reports()[0]).toContain("192.168.1.20")
  })

  // env.ts skips validation when CI is set, and CI always sets it. Clear both
  // flags, or the `True` case passes in CI without validating anything.
  describe(`${SIGN_IN} (feat-543)`, () => {
    beforeEach(() => {
      set("CI", undefined)
      set("EAS_BUILD", undefined)
      set(ENDPOINT, undefined)
      set(OVERRIDE, undefined)
    })

    it("exposes the value from process.env", () => {
      set(SIGN_IN, "1")

      expect(require("../env").env[SIGN_IN]).toBe("1")
    })

    it("turns an empty value into undefined", () => {
      set(SIGN_IN, "")

      expect(require("../env").env[SIGN_IN]).toBeUndefined()
    })

    // The on-value rule lives in signInGateState. A strict schema here would
    // stop startup for every tester on a typo such as `True`.
    it("loads a value that is not an on-value without an error", () => {
      set(SIGN_IN, "True")

      expect(() => require("../env")).not.toThrow()
      expect(require("../env").env[SIGN_IN]).toBe("True")
    })
  })

  // Every other case runs under jest's ambient __DEV__ === true, so none can see
  // a call site that hardcoded the flag. These read the REAL global at the REAL
  // call sites — what stands between a one-line revert and a localhost release.
  describe("release bundle (__DEV__ false at the real call sites)", () => {
    const devFlag = globalThis as unknown as { __DEV__: boolean }
    let previousDev: boolean

    beforeEach(() => {
      previousDev = devFlag.__DEV__
      devFlag.__DEV__ = false
    })

    afterEach(() => {
      devFlag.__DEV__ = previousDev
    })

    it("resolves production from env.ts and config.ts with nothing configured", () => {
      set(ENDPOINT, undefined)
      set(OVERRIDE, undefined)

      expect(() => require("../env")).not.toThrow()
      expect(require("../lib/config").getGraphQLUrl()).toBe(
        PRODUCTION_ADMIN_GRAPHQL_URL,
      )
      expect(reports()).toHaveLength(0)
    })

    it("never refuses production admin, with or without the override", () => {
      set(ENDPOINT, PRODUCTION_ADMIN_GRAPHQL_URL)
      set(OVERRIDE, undefined)

      expect(() => require("../env")).not.toThrow()
      expect(require("../lib/config").getGraphQLUrl()).toBe(
        PRODUCTION_ADMIN_GRAPHQL_URL,
      )
      expect(reports()).toHaveLength(0)
    })

    // The one sign-in case with no mock: process.env, the real env.ts, and the
    // real binder (feat-543).
    it("hides sign-in until the value is 1", () => {
      set(ENDPOINT, undefined)
      set(OVERRIDE, undefined)
      set(SIGN_IN, undefined)

      expect(require("../lib/signInGate").isSignInAvailable()).toBe(false)

      jest.resetModules()
      set(SIGN_IN, "1")

      expect(require("../lib/signInGate").isSignInAvailable()).toBe(true)
    })
  })
})
