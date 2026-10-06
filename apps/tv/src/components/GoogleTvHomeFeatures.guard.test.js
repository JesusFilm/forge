/* eslint-disable @typescript-eslint/no-require-imports */
/* global test, expect, require */
const fs = require("fs")
const path = require("path")
const root = path.resolve(__dirname, "../..")
const native = fs.readFileSync(
  path.join(
    root,
    "modules/google-tv-home/android/src/main/java/expo/modules/googletvhome/GoogleTvHomeModule.kt",
  ),
  "utf8",
)

test("production discovery is blocked without a production identity", () => {
  expect(native).toContain(
    '!continuation && environment(context) == "production"',
  )
  expect(native).not.toContain("UUID")
  expect(native).toContain(
    'require(continuation || environment(this) == "verification")',
  )
})
test("continuation is local only and does not invent an account", () => {
  expect(native).toContain(
    "ContinuationCluster.Builder().setSyncAcrossDevices(false)",
  )
  expect(native).toContain("ClusterType.TYPE_CONTINUATION")
  expect(native).toContain("setLastPlayBackPositionTimeMillis")
})
test("film entities include the catalogue category and free playback availability", () => {
  expect(native).toContain('.addGenre("Faith & Scripture")')
  expect(native).toContain(
    ".setAvailability(ContentAvailability.AVAILABILITY_AVAILABLE)",
  )
})
test("native discovery has a daily limit and separate verifier environment", () => {
  expect(native).toContain("< 86400000")
  expect(native).toContain("publishedAt-${environment(this)}")
  expect(
    fs.readFileSync(
      path.join(
        root,
        "modules/google-tv-home/android/src/release/AndroidManifest.xml",
      ),
      "utf8",
    ),
  ).toContain('android:value="PRODUCTION"')
  expect(
    fs.readFileSync(
      path.join(
        root,
        "modules/google-tv-home/android/src/verification/AndroidManifest.xml",
      ),
      "utf8",
    ),
  ).not.toContain('android:value="PRODUCTION"')
})
