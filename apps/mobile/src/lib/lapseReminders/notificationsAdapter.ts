/**
 * KTD1's one adapter. This is the ONLY file in the app that imports
 * `expo-notifications`, so the whole feature's mocked-versus-real seam is a
 * single file that the entry-point guard and the device pass both cover.
 *
 * Every reminder uses an absolute-date trigger. The module falls back to
 * inexact alarms on Android by itself, which R6 tolerates, so the app never
 * declares `SCHEDULE_EXACT_ALARM` or `USE_EXACT_ALARM`.
 */

import * as Notifications from "expo-notifications"
import Constants from "expo-constants"

import {
  PUSH_ANNOUNCEMENTS_CHANNEL_ID,
  PUSH_ANNOUNCEMENTS_CHANNEL_NAME,
} from "../push/constants"
import { presentationForTrigger } from "../push/foreground"
import {
  LAPSE_REMINDER_CHANNEL_ID,
  LAPSE_REMINDER_CHANNEL_NAME,
  type LapseReminderPermission,
} from "./constants"
import type { LapseReminderPayload } from "./payload"

// KTD1: module scope, reached from the root layout's guarded require block, the
// same way the native splash hold is taken. The branch itself is pure and lives
// in `../push/foreground`: a remote announcement shows, a reminder does not.
Notifications.setNotificationHandler({
  handleNotification: async (notification) =>
    presentationForTrigger(notification.request.trigger),
})

export type LapseReminderScheduleInput = {
  identifier: string
  body: string
  data: LapseReminderPayload
  date: Date
}

/**
 * KTD9's fourth port: everything push registration needs of the notifications
 * module, so the whole feature still has ONE importer of it. The registration
 * module consumes only this.
 */
export type PushNotificationsPort = {
  ensureAnnouncementsChannel: () => Promise<void>
  /** Null when the project id is missing; throws when the read itself fails. */
  getPushToken: () => Promise<string | null>
  subscribeToTokenRotation: (listener: (token: string) => void) => () => void
}

export type LapseReminderNotificationsAdapter = PushNotificationsPort & {
  ensureChannel: () => Promise<void>
  getPermission: () => Promise<LapseReminderPermission>
  requestPermission: () => Promise<LapseReminderPermission>
  schedule: (input: LapseReminderScheduleInput) => Promise<void>
  cancel: (identifier: string) => Promise<void>
  dismiss: (identifier: string) => Promise<void>
  getPendingIdentifiers: () => Promise<string[]>
  getLastResponseData: () => unknown
  clearLastResponse: () => void
  subscribeToResponses: (listener: (data: unknown) => void) => () => void
}

/** The EAS project id the Expo token read needs (KTD9). */
function easProjectId(): string | null {
  const configured = Constants.expoConfig?.extra?.eas?.projectId
  return typeof configured === "string" && configured.length > 0
    ? configured
    : null
}

/**
 * One Expo token read for both callers. A rotation event carries the NATIVE
 * token, which Expo exchanges for the Expo token this app sends to admin, so
 * passing it saves a second native read and uses the value that just changed.
 */
async function readExpoPushToken(
  devicePushToken?: Notifications.DevicePushToken,
): Promise<string | null> {
  const projectId = easProjectId()
  if (projectId == null) return null
  const token = await Notifications.getExpoPushTokenAsync({
    projectId,
    ...(devicePushToken == null ? {} : { devicePushToken }),
  })
  return token.data.length > 0 ? token.data : null
}

function toPermission(status: {
  granted: boolean
  canAskAgain: boolean
}): LapseReminderPermission {
  return { granted: status.granted, canAskAgain: status.canAskAgain }
}

export const lapseReminderNotifications: LapseReminderNotificationsAdapter = {
  /** KTD6: Android 13 shows no permission prompt until a channel exists. The
   *  plugin's `defaultChannel` option creates none, so the app creates this. */
  async ensureChannel() {
    await Notifications.setNotificationChannelAsync(LAPSE_REMINDER_CHANNEL_ID, {
      name: LAPSE_REMINDER_CHANNEL_NAME,
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  },

  /** KTD9: the announcements channel, created in the same pass as the reminder
   *  one. Android shows a remote notification with no channel in a default
   *  bucket the viewer cannot name. */
  async ensureAnnouncementsChannel() {
    await Notifications.setNotificationChannelAsync(
      PUSH_ANNOUNCEMENTS_CHANNEL_ID,
      {
        name: PUSH_ANNOUNCEMENTS_CHANNEL_NAME,
        importance: Notifications.AndroidImportance.DEFAULT,
      },
    )
  },

  /** R1's token. It posts to Expo's own service, so the caller bounds it. */
  async getPushToken() {
    return readExpoPushToken()
  },

  /** R3: a rotated token is a new registration. The subscription belongs to the
   *  provider's lifetime, never to module scope. */
  subscribeToTokenRotation(listener) {
    const subscription = Notifications.addPushTokenListener(
      (devicePushToken) => {
        void readExpoPushToken(devicePushToken)
          .then((token) => {
            if (token != null) listener(token)
          })
          .catch(() => {
            // A failed exchange loses this rotation signal only: the next
            // launch reads the new token on its own pass.
          })
      },
    )
    return () => subscription.remove()
  },

  async getPermission() {
    return toPermission(await Notifications.getPermissionsAsync())
  },

  async requestPermission() {
    return toPermission(await Notifications.requestPermissionsAsync())
  },

  /** Scheduling under an identifier that is already pending REPLACES it, which
   *  is how R5's two-at-most bound holds without a cancel-then-schedule gap. */
  async schedule(input) {
    await Notifications.scheduleNotificationAsync({
      identifier: input.identifier,
      content: { body: input.body, data: input.data },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: input.date,
        channelId: LAPSE_REMINDER_CHANNEL_ID,
      },
    })
  },

  async cancel(identifier) {
    await Notifications.cancelScheduledNotificationAsync(identifier)
  },

  /** KTD13: by identifier, never the whole tray. An announcement the viewer
   *  has not opened yet must survive a reminder pass (AE21). */
  async dismiss(identifier) {
    await Notifications.dismissNotificationAsync(identifier)
  },

  /** Development only: U7 reads this to prove same-identifier replacement on a
   *  device. A release bundle never asks the module for the pending set. */
  async getPendingIdentifiers() {
    if (!__DEV__) return []
    const pending = await Notifications.getAllScheduledNotificationsAsync()
    return pending.map((request) => request.identifier)
  },

  /** The SYNCHRONOUS read, not the deprecated `*Async` spelling. On a cold
   *  start the OS-side manager replays the tap into this rather than into the
   *  listener, so the cold and warm paths never both fire for one tap. */
  getLastResponseData() {
    return (
      Notifications.getLastNotificationResponse()?.notification.request.content
        .data ?? null
    )
  },

  clearLastResponse() {
    Notifications.clearLastNotificationResponse()
  },

  subscribeToResponses(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => listener(response.notification.request.content.data),
    )
    return () => subscription.remove()
  },
}
