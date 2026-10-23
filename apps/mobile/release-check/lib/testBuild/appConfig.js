"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// The test-only native settings (KTD4), written into the runner worktree only,
// so app.json, eas.json, and the plugins (the production fingerprint) stay.
// The build copies this file into the worktree, so it requires built-ins only.

const fs = require("node:fs")
const path = require("node:path")

const GENERATED_DIR = ".release-check"
const PLUGIN_FILE = "withFirebaseAnalyticsDeactivated.js"
const PLUGIN_SOURCE = path.resolve(__dirname, "../../plugins", PLUGIN_FILE)
const CONFIG_FILES = [
  "app.config.js",
  "app.config.ts",
  "app.config.mjs",
  "app.config.cjs",
]

class AppConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = "AppConfigError"
  }
}

/** app.json's `expo` object with the test settings on top. Pure. */
function testAppConfig(config, { pluginPath }) {
  const plugins = (config.plugins ?? []).map((entry) => {
    const [name, options] = Array.isArray(entry) ? entry : [entry, undefined]
    if (name !== "expo-build-properties") return entry
    return [
      name,
      {
        ...options,
        android: { ...options?.android, usesCleartextTraffic: true },
      },
    ]
  })
  const updates = { ...config.updates, enabled: false }
  delete updates.requestHeaders
  return {
    ...config,
    updates,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        FIREBASE_ANALYTICS_COLLECTION_DEACTIVATED: true,
      },
    },
    plugins: [...plugins, pluginPath],
  }
}

function appConfigSource() {
  return [
    "// Written by the mobile release check for one test build. Never commit it.",
    `const { testAppConfig } = require("./${GENERATED_DIR}/appConfig.js")`,
    "",
    "module.exports = ({ config }) =>",
    `  testAppConfig(config, { pluginPath: "./${GENERATED_DIR}/${PLUGIN_FILE}" })`,
    "",
  ].join("\n")
}

/** Sets the React Native Firebase off switch in the worktree's firebase.json. */
function deactivateFirebaseJson(mobileDir) {
  const file = path.join(mobileDir, "firebase.json")
  if (!fs.existsSync(file)) return false
  const json = JSON.parse(fs.readFileSync(file, "utf8"))
  json["react-native"] = {
    ...json["react-native"],
    analytics_collection_deactivated: true,
  }
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`)
  return true
}

// A committed app config would change app.json's settings in ways that this
// transform does not know, so the build stops instead of writing over it.
function writeTestAppConfig(mobileDir, { pluginSource = PLUGIN_SOURCE } = {}) {
  const existing = CONFIG_FILES.filter((name) =>
    fs.existsSync(path.join(mobileDir, name)),
  )
  if (existing.length > 0) {
    throw new AppConfigError(
      `the tested commit has apps/mobile/${existing[0]}; the test build needs app.json alone`,
    )
  }
  const generatedDir = path.join(mobileDir, GENERATED_DIR)
  fs.mkdirSync(generatedDir, { recursive: true })
  fs.copyFileSync(__filename, path.join(generatedDir, "appConfig.js"))
  fs.copyFileSync(pluginSource, path.join(generatedDir, PLUGIN_FILE))
  fs.writeFileSync(path.join(mobileDir, "app.config.js"), appConfigSource())
  return { firebaseJson: deactivateFirebaseJson(mobileDir) }
}

module.exports = {
  GENERATED_DIR,
  PLUGIN_FILE,
  testAppConfig,
  writeTestAppConfig,
}
