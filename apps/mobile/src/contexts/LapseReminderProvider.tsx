import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect } from "react"
import { AppState } from "react-native"
import type { ReactNode } from "react"

import { datadogLog } from "../lib/datadog"
import {
  LAPSE_REMINDERS_ENABLED,
  LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY,
} from "../lib/lapseReminders/constants"
import { createLapseReminderLifecycle } from "../lib/lapseReminders/lifecycle"
import { lapseReminderNotifications } from "../lib/lapseReminders/notificationsAdapter"
import {
  LAPSE_REMINDER_PERMISSION_ASKED_VALUE,
  attachLapseReminderPermissionPrompt,
} from "../lib/lapseReminders/permissionPrompt"
import { attachLastWatchedWriter } from "../lib/lastWatched/lifecycle"
import { getLastWatchedStore } from "../lib/lastWatched/store"
import { getPlaybackRequestStore } from "../lib/miniPlayer/playbackRequest"
import { getSplashSession } from "../lib/splash/splashSession"

/**
 * Lifecycle host for the lapse reminders (KTD2): it runs the schedule pass on
 * mount, on `active`, on `background`, and on a record clear, it attaches the
 * playback subscriber that keeps the last-watched record current, and it hosts
 * the once-per-install permission prompt (KTD6).
 *
 * All state lives in plain-module stores, so this component is StrictMode-
 * remount safe by construction: setup subscribes, cleanup only unsubscribes,
 * and no hook-lifetime ref is mutated.
 */
export function LapseReminderProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const record = getLastWatchedStore()
    const playback = getPlaybackRequestStore()
    const detachWriter = attachLastWatchedWriter({
      subscribe: (listener) => playback.subscribe(listener),
      getSnapshot: () => playback.getSnapshot(),
      write: (videoSlug) => record.write(videoSlug),
    })
    const lifecycle = createLapseReminderLifecycle({
      adapter: lapseReminderNotifications,
      enabled: LAPSE_REMINDERS_ENABLED,
      getRecord: () => record.getRecord(),
      hydrateRecord: () => record.hydrate(),
      subscribeToRecordClear: (listener) => record.subscribeToClear(listener),
      subscribeToAppState: (listener) => {
        const subscription = AppState.addEventListener("change", listener)
        return () => subscription.remove()
      },
      now: () => Date.now(),
      telemetry: datadogLog,
    })
    const detachLifecycle = lifecycle.attach()
    const detachPrompt = attachLapseReminderPermissionPrompt({
      adapter: lapseReminderNotifications,
      enabled: LAPSE_REMINDERS_ENABLED,
      splash: getSplashSession(),
      readAsked: () =>
        AsyncStorage.getItem(LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY),
      writeAsked: () =>
        AsyncStorage.setItem(
          LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY,
          LAPSE_REMINDER_PERMISSION_ASKED_VALUE,
        ),
      // A grant arrives after the mount pass has already stood down, so the
      // reminders it could not schedule need this second pass.
      runPass: () => void lifecycle.runPass("mount"),
      telemetry: datadogLog,
    })
    return () => {
      detachPrompt()
      detachLifecycle()
      detachWriter()
    }
  }, [])

  return children
}
