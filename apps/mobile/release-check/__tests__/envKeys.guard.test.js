/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// KTD3 guard: every EXPO_PUBLIC_* key the app reads is in exactly one class of
// config/test-settings.json, so a new key needs a decision before a test build.
const fs = require("node:fs")
const path = require("node:path")

const {
  CONFIG_DIR,
  MOBILE_DIR,
  appEnvKeys,
  classifyEnvKeys,
  envKeysFromSource,
  readJson,
} = require("../lib/lists")

const settings = readJson(path.join(CONFIG_DIR, "test-settings.json"))
const envSource = fs.readFileSync(path.join(MOBILE_DIR, "src/env.ts"), "utf8")

describe("the test settings list", () => {
  it("reads the env.ts keys and the two keys read outside it (positive control)", () => {
    const keys = appEnvKeys()
    expect(keys).toEqual(
      expect.arrayContaining([
        "EXPO_PUBLIC_ADMIN_GRAPHQL_URL",
        "EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN",
        "EXPO_PUBLIC_RECOMMENDATIONS_ENABLED",
        "EXPO_PUBLIC_DATADOG_CLIENT_TOKEN",
        "EXPO_PUBLIC_EXPLORE_ANDROID_ENABLED",
        "EXPO_PUBLIC_UI_PSEUDO_LOCALE",
        "EXPO_PUBLIC_USE_RN_FETCH",
      ]),
    )
    expect(keys.length).toBeGreaterThanOrEqual(18)
  })

  it("puts every key in exactly one class", () => {
    expect(classifyEnvKeys(appEnvKeys(), settings)).toEqual({
      unclassified: [],
      repeated: [],
    })
  })

  it("fails on a new env.ts key until the key is in one class", () => {
    const fixture = `${envSource}\nEXPO_PUBLIC_NEW_FLAG: z.string().optional(),\n`
    const keys = envKeysFromSource(fixture)
    expect(classifyEnvKeys(keys, settings).unclassified).toEqual([
      "EXPO_PUBLIC_NEW_FLAG",
    ])

    const decided = {
      ...settings,
      mustBeUnset: [...settings.mustBeUnset, "EXPO_PUBLIC_NEW_FLAG"],
    }
    expect(classifyEnvKeys(keys, decided)).toEqual({
      unclassified: [],
      repeated: [],
    })
  })

  it("fails on a key that is in two classes", () => {
    const twice = {
      ...settings,
      mustBeUnset: [...settings.mustBeUnset, "EXPO_PUBLIC_SIGN_IN_ENABLED"],
    }
    expect(classifyEnvKeys(appEnvKeys(), twice).repeated).toEqual([
      {
        key: "EXPO_PUBLIC_SIGN_IN_ENABLED",
        classes: ["copiedFromProduction", "mustBeUnset"],
      },
    ])
  })
})
