// Adds the Google Assistant app-search intent filter to MainActivity.
// app.json's `android.intentFilters` can't express this action: Expo prebuild
// unconditionally prefixes `android.intent.action.` onto the action name, and
// MEDIA_PLAY_FROM_SEARCH lives under `android.media.action.` — so the filter
// is injected here with the exact literal instead.

const { withAndroidManifest } = require("expo/config-plugins")

const SEARCH_ACTION = "android.media.action.MEDIA_PLAY_FROM_SEARCH"

module.exports = function withAssistantSearchIntent(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0]
    const mainActivity = application?.activity?.find(
      (activity) => activity.$["android:name"] === ".MainActivity",
    )
    if (mainActivity == null) {
      throw new Error(
        "withAssistantSearchIntent: .MainActivity not found in AndroidManifest",
      )
    }
    mainActivity["intent-filter"] = mainActivity["intent-filter"] ?? []
    const alreadyAdded = mainActivity["intent-filter"].some((filter) =>
      (filter.action ?? []).some(
        (action) => action.$["android:name"] === SEARCH_ACTION,
      ),
    )
    if (!alreadyAdded) {
      mainActivity["intent-filter"].push({
        action: [{ $: { "android:name": SEARCH_ACTION } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
        ],
      })
    }
    return mod
  })
}
