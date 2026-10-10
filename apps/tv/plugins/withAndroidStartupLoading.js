/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withMainActivity } = require("expo/config-plugins")

const STARTUP =
  "expo.modules.nativeandroidplayer.StartupLoadingOverlay.show(this)"
const RESTART =
  "expo.modules.nativeandroidplayer.PreviewAppRestart.onActivityDestroyed(this)"

function injectStartupLoading(contents) {
  if (contents.includes(STARTUP)) return contents
  const onCreate = /super\.onCreate\((?:null|savedInstanceState)\)/
  if (!onCreate.test(contents)) {
    throw new Error(
      "withAndroidStartupLoading: MainActivity onCreate not found",
    )
  }
  return contents.replace(onCreate, (match) => `${match}\n    ${STARTUP}`)
}

function injectPreviewRestart(contents) {
  if (contents.includes(RESTART)) return contents
  if (/override fun onDestroy\(\)/.test(contents)) {
    const onDestroy = /(override fun onDestroy\(\)[\s\S]*?super\.onDestroy\(\))/
    if (!onDestroy.test(contents)) {
      throw new Error(
        "withAndroidStartupLoading: onDestroy super call not found",
      )
    }
    return contents.replace(onDestroy, (match) => `${match}\n    ${RESTART}`)
  }
  if (!/\n}\s*$/.test(contents)) {
    throw new Error(
      "withAndroidStartupLoading: MainActivity class end not found",
    )
  }
  return contents.replace(
    /\n}\s*$/,
    `\n  override fun onDestroy() {\n    super.onDestroy()\n    ${RESTART}\n  }\n}\n`,
  )
}

module.exports = function withAndroidStartupLoading(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("withAndroidStartupLoading requires Kotlin MainActivity")
    }
    mod.modResults.contents = injectPreviewRestart(
      injectStartupLoading(mod.modResults.contents),
    )
    return mod
  })
}
module.exports.injectStartupLoading = injectStartupLoading
module.exports.injectPreviewRestart = injectPreviewRestart
