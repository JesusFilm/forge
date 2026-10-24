// Loaded defensively, matching the other plugins here: Expo config plugins are
// only resolvable in prebuild contexts. On resolution failure, no-op rather
// than crash Metro/jest.
let withPodfile = null
try {
  ;({ withPodfile } = require("expo/config-plugins"))
} catch {
  withPodfile = null
}

/**
 * Let MMKVCore compile under Xcode 26.
 *
 * MMKV 2.4.1's `secure_wipe` takes its `MMKV_APPLE` branch and calls
 * `memset_s`, but Apple's libc only DECLARES that function when
 * `__STDC_WANT_LIB_EXT1__` is 1 before <string.h> — which MMKV never sets. The
 * pod therefore fails with "use of undeclared identifier 'memset_s'" and no
 * iOS build of this app succeeds.
 *
 * MMKV is not a direct dependency: `@kesha-antonov/react-native-background-
 * downloader` asks for `MMKV >= 1.2.0`, unpinned, so any fresh `pod install`
 * resolves to whatever is newest. Defining the macro is preferred over pinning
 * because the version floor belongs to that package, not to this app.
 */
const MARKER = "__STDC_WANT_LIB_EXT1__"

const POST_INSTALL_HOOK = `
    # MMKV 2.4.1 calls memset_s without asking for C11 Annex K first, so Apple's
    # libc never declares it. Defining this is what makes the pod compile.
    installer.pods_project.targets.each do |target|
      next unless ['MMKVCore', 'MMKV'].include?(target.name)
      target.build_configurations.each do |cfg|
        defs = cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] || ['$(inherited)']
        defs = [defs] if defs.is_a?(String)
        cfg.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs + ['${MARKER}=1']
      end
    end
`

/**
 * Insert the hook inside the existing `post_install do |installer|` block,
 * after the react-native call it already makes. Pure so it unit-tests without
 * a prebuild. Idempotent: a Podfile that already carries the marker is
 * returned unchanged, because prebuild re-runs mods over generated output.
 */
function addMmkvDefine(podfile) {
  if (podfile.includes(MARKER)) return podfile

  const anchor = /(post_install do \|installer\|\n)/
  if (!anchor.test(podfile)) {
    throw new Error(
      "[withMmkvSecureWipeFix] no post_install block found in the Podfile. " +
        "The Expo template changed shape; MMKV will not compile under Xcode 26 " +
        "without this define, so failing prebuild rather than shipping a build " +
        "that cannot succeed.",
    )
  }
  return podfile.replace(anchor, `$1${POST_INSTALL_HOOK}`)
}

module.exports = function withMmkvSecureWipeFix(config) {
  if (!withPodfile) {
    console.warn(
      "[withMmkvSecureWipeFix] expo/config-plugins not resolvable; skipping " +
        "the MMKV compile fix. Run `pnpm install` so apps/mobile has expo, " +
        "then re-run `expo prebuild`.",
    )
    return config
  }
  return withPodfile(config, (cfg) => {
    cfg.modResults.contents = addMmkvDefine(cfg.modResults.contents)
    return cfg
  })
}

// Exported for unit tests — the transform is pure. Silently inert if dropped:
// nothing throws until an actual iOS compile reaches AESCrypt.cpp.
module.exports.addMmkvDefine = addMmkvDefine
module.exports.MARKER = MARKER
