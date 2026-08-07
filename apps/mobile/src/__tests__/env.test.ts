// Requires the REAL env.ts, which the two mocked suites cannot: it proves the
// refusal and the startup report actually fire at module evaluation, and that
// env.ts pulls in no Datadog dependency (KTD4 — that would close a cycle, and
// the native SDK has not initialized this early).
// require() is the point here — each case re-evaluates env.ts under different
// process.env, which a hoisted static import cannot do.
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

function set(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe("env.ts module evaluation", () => {
  const original = {
    [ENDPOINT]: process.env[ENDPOINT],
    [OVERRIDE]: process.env[OVERRIDE],
  }
  let info: jest.SpyInstance

  beforeEach(() => {
    jest.resetModules()
    info = jest.spyOn(console, "info").mockImplementation(() => {})
  })

  afterEach(() => {
    info.mockRestore()
    set(ENDPOINT, original[ENDPOINT])
    set(OVERRIDE, original[OVERRIDE])
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
})
