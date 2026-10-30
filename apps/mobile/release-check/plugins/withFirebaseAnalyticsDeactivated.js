"use strict"
/* eslint-disable @typescript-eslint/no-require-imports */
/* global module, require */
// A test build only (KTD4, R34): Android meta-data that turns Firebase
// Analytics off for good. `@react-native-firebase/analytics` declares the same
// name with `false`, so `tools:replace` is what lets the manifest merge pass.

// Config plugins resolve only in prebuild, so a failed require is a no-op.
let withAndroidManifest = null
try {
  ;({ withAndroidManifest } = require("expo/config-plugins"))
} catch {
  withAndroidManifest = null
}

const META_DATA_NAME = "firebase_analytics_collection_deactivated"
const TOOLS_NAMESPACE = "http://schemas.android.com/tools"

/** Sets the meta-data once on the xml2js manifest shape that a mod receives. */
function deactivateFirebaseAnalytics(androidManifest) {
  const manifest = androidManifest.manifest
  manifest.$ = { ...manifest.$, "xmlns:tools": TOOLS_NAMESPACE }
  const application = manifest.application[0]
  const entry = {
    $: {
      "android:name": META_DATA_NAME,
      "android:value": "true",
      "tools:replace": "android:value",
    },
  }
  const metaData = application["meta-data"] ?? []
  const index = metaData.findIndex(
    (item) => item.$?.["android:name"] === META_DATA_NAME,
  )
  application["meta-data"] =
    index < 0
      ? [...metaData, entry]
      : metaData.map((item, at) => (at === index ? entry : item))
  return androidManifest
}

function withFirebaseAnalyticsDeactivated(config) {
  if (!withAndroidManifest) return config
  return withAndroidManifest(config, (cfg) => {
    cfg.modResults = deactivateFirebaseAnalytics(cfg.modResults)
    return cfg
  })
}

module.exports = withFirebaseAnalyticsDeactivated
module.exports.META_DATA_NAME = META_DATA_NAME
module.exports.TOOLS_NAMESPACE = TOOLS_NAMESPACE
module.exports.deactivateFirebaseAnalytics = deactivateFirebaseAnalytics
