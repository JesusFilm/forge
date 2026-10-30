/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// R6, R33: a test build takes its EXPO_PUBLIC_* values from the committed test
// settings only, so a key in the developer's shell never reaches a build.
const path = require("node:path")

const { CONFIG_DIR, readJson } = require("../lib/lists")
const { run } = require("../lib/proc")
const { buildEnv, xcodeEnvLocal } = require("../lib/testBuild/env")

const committed = readJson(path.join(CONFIG_DIR, "test-settings.json"))

// The committed list copies no production value yet, so this one does.
const settings = {
  ...committed,
  copiedFromProduction: {
    ...committed.copiedFromProduction,
    EXPO_PUBLIC_EXPLORE_ENABLED: "1",
  },
}

const parentEnv = {
  PATH: "/usr/bin:/bin",
  HOME: "/Users/tester",
  USER: "tester",
  LANG: "C",
  EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "planted-datadog-token",
  EXPO_PUBLIC_ADMIN_GRAPHQL_TOKEN: "planted-fleet-bearer",
  EXPO_PUBLIC_SIGN_IN_ENABLED: "1",
  EXPO_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
  EXPO_TOKEN: "planted-expo-token",
  NODE_OPTIONS: "--require /tmp/hook.js",
}

function testEnv() {
  return buildEnv({
    parentEnv,
    settings,
    tmpDir: "/tmp/build-1/tmp",
    javaHome: "/jdk17",
    androidHome: "/sdk",
  })
}

describe("the test build environment", () => {
  it("excludes EXPO_PUBLIC_DATADOG_CLIENT_TOKEN when the parent shell sets it", () => {
    expect(testEnv()).not.toHaveProperty("EXPO_PUBLIC_DATADOG_CLIENT_TOKEN")
  })

  it("contains each copied and test value from the list, and no must-be-unset key", () => {
    const env = testEnv()

    expect(env.EXPO_PUBLIC_EXPLORE_ENABLED).toBe("1")
    expect(Object.keys(committed.testValue).length).toBeGreaterThan(0)
    for (const [key, value] of Object.entries(committed.testValue)) {
      expect(env[key]).toBe(value)
    }
    for (const key of committed.mustBeUnset) {
      expect(env).not.toHaveProperty(key)
    }
  })

  it("leaves a key unset when the list also names it in mustBeUnset", () => {
    const env = buildEnv({
      parentEnv,
      settings: {
        ...settings,
        testValue: {
          ...settings.testValue,
          EXPO_PUBLIC_DATADOG_CLIENT_TOKEN: "planted-in-the-list",
        },
      },
      tmpDir: "/tmp/build-1/tmp",
    })
    expect(env).not.toHaveProperty("EXPO_PUBLIC_DATADOG_CLIENT_TOKEN")
  })

  it("leaves a production key with no value unset, even when the shell sets it", () => {
    expect(testEnv()).not.toHaveProperty("EXPO_PUBLIC_SIGN_IN_ENABLED")
  })

  it("passes only the allowlist, plus the build's own values", () => {
    expect(testEnv()).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/Users/tester",
      USER: "tester",
      LANG: "en_US.UTF-8",
      CI: "1",
      EXPO_NO_DOTENV: "1",
      TMPDIR: "/tmp/build-1/tmp",
      JAVA_HOME: "/jdk17",
      ANDROID_HOME: "/sdk",
      EXPO_PUBLIC_EXPLORE_ENABLED: "1",
      ...committed.testValue,
    })
  })

  it("gives Xcode's shell the same EXPO_* values through ios/.xcode.env.local", async () => {
    const env = {
      ...testEnv(),
      EXPO_PUBLIC_AUTH_BASE_URL: "http://localhost:38211/a?x=1&y='2' $HOME",
    }
    const script = `${xcodeEnvLocal(env)}\nenv | grep '^EXPO_' | sort`
    const result = await run("/bin/sh", ["-c", script], {
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 5000,
    })
    const expected = Object.keys(env)
      .filter((key) => key.startsWith("EXPO_"))
      .sort()
      .map((key) => `${key}=${env[key]}`)
    expect(result.stdout.trim().split("\n")).toEqual(expected)
  })
})
