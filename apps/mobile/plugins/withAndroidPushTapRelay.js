// A direct require on purpose: other mobile plugins skip when this does not
// load, but a skip here ships an Android build that loses cold taps (R10).
const { CodeGenerator, withMainActivity } = require("expo/config-plugins")

// When Android restarts a stopped app's task, a tap arrives only as a new
// intent, and Expo's activity wrapper drops it while the app loads
// (expo/expo#49254). Plan: docs/plans/2026-10-12-1532-fix-android-cold-push-tap-plan.md.

const NAME = "[withAndroidPushTapRelay]"
const KEYS = "expo.modules.notifications.service.NotificationsService"
const RESTORE_TAG = "forge-push-tap-relay-restore"
const NEW_INTENT_TAG = "forge-push-tap-relay-new-intent"

// expo-splash-screen and react-native-google-cast insert at the FIRST line
// that holds the onCreate super call, so no line below may hold that text.
const ON_CREATE_SUPER = /^\s*super\.onCreate\(/
const CLASS_LINE = /^class MainActivity\b.*\{\s*$/
const ON_NEW_INTENT = /\bfun\s+onNewIntent\s*\(/

// Block A: a restore gives back the task's old launch intent. Remove its old
// tap key before Expo's onCreate listener queues it ahead of a newer tap.
const RESTORE_BLOCK = [
  "    if (savedInstanceState != null ||",
  "      ((intent?.flags ?: 0) and android.content.Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {",
  `      val tapKey = ${KEYS}.GOOGLE_MESSAGE_ID_KEY`,
  '      val clause = if (savedInstanceState != null) "saved-state" else "history-flag"',
  "      val tapKeyPresent = intent?.hasExtra(tapKey) == true",
  "      intent?.removeExtra(tapKey)",
  '      android.util.Log.i("ForgePushTap", "restore clause=$clause tapKeyPresent=$tapKeyPresent")',
  "    }",
].join("\n")

// Block B: remove the tap key after the hand-off, so Expo's own listener
// ignores the tap. No setIntent: a recreation would replay the tap.
const NEW_INTENT_BLOCK = [
  "  override fun onNewIntent(intent: android.content.Intent) {",
  "    val extras = intent.extras",
  "    if (extras != null &&",
  `      extras.containsKey(${KEYS}.GOOGLE_MESSAGE_ID_KEY) &&`,
  `      !extras.containsKey(${KEYS}.NOTIFICATION_RESPONSE_KEY) &&`,
  `      !extras.containsKey(${KEYS}.TEXT_INPUT_NOTIFICATION_RESPONSE_KEY)) {`,
  "      expo.modules.notifications.notifications.NotificationManager.onNotificationResponseFromExtras(extras)",
  `      intent.removeExtra(${KEYS}.GOOGLE_MESSAGE_ID_KEY)`,
  '      android.util.Log.i("ForgePushTap", "new intent: tap handed to expo-notifications")',
  "    }",
  "    super.onNewIntent(intent)",
  "  }",
].join("\n")

function hasLine(contents, pattern) {
  return contents.split("\n").some((line) => pattern.test(line))
}

/** Adds Block A and Block B. Throws on any MainActivity it cannot change safely. */
function applyPushTapRelay(contents) {
  const withoutOwnBlocks = [RESTORE_TAG, NEW_INTENT_TAG].reduce(
    (src, tag) => CodeGenerator.removeContents({ src, tag }).contents,
    contents,
  )
  if (ON_NEW_INTENT.test(withoutOwnBlocks)) {
    throw new Error(
      `${NAME} MainActivity already overrides onNewIntent, and a second ` +
        "override does not compile. Merge the tap relay into that override.",
    )
  }
  if (!hasLine(contents, CLASS_LINE)) {
    throw new Error(
      `${NAME} MainActivity has no "class MainActivity ... {" line. The Expo ` +
        "template changed; port the tap relay before building.",
    )
  }
  if (!hasLine(contents, ON_CREATE_SUPER)) {
    throw new Error(
      `${NAME} MainActivity has no onCreate superclass call. The Expo ` +
        "template changed; port the tap relay before building.",
    )
  }
  const restored = CodeGenerator.mergeContents({
    src: contents,
    newSrc: RESTORE_BLOCK,
    tag: RESTORE_TAG,
    anchor: ON_CREATE_SUPER,
    offset: 0,
    comment: "    //",
  }).contents
  return CodeGenerator.mergeContents({
    src: restored,
    newSrc: NEW_INTENT_BLOCK,
    tag: NEW_INTENT_TAG,
    anchor: CLASS_LINE,
    offset: 1,
    comment: "  //",
  }).contents
}

module.exports = function withAndroidPushTapRelay(config) {
  return withMainActivity(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error(
        `${NAME} expected a Kotlin MainActivity, got ` +
          `"${cfg.modResults.language}". Port the tap relay before building.`,
      )
    }
    cfg.modResults.contents = applyPushTapRelay(cfg.modResults.contents)
    return cfg
  })
}

// Exported for unit tests.
module.exports.applyPushTapRelay = applyPushTapRelay
