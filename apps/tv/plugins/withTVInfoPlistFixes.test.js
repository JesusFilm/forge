/* eslint-disable @typescript-eslint/no-require-imports */
/* global jest, test, expect, afterEach, require */
jest.mock("expo/config-plugins", () => ({
  withInfoPlist: (config, action) => action(config),
}))
const withTVInfoPlistFixes = require("./withTVInfoPlistFixes")
const originalFlag = process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING
afterEach(() => {
  if (originalFlag === undefined)
    delete process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING
  else process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING = originalFlag
})

test("default/store builds remove only the local networking exception", () => {
  delete process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING
  const ats = {
    NSAllowsLocalNetworking: true,
    NSAllowsArbitraryLoads: false,
    NSExceptionDomains: { "example.test": {} },
  }
  const result = withTVInfoPlistFixes({
    modResults: { LSRequiresIPhoneOS: true, NSAppTransportSecurity: ats },
  })
  expect(result.modResults).not.toHaveProperty("LSRequiresIPhoneOS")
  expect(result.modResults.NSAppTransportSecurity).toEqual({
    NSAllowsArbitraryLoads: false,
    NSExceptionDomains: { "example.test": {} },
  })
})

test.each([undefined, "0", "true"])(
  "only exact opt-in preserves local networking: %s",
  (flag) => {
    if (flag === undefined) delete process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING
    else process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING = flag
    const result = withTVInfoPlistFixes({
      modResults: { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } },
    })
    expect(result.modResults).not.toHaveProperty("NSAppTransportSecurity")
  },
)

test("the explicit development opt-in retains the local exception", () => {
  process.env.EXPO_TV_ALLOW_LOCAL_NETWORKING = "1"
  const result = withTVInfoPlistFixes({
    modResults: {
      LSRequiresIPhoneOS: true,
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  })
  expect(result.modResults).not.toHaveProperty("LSRequiresIPhoneOS")
  expect(result.modResults.NSAppTransportSecurity.NSAllowsLocalNetworking).toBe(
    true,
  )
})

test("only the EAS development profile opts in; release profiles remain restricted", () => {
  const { build } = require("../eas.json")
  expect(build.development.env.EXPO_TV_ALLOW_LOCAL_NETWORKING).toBe("1")
  for (const name of ["preview", "beta", "production"])
    expect(build[name].env.EXPO_TV_ALLOW_LOCAL_NETWORKING).not.toBe("1")
})
