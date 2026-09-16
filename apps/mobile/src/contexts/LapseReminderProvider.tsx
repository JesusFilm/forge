import { useEffect } from "react"
import { AppState } from "react-native"
import type { ReactNode } from "react"

import { datadogLog } from "../lib/datadog"
import { LAPSE_REMINDERS_ENABLED } from "../lib/lapseReminders/constants"
import { createLapseReminderLifecycle } from "../lib/lapseReminders/lifecycle"
import { lapseReminderNotifications } from "../lib/lapseReminders/notificationsAdapter"
import { attachLastWatchedWriter } from "../lib/lastWatched/lifecycle"
import { getLastWatchedStore } from "../lib/lastWatched/store"
import { getPlaybackRequestStore } from "../lib/miniPlayer/playbackRequest"

/**
 * Lifecycle host for the lapse reminders (KTD2): it runs the schedule pass on
 * mount, on `active`, on `background`, and on a record clear, and it attaches
 * the playback subscriber that keeps the last-watched record current.
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
    return () => {
      detachLifecycle()
      detachWriter()
    }
  }, [])

  return children
}
