// Plain JS (like the other config guards here): the RN tsconfig has no Node
// types, and this guard reads installed package files off disk.
/* eslint-disable @typescript-eslint/no-require-imports */
/* global describe, expect, it, require */
const fs = require("fs")
const path = require("path")

// R12/KTD5: plugins/withAndroidPushTapRelay.js depends on Expo internals that no
// public API promises, so this file pins them. A red test means the fix may be
// stale or deliver a tap twice; it does not mean the build is bad.
const APP_ROOT = path.resolve(__dirname, "../../..")

const PINNED_VERSIONS = {
  expo: "57.0.31",
  "expo-notifications": "57.0.23",
  "expo-updates": "57.0.26",
}

const RECHECK =
  "Re-check expo/expo#49254 and apps/mobile/plugins/withAndroidPushTapRelay.js. " +
  "Expo PR #47615 drains the tap queue in SDK 58, so an SDK 58 upgrade is expected to trip this."

const WRAPPER =
  "android/src/main/java/expo/modules/ReactActivityDelegateWrapper.kt"
const SERVICE =
  "android/src/main/java/expo/modules/notifications/service/NotificationsService.kt"
const LISTENER =
  "android/src/main/java/expo/modules/notifications/service/delegates/ExpoNotificationLifecycleListener.kt"
const MANAGER =
  "android/src/main/java/expo/modules/notifications/notifications/NotificationManager.kt"
const UPDATES_PACKAGE =
  "android/src/main/java/expo/modules/updates/UpdatesPackage.kt"

function packageDir(name) {
  return path.dirname(
    require.resolve(`${name}/package.json`, { paths: [APP_ROOT] }),
  )
}

function readInstalled(name, relative) {
  return fs.readFileSync(path.join(packageDir(name), relative), "utf8")
}

function installedVersion(name) {
  return JSON.parse(
    fs.readFileSync(path.join(packageDir(name), "package.json"), "utf8"),
  ).version
}

// Jest cannot attach a message to `expect`, so the pinned facts throw their own.
function assertVersion(name, actual, pinned) {
  if (actual !== pinned) {
    throw new Error(
      `${name} is ${actual}, but the tap relay was verified on ${pinned}. ${RECHECK}`,
    )
  }
}

function assertFact(fact, source) {
  if (!fact.matches(source)) {
    throw new Error(`Upstream fact changed: ${fact.name}. ${RECHECK}`)
  }
}

