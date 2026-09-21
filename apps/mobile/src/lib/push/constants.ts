/**
 * Dependency-free constants for push registration. Every later push module
 * imports this leaf, and so does the Profile row, so it holds no logic and no
 * import: the Profile screen must never reach the notifications adapter.
 */

/**
 * KTD12's app-side switch, on one line as a bare literal so a reader and
 * pushKillSwitch.guard both answer "is it on?" from this file. Off skips the
 * first registration and every refresh, and still reports a revocation (R29):
 * a phone whose viewer turned notifications off must leave the audience even
 * while the gate is down.
 */
export const PUSH_REGISTRATION_ENABLED: boolean = true

/** What a permission read said, as the app records it. */
export type PushPermissionState = "granted" | "denied"

/**
 * KTD9's announcements channel. The plugin's `defaultChannel` option creates
 * no channel, so the app creates this one in the same pass that creates the
 * reminders channel, before any permission read.
 */
export const PUSH_ANNOUNCEMENTS_CHANNEL_ID = "announcements"

/** Viewer-visible in the Android notification settings, so it reads plainly. */
export const PUSH_ANNOUNCEMENTS_CHANNEL_NAME = "Announcements"

/** The stored registration record, beside the last-watched one. */
export const PUSH_REGISTRATION_STORAGE_KEY = "push-registration"

/**
 * The record version. A bump voids every stored record, which costs one extra
 * registration per install and loses the remembered revocation report.
 */
export const PUSH_REGISTRATION_RECORD_VERSION = 1

/**
 * R3's coalescing window. A language pick writes three preference fields, a
 * rotation and a viewer re-issue can land in the same second, and a launch
 * runs the mount pass and the first foreground pass back to back. All of them
 * collapse into one registration.
 */
export const PUSH_REGISTRATION_DEBOUNCE_MS = 2_000

/**
 * R3's periodic refresh: an unchanged payload still re-registers once the last
 * success is this old, so admin can tell a live install from an abandoned one.
 * Retention retires a registration at 180 days without a refresh, so this sits
 * far below that.
 */
export const PUSH_REGISTRATION_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000

/**
 * At most this many FAILED attempts in one launch, however many triggers. A
 * success resets the count: the cap is a retry guard, not a change budget.
 */
export const PUSH_REGISTRATION_MAX_ATTEMPTS = 3

/**
 * The mutation budget. Below apolloClient's 15 s fetch ceiling, so this layer
 * settles first and the caller sees a typed TIMEOUT rather than a generic
 * abort — the same rule the recommendation deadlines follow.
 */
export const PUSH_REGISTRATION_DEADLINE_MS = 5_000

/**
 * The token read budget. It is not a bridge call: `getExpoPushTokenAsync`
 * posts to Expo's own service, so it can hang on a bad network.
 */
export const PUSH_TOKEN_READ_DEADLINE_MS = 8_000

/** The viewer handle read budget. A bootstrap is one admin round trip. */
export const PUSH_IDENTITY_READ_DEADLINE_MS = 4_000

/**
 * R23's open report. Tighter than the registration budget because the report
 * runs on the tap-to-navigate path: it is fire-and-forget, so a slower budget
 * would only keep a dead request alive, never delay the viewer.
 */
export const PUSH_OPEN_REPORT_DEADLINE_MS = 3_000

/**
 * R13 needs a language slug on every registration, and admin requires a
 * non-empty one. An install that never picked a dub language sends this, the
 * same fallback `resolveRecommendationContext` uses, so the two clients agree
 * on what "no preference" means.
 */
export const PUSH_DEFAULT_APP_LANGUAGE_SLUG = "english"

/** Sent when the phone reports no readable locale tag. */
export const PUSH_DEFAULT_PHONE_LOCALE = "en"

/** Sent when the phone reports no readable time zone. */
export const PUSH_DEFAULT_TIME_ZONE = "UTC"

/** Admin caps the build label at 64 characters. */
export const PUSH_APP_BUILD_MAX_CHARS = 64

/** Admin caps a BCP-47 tag at 35 characters. */
export const PUSH_PHONE_LOCALE_MAX_CHARS = 35

/** Admin caps the IANA zone name at 64 characters. */
export const PUSH_TIME_ZONE_MAX_CHARS = 64

/** R31's Profile row. One named constant per string, so copy edits sit here. */
export const PUSH_TEST_ID_SECTION_TITLE = "Notifications"
export const PUSH_TEST_ID_ROW_LABEL = "Notification test ID"
export const PUSH_TEST_ID_HELP =
  "Share this ID with the team to receive test announcements on this phone."
export const PUSH_TEST_ID_REGISTERING = "Registering this phone…"
export const PUSH_TEST_ID_NOTIFICATIONS_OFF =
  "Notifications are off for this phone. Turn them on in Settings to receive announcements."
export const PUSH_TEST_ID_COPY_LABEL = "Copy notification test ID"
export const PUSH_TEST_ID_SHARE_LABEL = "Share notification test ID"
export const PUSH_TEST_ID_COPIED = "Copied"
