/**
 * The device half of the payload (R2). The pure resolver carries every branch;
 * the reader is smoke-tested once, because only a device proves what the
 * platform actually reports.
 */

import {
  readIntlOptions,
  readPushDeviceEnvironment,
  resolvePushDeviceEnvironment,
} from "../deviceEnvironment"

describe("resolvePushDeviceEnvironment", () => {
  const BASE = {
    version: "1.0.0",
    platformBuild: "42",
    locale: "en-US",
    timeZone: "Pacific/Auckland",
  }

  it("maps the platform to admin's two transports", () => {
    expect(
      resolvePushDeviceEnvironment({ ...BASE, platformOs: "android" }).platform,
    ).toBe("ANDROID")
    expect(
      resolvePushDeviceEnvironment({ ...BASE, platformOs: "ios" }).platform,
    ).toBe("IOS")
    // A web bundle registers nothing, so this is a shape, not a claim.
    expect(
      resolvePushDeviceEnvironment({ ...BASE, platformOs: "web" }).platform,
    ).toBe("IOS")
  })

  it("names the build as the version plus the platform build number", () => {
    expect(
      resolvePushDeviceEnvironment({ ...BASE, platformOs: "ios" }).appBuild,
    ).toBe("1.0.0+42")
    expect(
      resolvePushDeviceEnvironment({
        ...BASE,
        platformOs: "android",
        platformBuild: 7,
      }).appBuild,
    ).toBe("1.0.0+7")
  })

  it("still sends a usable environment when the phone reports nothing", () => {
    expect(
      resolvePushDeviceEnvironment({
        platformOs: "ios",
        version: null,
        platformBuild: null,
        locale: null,
        timeZone: null,
      }),
    ).toEqual({
      platform: "IOS",
      appBuild: "unknown",
      phoneLocale: "en",
      timeZone: "UTC",
    })
  })
})

describe("readIntlOptions", () => {
  it("reads a locale tag and a zone name from the runtime", () => {
    const options = readIntlOptions()

    expect(typeof options.locale).toBe("string")
    expect(typeof options.zone).toBe("string")
  })
})

describe("readPushDeviceEnvironment", () => {
  it("answers a payload-ready environment on this runtime", () => {
    const environment = readPushDeviceEnvironment()

    expect(["IOS", "ANDROID"]).toContain(environment.platform)
    expect(environment.appBuild.length).toBeGreaterThan(0)
    expect(environment.phoneLocale).toMatch(
      /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/,
    )
    expect(environment.timeZone.length).toBeGreaterThan(0)
  })
})
