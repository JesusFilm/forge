/* global describe, it, expect, afterEach, require */
/* eslint-disable @typescript-eslint/no-require-imports */
const configure = require("../app.config")
const original = process.env.TV_STARTUP_QA
afterEach(() => {
  if (original == null) delete process.env.TV_STARTUP_QA
  else process.env.TV_STARTUP_QA = original
})

describe("startup QA identity", () => {
  const config = {
    name: "Jesus Film Watch",
    android: { package: "org.jesusfilm.tv", versionCode: 2 },
    ios: { bundleIdentifier: "org.jesusfilm.forgewatch" },
  }
  it("leaves the normal build configuration untouched", () => {
    delete process.env.TV_STARTUP_QA
    expect(configure({ config })).toBe(config)
  })
  it("isolates Android app data while retaining the Apple bundle configuration", () => {
    process.env.TV_STARTUP_QA = "1"
    const qa = configure({ config })
    expect(qa.android.package).toBe("org.jesusfilm.tv.startupqa")
    expect(qa.name).toBe("Watch Startup QA")
    expect(qa.ios).toBe(config.ios)
  })
})
