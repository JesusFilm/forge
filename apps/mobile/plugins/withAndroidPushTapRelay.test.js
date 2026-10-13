/* global jest */
// Runs the REAL expo/config-plugins chain with the REAL expo-splash-screen and
// react-native-google-cast plugins, so the anchors and the mod order are real.
const { execFileSync } = require("child_process")
const path = require("path")
const { CodeGenerator, withPlugins } = require("expo/config-plugins")

const { applyPushTapRelay } = require("./withAndroidPushTapRelay")

const PLUGIN = "./plugins/withAndroidPushTapRelay"
const RESTORE_TAG = "forge-push-tap-relay-restore"
const NEW_INTENT_TAG = "forge-push-tap-relay-new-intent"
const SPLASH_TAG = "expo-splashscreen"
const CAST_TAG = "react-native-google-cast-onCreate"
const MAIN_ACTIVITY_WRITERS = [
  PLUGIN,
  "react-native-google-cast",
  "expo-splash-screen",
]

// The SDK 57 template, verbatim from expo@57.0.27 template.tgz
// (package/android/app/src/main/java/com/helloworld/MainActivity.kt).
// Re-capture on every SDK bump.
const TEMPLATE = `package com.helloworld

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
`

// This repo's prebuild output before this plugin, verbatim (2026-10-12;
// expo-splash-screen 57.0.9, react-native-google-cast 4.9.1). The real-chain
// test below reproduces it from TEMPLATE. Re-capture on every SDK bump.
const GENERATED = `package org.jesusfilm.forgewatch
import com.reactnative.googlecast.api.RNGCCastContext
import expo.modules.splashscreen.SplashScreenManager

import android.os.Build
import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    // setTheme(R.style.AppTheme);
    // @generated begin expo-splashscreen - expo prebuild (DO NOT MODIFY) sync-f3ff59a738c56c9a6119210cb55f0b613eb8b6af
    SplashScreenManager.registerOnActivity(this)
    // @generated end expo-splashscreen
    super.onCreate(null)
// @generated begin react-native-google-cast-onCreate - expo prebuild (DO NOT MODIFY) sync-489050f2bf9933a98bbd9d93137016ae14c22faa
    RNGCCastContext.getSharedInstance(this)
// @generated end react-native-google-cast-onCreate
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
`

// The Kotlin the plugin must write, pinned here so that each change to the
// generated code is a reviewed change. The marker lines are checked apart.
const RESTORE_BODY = [
  "    if (savedInstanceState != null ||",
  "      ((intent?.flags ?: 0) and android.content.Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {",
  "      val tapKey = expo.modules.notifications.service.NotificationsService.GOOGLE_MESSAGE_ID_KEY",
  '      val clause = if (savedInstanceState != null) "saved-state" else "history-flag"',
  "      val tapKeyPresent = intent?.hasExtra(tapKey) == true",
  "      intent?.removeExtra(tapKey)",
  '      android.util.Log.i("ForgePushTap", "restore clause=$clause tapKeyPresent=$tapKeyPresent")',
  "    }",
]
const NEW_INTENT_BODY = [
  "  override fun onNewIntent(intent: android.content.Intent) {",
  "    val extras = intent.extras",
  "    if (extras != null &&",
  "      extras.containsKey(expo.modules.notifications.service.NotificationsService.GOOGLE_MESSAGE_ID_KEY) &&",
  "      !extras.containsKey(expo.modules.notifications.service.NotificationsService.NOTIFICATION_RESPONSE_KEY) &&",
  "      !extras.containsKey(expo.modules.notifications.service.NotificationsService.TEXT_INPUT_NOTIFICATION_RESPONSE_KEY)) {",
  "      expo.modules.notifications.notifications.NotificationManager.onNotificationResponseFromExtras(extras)",
  "      intent.removeExtra(expo.modules.notifications.service.NotificationsService.GOOGLE_MESSAGE_ID_KEY)",
  '      android.util.Log.i("ForgePushTap", "new intent: tap handed to expo-notifications")',
  "    }",
  "    super.onNewIntent(intent)",
  "  }",
]