// `matches` reads stable text, not line numbers. `breakIt` rewrites only the
// pinned line, so the negative control proves the matcher keys on that line.
const FACTS = [
  {
    name: "the activity wrapper's onNewIntent returns early until the app has loaded",
    pkg: "expo",
    file: WRAPPER,
    matches: (s) =>
      /override fun onNewIntent\(intent: Intent\?\): Boolean \{\s*if \(!loadAppReady\.isCompleted\) \{\s*return false\s*\}/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        /(override fun onNewIntent\(intent: Intent\?\): Boolean \{\s*)if \(!loadAppReady\.isCompleted\)/,
        "$1if (false)",
      ),
  },
  {
    name: 'GOOGLE_MESSAGE_ID_KEY is "google.message_id"',
    pkg: "expo-notifications",
    file: SERVICE,
    matches: (s) =>
      /const val GOOGLE_MESSAGE_ID_KEY = "google\.message_id"/.test(s),
    breakIt: (s) => s.replace('"google.message_id"', '"google.msg_id"'),
  },
  {
    name: 'NOTIFICATION_RESPONSE_KEY is "notificationResponse"',
    pkg: "expo-notifications",
    file: SERVICE,
    matches: (s) =>
      /const val NOTIFICATION_RESPONSE_KEY = "notificationResponse"/.test(s),
    breakIt: (s) =>
      s.replace(
        'NOTIFICATION_RESPONSE_KEY = "notificationResponse"',
        'NOTIFICATION_RESPONSE_KEY = "notifResponse"',
      ),
  },
  {
    name: 'TEXT_INPUT_NOTIFICATION_RESPONSE_KEY is "textInputNotificationResponse"',
    pkg: "expo-notifications",
    file: SERVICE,
    matches: (s) =>
      /const val TEXT_INPUT_NOTIFICATION_RESPONSE_KEY = "textInputNotificationResponse"/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        'TEXT_INPUT_NOTIFICATION_RESPONSE_KEY = "textInputNotificationResponse"',
        'TEXT_INPUT_NOTIFICATION_RESPONSE_KEY = "textInputResponse"',
      ),
  },
  {
    name: "the listener's onCreate reads the activity intent extras and forwards them",
    pkg: "expo-notifications",
    file: LISTENER,
    matches: (s) =>
      /override fun onCreate\(activity: Activity, savedInstanceState: Bundle\?\) \{\s*val extras = activity\.intent\?\.extras \?: return(?:(?!override fun)[\s\S])*?NotificationManager\.onNotificationResponseFromExtras\(extras\)/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        "val extras = activity.intent?.extras ?: return",
        "val extras = activity.savedExtras ?: return",
      ),
  },
  {
    name: "the listener's onCreate skips an intent that already carries a notification response",
    pkg: "expo-notifications",
    file: LISTENER,
    // Scoped to onCreate: onNewIntent repeats the same check further down.
    matches: (s) =>
      /override fun onCreate\(activity: Activity, savedInstanceState: Bundle\?\) \{(?:(?!override fun)[\s\S])*?extras\.containsKey\(NOTIFICATION_RESPONSE_KEY\) \|\| extras\.containsKey\(TEXT_INPUT_NOTIFICATION_RESPONSE_KEY\)/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        "extras.containsKey(NOTIFICATION_RESPONSE_KEY) ||",
        "extras.containsKey(OTHER_KEY) ||",
      ),
  },
  // Single delivery rests on these three: once the relay removes the tap key,
  // the listener must treat the intent as not FCM and forward nothing.
  {
    name: "the listener's isFCMIntent keys on GOOGLE_MESSAGE_ID_KEY alone",
    pkg: "expo-notifications",
    file: LISTENER,
    matches: (s) =>
      /private fun isFCMIntent\(extras: Bundle\): Boolean \{\s*return extras\.containsKey\(GOOGLE_MESSAGE_ID_KEY\)\s*\}/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        "return extras.containsKey(GOOGLE_MESSAGE_ID_KEY)",
        'return extras.containsKey("google.sent_time")',
      ),
  },
  {
    name: "the listener's onCreate forwards nothing for an intent that is not FCM",
    pkg: "expo-notifications",
    file: LISTENER,
    matches: (s) =>
      /override fun onCreate\(activity: Activity, savedInstanceState: Bundle\?\) \{(?:(?!override fun)[\s\S])*?if \(!isFCMIntent\(extras\)\) \{\s*return\s*\}(?:(?!override fun)[\s\S])*?NotificationManager\.onNotificationResponseFromExtras\(extras\)/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        /(override fun onCreate\(activity: Activity, savedInstanceState: Bundle\?\) \{(?:(?!override fun)[\s\S])*?)if \(!isFCMIntent\(extras\)\) \{\s*return\s*\}/,
        "$1",
      ),
  },
  {
    name: "the listener's onNewIntent forwards nothing for an intent that is not FCM",
    pkg: "expo-notifications",
    file: LISTENER,
    matches: (s) =>
      /override fun onNewIntent\(intent: Intent\): Boolean \{(?:(?!override fun)[\s\S])*?if \(!isFCMIntent\(extras\)\) \{\s*return false\s*\}(?:(?!override fun)[\s\S])*?NotificationManager\.onNotificationResponseFromExtras\(extras\)/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        /(override fun onNewIntent\(intent: Intent\): Boolean \{(?:(?!override fun)[\s\S])*?)if \(!isFCMIntent\(extras\)\) \{\s*return false\s*\}/,
        "$1",
      ),
  },
  {
    name: "the tap queue adds a bundle only while the queue is empty",
    pkg: "expo-notifications",
    file: MANAGER,
    matches: (s) =>
      /if \(pendingNotificationResponsesFromExtras\.isEmpty\(\)\) \{\s*pendingNotificationResponsesFromExtras\.add\(extras\)/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        "pendingNotificationResponsesFromExtras.isEmpty()",
        "pendingNotificationResponsesFromExtras.isNotEmpty()",
      ),
  },
  {
    name: "expo-updates returns a delay-load handler outside developer support",
    pkg: "expo-updates",
    file: UPDATES_PACKAGE,
    matches: (s) =>
      /if \(!useDeveloperSupport \|\| isUsingNativeDebug\) \{\s*return ReactActivityHandler\.DelayLoadAppHandler \{/.test(
        s,
      ),
    breakIt: (s) =>
      s.replace(
        "if (!useDeveloperSupport || isUsingNativeDebug)",
        "if (useDeveloperSupport || isUsingNativeDebug)",
      ),
  },
]

describe("the Android push tap relay's upstream premises (R12)", () => {
  it.each(Object.entries(PINNED_VERSIONS))(
    "pins %s to the verified version",
    (name, pinned) => {
      assertVersion(name, installedVersion(name), pinned)
    },
  )

  it("fails with the re-check message when a version moves (negative control)", () => {
    expect(() => assertVersion("expo", "58.0.0", PINNED_VERSIONS.expo)).toThrow(
      /expo\/expo#49254[\s\S]*withAndroidPushTapRelay[\s\S]*#47615/,
    )
  })

  it.each(FACTS.map((fact) => [fact.name, fact]))(
    "holds in the installed source: %s",
    (_name, fact) => {
      assertFact(fact, readInstalled(fact.pkg, fact.file))
    },
  )

  it.each(FACTS.map((fact) => [fact.name, fact]))(
    "fails when the pinned line changes (negative control): %s",
    (_name, fact) => {
      const source = readInstalled(fact.pkg, fact.file)
      const changed = fact.breakIt(source)

      // A rewrite that touched nothing would make the control pass vacuously.
      expect(changed).not.toBe(source)
      expect(() => assertFact(fact, changed)).toThrow(
        /expo\/expo#49254[\s\S]*#47615/,
      )
    },
  )
})
