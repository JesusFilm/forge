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

import {
  LAPSE_REMINDER_CHANNEL_ID,
  LAPSE_REMINDER_CHANNEL_NAME,
} from "./constants"
import type { LapseReminderPayload } from "./payload"

// KTD1: module scope, reached from the root layout's guarded require block, the
// same way the native splash hold is taken. A reminder that fires while the app
// is open must show nothing.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

/** What the pass and the prompt need to know. Narrower than the module's own
 *  status, which carries a platform-specific surface neither one reads. */
export type LapseReminderPermission = {
  granted: boolean
  canAskAgain: boolean
}

export type LapseReminderScheduleInput = {
  identifier: string
  body: string
  data: LapseReminderPayload
  date: Date
}

export type LapseReminderNotificationsAdapter = {
  ensureChannel: () => Promise<void>
  getPermission: () => Promise<LapseReminderPermission>
  requestPermission: () => Promise<LapseReminderPermission>
  schedule: (input: LapseReminderScheduleInput) => Promise<void>
  cancel: (identifier: string) => Promise<void>
  dismissDelivered: () => Promise<void>
  getPendingIdentifiers: () => Promise<string[]>
  getLastResponseData: () => unknown
  clearLastResponse: () => void
  subscribeToResponses: (listener: (data: unknown) => void) => () => void
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

  async dismissDelivered() {
    await Notifications.dismissAllNotificationsAsync()
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