const SUPER_ON_CREATE = /super\.onCreate\(/

const lines = (src) => src.split("\n")
const lineIndex = (src, re) => lines(src).findIndex((line) => re.test(line))
const countLines = (src, re) =>
  lines(src).filter((line) => re.test(line)).length
const beginIndex = (src, tag) =>
  lines(src).findIndex((line) => line.includes(`@generated begin ${tag} -`))
const endIndex = (src, tag) =>
  lines(src).findIndex((line) => line.endsWith(`@generated end ${tag}`))
const nameOf = (entry) => (Array.isArray(entry) ? entry[0] : entry)

/** The lines strictly between a tag's markers, or null without both. */
function blockBody(src, tag) {
  const begin = beginIndex(src, tag)
  const end = endIndex(src, tag)
  return begin === -1 || end === -1 ? null : lines(src).slice(begin + 1, end)
}

/** Expo's own remover, so the expected text does not come from the plugin. */
function stripRelay(src) {
  return [RESTORE_TAG, NEW_INTENT_TAG].reduce(
    (current, tag) =>
      CodeGenerator.removeContents({ src: current, tag }).contents,
    src,
  )
}

function expectValidMainActivity(src) {
  const onCreate = lineIndex(src, /override fun onCreate\(/)
  const superLine = lineIndex(src, SUPER_ON_CREATE)
  expect(countLines(src, SUPER_ON_CREATE)).toBe(1)
  expect(blockBody(src, SPLASH_TAG)).toEqual([
    "    SplashScreenManager.registerOnActivity(this)",
  ])
  expect(blockBody(src, CAST_TAG)).toEqual([
    "    RNGCCastContext.getSharedInstance(this)",
  ])
  expect(blockBody(src, RESTORE_TAG)).toEqual(RESTORE_BODY)
  expect(blockBody(src, NEW_INTENT_TAG)).toEqual(NEW_INTENT_BODY)
  for (const tag of [SPLASH_TAG, RESTORE_TAG]) {
    expect(beginIndex(src, tag)).toBeGreaterThan(onCreate)
    expect(endIndex(src, tag)).toBeLessThan(superLine)
  }
  expect(beginIndex(src, CAST_TAG)).toBe(superLine + 1)
  expect(beginIndex(src, NEW_INTENT_TAG)).toBe(
    lineIndex(src, /^class MainActivity\b/) + 1,
  )
}

describe("applyPushTapRelay", () => {
  it("puts Block A directly above the onCreate super call and Block B first in the class (template)", () => {
    const out = applyPushTapRelay(TEMPLATE)
    const all = lines(out)
    const superLine = lineIndex(out, SUPER_ON_CREATE)

    expect(all[superLine]).toBe("    super.onCreate(null)")
    expect(all[superLine - 1]).toBe(`    // @generated end ${RESTORE_TAG}`)
    expect(all[beginIndex(out, RESTORE_TAG) - 1]).toBe(
      "    setTheme(R.style.AppTheme);",
    )
    expect(blockBody(out, RESTORE_TAG)).toEqual(RESTORE_BODY)

    const classLine = all.indexOf("class MainActivity : ReactActivity() {")
    expect(beginIndex(out, NEW_INTENT_TAG)).toBe(classLine + 1)
    expect(all[endIndex(out, NEW_INTENT_TAG)]).toBe(
      `  // @generated end ${NEW_INTENT_TAG}`,
    )
    expect(all[endIndex(out, NEW_INTENT_TAG) + 1]).toBe(
      "  override fun onCreate(savedInstanceState: Bundle?) {",
    )
    expect(blockBody(out, NEW_INTENT_TAG)).toEqual(NEW_INTENT_BODY)

    // Only the two blocks are added; every template line is kept.
    expect(stripRelay(out)).toBe(TEMPLATE)
  })

  it("keeps each vendor block at the onCreate super call (generated file)", () => {
    const out = applyPushTapRelay(GENERATED)
    const superLine = lineIndex(out, SUPER_ON_CREATE)

    expect(lines(out)[superLine]).toBe("    super.onCreate(null)")
    // Splash, then Block A, then the super call, then cast.
    expect(beginIndex(out, RESTORE_TAG)).toBe(endIndex(out, SPLASH_TAG) + 1)
    expect(endIndex(out, RESTORE_TAG)).toBe(superLine - 1)
    expect(beginIndex(out, CAST_TAG)).toBe(superLine + 1)
    expectValidMainActivity(out)
    expect(stripRelay(out)).toBe(GENERATED)
  })

  it.each([
    ["template", TEMPLATE],
    ["generated", GENERATED],
  ])("gives the same text when applied twice (%s)", (_name, src) => {
    const once = applyPushTapRelay(src)
    expect(once).not.toBe(src)
    expect(applyPushTapRelay(once)).toBe(once)
  })

  it("replaces a block that an older version wrote, and keeps one copy", () => {
    // What a reused android/ folder holds after the block text changes.
    const withOldRestore = CodeGenerator.mergeContents({
      src: TEMPLATE,
      newSrc: '    android.util.Log.i("ForgePushTap", "old")',
      tag: RESTORE_TAG,
      anchor: SUPER_ON_CREATE,
      offset: 0,
      comment: "    //",
    }).contents
    const stale = CodeGenerator.mergeContents({
      src: withOldRestore,
      newSrc:
        "  override fun onNewIntent(intent: android.content.Intent) {\n    super.onNewIntent(intent)\n  }",
      tag: NEW_INTENT_TAG,
      anchor: /^class MainActivity\b/,
      offset: 1,
      comment: "  //",
    }).contents
    expect(stale).toContain('"old"')

    const out = applyPushTapRelay(stale)

    expect(out).not.toContain('"old"')
    expect(blockBody(out, RESTORE_TAG)).toEqual(RESTORE_BODY)
    expect(blockBody(out, NEW_INTENT_TAG)).toEqual(NEW_INTENT_BODY)
    for (const tag of [RESTORE_TAG, NEW_INTENT_TAG]) {
      expect(countLines(out, new RegExp(`@generated begin ${tag} -`))).toBe(1)
    }
    expect(countLines(out, /fun onNewIntent\(/)).toBe(1)
    expect(out).toBe(applyPushTapRelay(TEMPLATE))
  })

  it("writes no line that holds the onCreate super-call text", () => {
    // expo-splash-screen and react-native-google-cast insert at the FIRST line
    // that matches it, so a copy in a relay block would move their blocks.
    for (const src of [TEMPLATE, GENERATED]) {
      const out = applyPushTapRelay(src)
      for (const tag of [RESTORE_TAG, NEW_INTENT_TAG]) {
        const block = lines(out).slice(
          beginIndex(out, tag),
          endIndex(out, tag) + 1,
        )
        expect(block.length).toBeGreaterThan(2)
        expect(block.filter((line) => SUPER_ON_CREATE.test(line))).toEqual([])
      }
      expect(countLines(out, SUPER_ON_CREATE)).toBe(1)
    }
  })

  it("refuses a MainActivity that already overrides onNewIntent", () => {
    // Two overrides fail late in an EAS build as conflicting overloads.
    const foreign = TEMPLATE.replace(
      '  override fun getMainComponentName(): String = "main"',
      '  override fun onNewIntent(intent: Intent?) {\n    super.onNewIntent(intent)\n  }\n\n  override fun getMainComponentName(): String = "main"',
    )
    expect(foreign).not.toBe(TEMPLATE)

    expect(() => applyPushTapRelay(foreign)).toThrow(
      /already overrides onNewIntent/,
    )
  })

  it.each([
    [
      "no class declaration",
      TEMPLATE.replace(
        "class MainActivity : ReactActivity() {",
        "object MainActivity {",
      ),
      /class MainActivity/,
    ],
    [
      "no onCreate super call",
      TEMPLATE.replace("    super.onCreate(null)\n", ""),
      /onCreate superclass call/,
    ],
  ])("refuses a MainActivity with %s", (_name, src, message) => {
    expect(src).not.toBe(TEMPLATE)
    expect(() => applyPushTapRelay(src)).toThrow(message)
  })
})

describe("in the real mod chain with expo-splash-screen and react-native-google-cast", () => {
  // Prebuild renames the template package before any mod runs.
  const PREBUILT_TEMPLATE = TEMPLATE.replace(
    "package com.helloworld",
    "package org.jesusfilm.forgewatch",
  )

  /** The app.json entries of every MainActivity writer, in app.json order. */
  function appJsonWriters() {
    const { expo } = require("../app.json")
    return expo.plugins.filter((entry) =>
      MAIN_ACTIVITY_WRITERS.includes(nameOf(entry)),
    )
  }

  /** Registers the plugins in array order, then runs the MainActivity mods. */
  async function runMainActivityMods(plugins) {
    const projectRoot = path.join(__dirname, "..")
    const config = withPlugins(
      { name: "forge-watch", slug: "fixture", _internal: { projectRoot } },
      plugins,
    )
    const result = await config.mods.android.mainActivity({
      ...config,
      modRequest: {
        platform: "android",
        modName: "mainActivity",
        projectRoot,
        platformProjectRoot: path.join(projectRoot, "android"),
      },
      modResults: { language: "kt", contents: PREBUILT_TEMPLATE },
    })
    return result.modResults.contents
  }

  it("writes both vendor blocks and both relay blocks in app.json order", async () => {
    const writers = appJsonWriters()
    expect(writers.map(nameOf)).toContain(PLUGIN)
    expect(writers).toHaveLength(MAIN_ACTIVITY_WRITERS.length)

    const out = await runMainActivityMods(writers)

    expectValidMainActivity(out)
    expect(stripRelay(out)).toBe(GENERATED)
  })

  it("also writes a valid file in the reversed order", async () => {
    const out = await runMainActivityMods([...appJsonWriters()].reverse())

    expectValidMainActivity(out)
  })
})

describe("the plugin entry point", () => {
  function loadWithSyncMod() {
    let plugin
    jest.isolateModules(() => {
      const actual = jest.requireActual("expo/config-plugins")
      jest.doMock("expo/config-plugins", () => ({
        ...actual,
        withMainActivity: (config, action) => action(config),
      }))
      plugin = require("./withAndroidPushTapRelay")
    })
    jest.dontMock("expo/config-plugins")
    return plugin
  }

  it("writes the relay into modResults.contents", () => {
    const plugin = loadWithSyncMod()
    const result = plugin({
      modResults: { language: "kt", contents: TEMPLATE },
    })

    expect(result.modResults.contents).not.toBe(TEMPLATE)
    expect(blockBody(result.modResults.contents, RESTORE_TAG)).toEqual(
      RESTORE_BODY,
    )
    expect(blockBody(result.modResults.contents, NEW_INTENT_TAG)).toEqual(
      NEW_INTENT_BODY,
    )
  })

  it("refuses a Java MainActivity", () => {
    // The language flag alone must decide: this Kotlin text would otherwise
    // transform cleanly, so a skipped check cannot pass.
    const plugin = loadWithSyncMod()

    expect(() =>
      plugin({ modResults: { language: "java", contents: TEMPLATE } }),
    ).toThrow(/Kotlin MainActivity/)
  })
})

// The fixture above is a hand copy, and the restart path depends on singleTask,
// so an Expo bump that changes either must fail here, not on a device.
describe("the installed expo template", () => {
  const templateTgz = path.join(
    path.dirname(
      require.resolve("expo/package.json", {
        paths: [path.join(__dirname, "..")],
      }),
    ),
    "template.tgz",
  )
  const readTemplateFile = (file) =>
    execFileSync("tar", ["-xzOf", templateTgz, `package/${file}`], {
      encoding: "utf8",
    })
  const SINGLE_TASK =
    /<activity android:name="\.MainActivity"[^>]*android:launchMode="singleTask"/

  it("still matches the TEMPLATE fixture", () => {
    expect(
      readTemplateFile(
        "android/app/src/main/java/com/helloworld/MainActivity.kt",
      ),
    ).toBe(TEMPLATE)
  })

  it("still launches MainActivity as singleTask", () => {
    expect(
      readTemplateFile("android/app/src/main/AndroidManifest.xml"),
    ).toMatch(SINGLE_TASK)
  })

  it("rejects another launch mode (negative control)", () => {
    expect(
      '<activity android:name=".MainActivity" android:launchMode="singleTop">',
    ).not.toMatch(SINGLE_TASK)
  })
})
