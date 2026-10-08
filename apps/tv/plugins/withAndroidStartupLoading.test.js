/* global require, jest, test, expect */
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("expo/config-plugins", () => ({
  withMainActivity: (_config, callback) => callback(_config),
}))
const plugin = require("./withAndroidStartupLoading")
const fs = require("fs")
const path = require("path")
const restart =
  "expo.modules.nativeandroidplayer.PreviewAppRestart.onActivityDestroyed(this)"
const source = `class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }
}
`

test("prebuild injects the cover and restart cleanup only once", () => {
  const config = { modResults: { language: "kt", contents: source } }
  plugin(config)
  const first = config.modResults.contents
  expect(first).toContain("StartupLoadingOverlay.show(this)")
  expect(first).toContain(`super.onDestroy()\n    ${restart}`)
  plugin(config)
  expect(config.modResults.contents).toBe(first)
  expect(first.match(/override fun onDestroy\(\)/g)).toHaveLength(1)
})

test("an existing onDestroy retains cleanup after the host reset", () => {
  const existing = source.replace(
    /\n}\n$/,
    "\n  override fun onDestroy() {\n    super.onDestroy()\n    cleanup()\n  }\n}\n",
  )
  const result = plugin.injectPreviewRestart(existing)
  expect(result).toContain(`super.onDestroy()\n    ${restart}\n    cleanup()`)
  expect(result.match(/override fun onDestroy\(\)/g)).toHaveLength(1)
  expect(plugin.injectPreviewRestart(result)).toBe(result)
})

test("prebuild refuses an onDestroy without a safe super-call seam", () => {
  const invalid = source.replace(
    /\n}\n$/,
    "\n  override fun onDestroy() {}\n}\n",
  )
  expect(() => plugin.injectPreviewRestart(invalid)).toThrow(
    "onDestroy super call not found",
  )
})

test("prebuild refuses unsupported Activity sources", () => {
  expect(() => plugin.injectPreviewRestart("unexpected source")).toThrow(
    "class end not found",
  )
  expect(() => plugin.injectStartupLoading("class MainActivity {}\n")).toThrow(
    "onCreate not found",
  )
})

test("only the explicit restart clears the host, after the old root detaches", () => {
  const native = fs.readFileSync(
    path.join(
      __dirname,
      "../modules/native-android-player/android/src/main/java/expo/modules/nativeandroidplayer/PreviewAppRestart.kt",
    ),
    "utf8",
  )
  expect(native).toContain(
    "restartingActivity = activity\n    activity.recreate()",
  )
  expect(native).toContain("if (restartingActivity !== activity) return")
  expect(native).toContain("restartingActivity = null")
  expect(native).toContain("reactNativeHost.clear()")
  expect(native).not.toMatch(/killProcess|exitProcess|postDelayed|delete/)
  const result = plugin.injectPreviewRestart(source)
  expect(result.indexOf("super.onDestroy()")).toBeLessThan(
    result.indexOf(restart),
  )
})
