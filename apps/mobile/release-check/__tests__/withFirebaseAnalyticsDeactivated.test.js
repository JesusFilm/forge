/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
// KTD4, R34: the test build's manifest turns Firebase Analytics off for good,
// and the attribute that wins over the analytics library's own `false`.
const {
  deactivateFirebaseAnalytics,
} = require("../plugins/withFirebaseAnalyticsDeactivated")

// The xml2js shape that a withAndroidManifest mod receives after prebuild.
function prebuiltManifest() {
  return {
    manifest: {
      $: {
        "xmlns:android": "http://schemas.android.com/apk/res/android",
      },
      application: [
        {
          $: { "android:name": ".MainApplication" },
          "meta-data": [
            {
              $: {
                "android:name": "expo.modules.updates.ENABLED",
                "android:value": "false",
              },
            },
          ],
        },
      ],
    },
  }
}

const DEACTIVATED = {
  $: {
    "android:name": "firebase_analytics_collection_deactivated",
    "android:value": "true",
    "tools:replace": "android:value",
  },
}

describe("withFirebaseAnalyticsDeactivated", () => {
  it("adds the meta-data once with tools:replace and declares the tools namespace", () => {
    const result = deactivateFirebaseAnalytics(prebuiltManifest())

    expect(result.manifest.$).toEqual({
      "xmlns:android": "http://schemas.android.com/apk/res/android",
      "xmlns:tools": "http://schemas.android.com/tools",
    })
    expect(result.manifest.application[0]["meta-data"]).toEqual([
      {
        $: {
          "android:name": "expo.modules.updates.ENABLED",
          "android:value": "false",
        },
      },
      DEACTIVATED,
    ])
  })

  it("changes nothing when it runs a second time", () => {
    const once = deactivateFirebaseAnalytics(prebuiltManifest())
    const snapshot = JSON.parse(JSON.stringify(once))

    expect(deactivateFirebaseAnalytics(once)).toEqual(snapshot)
  })

  it("replaces a false value in place instead of adding a second entry", () => {
    const manifest = prebuiltManifest()
    manifest.manifest.application[0]["meta-data"].unshift({
      $: {
        "android:name": "firebase_analytics_collection_deactivated",
        "android:value": "false",
      },
    })

    const metaData =
      deactivateFirebaseAnalytics(manifest).manifest.application[0]["meta-data"]

    expect(metaData).toEqual([
      DEACTIVATED,
      {
        $: {
          "android:name": "expo.modules.updates.ENABLED",
          "android:value": "false",
        },
      },
    ])
  })
})
