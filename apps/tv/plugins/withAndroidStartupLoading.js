/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports */
const { withMainActivity } = require("expo/config-plugins")

const STARTUP =
  "expo.modules.nativeandroidplayer.StartupLoadingOverlay.show(this)"

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

module.exports = function withAndroidStartupLoading(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== "kt") {
      throw new Error("withAndroidStartupLoading requires Kotlin MainActivity")
    }
    mod.modResults.contents = injectStartupLoading(mod.modResults.contents)
    return mod
  })
}
module.exports.injectStartupLoading = injectStartupLoading
