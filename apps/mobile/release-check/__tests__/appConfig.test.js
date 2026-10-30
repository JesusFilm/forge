/* eslint-disable @typescript-eslint/no-require-imports */
/* global afterAll, describe, expect, it, require */
// KTD4, R34: the generated app.config.js turns updates off, allows the http
// read-only server on Android, and turns Firebase Analytics off, in the runner
// worktree only.
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const {
  GENERATED_DIR,
  PLUGIN_FILE,
  testAppConfig,
  writeTestAppConfig,
} = require("../lib/testBuild/appConfig")

const MOBILE_DIR = path.join(__dirname, "..", "..")
const appJson = JSON.parse(
  fs.readFileSync(path.join(MOBILE_DIR, "app.json"), "utf8"),
)
const PLUGIN_PATH = "./.release-check/withFirebaseAnalyticsDeactivated.js"

const tempDirs = []
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-check-config-"))
  tempDirs.push(dir)
  return dir
}

function buildPropertiesEntries(config) {
  return config.plugins.filter(
    (entry) => Array.isArray(entry) && entry[0] === "expo-build-properties",
  )
}

describe("the generated app config", () => {
  const config = testAppConfig(appJson.expo, { pluginPath: PLUGIN_PATH })

  it("turns updates off and sends no update request headers", () => {
    expect(config.updates).toEqual({
      ...appJson.expo.updates,
      enabled: false,
    })
    const withChannel = testAppConfig(
      {
        ...appJson.expo,
        updates: {
          ...appJson.expo.updates,
          requestHeaders: { "expo-channel-name": "production" },
        },
      },
      { pluginPath: PLUGIN_PATH },
    )
    expect(withChannel.updates).not.toHaveProperty("requestHeaders")
  })

  it("merges cleartext traffic into the one expo-build-properties entry", () => {
    expect(buildPropertiesEntries(config)).toEqual([
      [
        "expo-build-properties",
        {
          ios: { deploymentTarget: "16.4" },
          android: { usesCleartextTraffic: true },
        },
      ],
    ])
  })

  it("sets the iOS Firebase Analytics off key and keeps app.json's keys", () => {
    expect(config.ios.infoPlist).toEqual({
      ...appJson.expo.ios.infoPlist,
      FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED: true,
    })
  })

  it("adds the config plugin last and keeps every app.json plugin", () => {
    expect(config.plugins).toHaveLength(appJson.expo.plugins.length + 1)
    expect(config.plugins[config.plugins.length - 1]).toBe(PLUGIN_PATH)
  })

  it("leaves app.json's own object unchanged", () => {
    const before = JSON.stringify(appJson.expo)
    testAppConfig(appJson.expo, { pluginPath: PLUGIN_PATH })
    expect(JSON.stringify(appJson.expo)).toBe(before)
  })
})

describe("writing the config into a worktree", () => {
  it("writes an app.config.js that Expo can call with app.json's config", () => {
    const mobileDir = tempDir()
    writeTestAppConfig(mobileDir)

    expect(fs.readdirSync(path.join(mobileDir, GENERATED_DIR)).sort()).toEqual([
      "appConfig.js",
      PLUGIN_FILE,
    ])
    const generated = require(path.join(mobileDir, "app.config.js"))
    const result = generated({ config: appJson.expo })
    expect(result.updates.enabled).toBe(false)
    expect(result.ios.infoPlist.FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED).toBe(
      true,
    )
    expect(result.plugins[result.plugins.length - 1]).toBe(PLUGIN_PATH)
    const plugin = require(path.join(mobileDir, PLUGIN_PATH))
    expect(typeof plugin.deactivateFirebaseAnalytics).toBe("function")
  })

  it("sets analytics_collection_deactivated in the worktree's firebase.json only", () => {
    const developerDir = tempDir()
    const worktreeDir = tempDir()
    const firebaseJson = `${JSON.stringify(
      { "react-native": { analytics_auto_collection_enabled: true } },
      null,
      2,
    )}\n`
    fs.writeFileSync(path.join(developerDir, "firebase.json"), firebaseJson)
    fs.writeFileSync(path.join(worktreeDir, "firebase.json"), firebaseJson)

    expect(writeTestAppConfig(worktreeDir)).toEqual({ firebaseJson: true })

    expect(
      JSON.parse(fs.readFileSync(path.join(worktreeDir, "firebase.json"))),
    ).toEqual({
      "react-native": {
        analytics_auto_collection_enabled: true,
        analytics_collection_deactivated: true,
      },
    })
    expect(
      fs.readFileSync(path.join(developerDir, "firebase.json"), "utf8"),
    ).toBe(firebaseJson)
  })

  it("stops when the tested commit has its own app config", () => {
    const mobileDir = tempDir()
    fs.writeFileSync(path.join(mobileDir, "app.config.ts"), "export default {}")

    expect(() => writeTestAppConfig(mobileDir)).toThrow(
      "the tested commit has apps/mobile/app.config.ts",
    )
    expect(fs.existsSync(path.join(mobileDir, "app.config.js"))).toBe(false)
  })
})
