// Loaded defensively: @expo/config-plugins is only resolvable when it's a direct
// dep of apps/mobile (it is, via devDeps). On resolution failure, no-op rather
// than crash prebuild — the prebuilt ios/ AppDelegate is already patched.
let withAppDelegate = null
try {
  ;({ withAppDelegate } = require("@expo/config-plugins"))
} catch {
  withAppDelegate = null
}

/**
 * The package's own plugin injects handleEventsForBackgroundURLSession into
 * ReactNativeDelegate, but iOS only calls it on the real UIApplicationDelegate, so
 * backgrounded downloads stick on "downloading". Relocates it; register AFTER the package plugin (app.json).
 */

const METHOD = `
  // react-native-background-downloader: deliver the background URLSession
  // completion handler to the module. Relocated onto AppDelegate (the real
  // UIApplicationDelegate) by plugins/withBackgroundDownloaderAppDelegate.js;
  // the package's own plugin injects it into ReactNativeDelegate where iOS
  // never calls it.
  public override func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    RNBackgroundDownloader.setCompletionHandlerWithIdentifier(identifier, completionHandler: completionHandler)
  }
`

/** Remove a handleEventsForBackgroundURLSession method wherever it sits. */
function removeBackgroundSessionMethod(src) {
  const marker = "handleEventsForBackgroundURLSession"
  const mi = src.indexOf(marker)
  if (mi === -1) return src
  const funcStart = src.lastIndexOf("func application", mi)
  if (funcStart === -1) return src
  const lineStart = src.lastIndexOf("\n", funcStart) + 1
  const braceOpen = src.indexOf("{", mi)
  if (braceOpen === -1) return src
  let depth = 0
  let end = -1
  for (let i = braceOpen; i < src.length; i++) {
    const ch = src[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) return src
  let after = end + 1
  if (src[after] === "\n") after++
  return src.slice(0, lineStart) + src.slice(after)
}

/** Insert the corrected override before the AppDelegate class's closing brace. */
function insertIntoAppDelegate(src) {
  if (src.includes("handleEventsForBackgroundURLSession")) return src
  const anchor = src.search(/\n[A-Za-z@ ]*class ReactNativeDelegate\b/)
  const insertAt =
    anchor !== -1 ? src.lastIndexOf("}", anchor) : src.lastIndexOf("}")
  if (insertAt === -1) return src
  return src.slice(0, insertAt) + METHOD + src.slice(insertAt)
}

module.exports = function withBackgroundDownloaderAppDelegate(config) {
  if (!withAppDelegate) {
    console.warn(
      "[withBackgroundDownloaderAppDelegate] @expo/config-plugins not resolvable; " +
        "skipping AppDelegate relocation. Run `pnpm install` so apps/mobile has " +
        "@expo/config-plugins, then re-run `expo prebuild`.",
    )
    return config
  }
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") return cfg
    let contents = removeBackgroundSessionMethod(cfg.modResults.contents)
    contents = insertIntoAppDelegate(contents)
    cfg.modResults.contents = contents
    return cfg
  })
}

// Exported for unit tests — the AST transform is pure and a regression here
// silently breaks the native build (the method lands in the wrong Swift class).
// Attached after the default export above, which reassigns `module.exports`.
module.exports.removeBackgroundSessionMethod = removeBackgroundSessionMethod
module.exports.insertIntoAppDelegate = insertIntoAppDelegate
