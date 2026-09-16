import AsyncStorage from "@react-native-async-storage/async-storage"
import { useEffect, useRef } from "react"
import { AppState } from "react-native"
import { router } from "expo-router"
import type { ReactNode } from "react"

import { datadogLog } from "../lib/datadog"
import { registerDeepLinkSlug } from "../lib/deepLinkOrigin"
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
import {
  createLapseReminderTapHandler,
  type LapseReminderTapHandler,
} from "../lib/lapseReminders/tapHandler"
import { attachLastWatchedWriter } from "../lib/lastWatched/lifecycle"
import { getLastWatchedStore } from "../lib/lastWatched/store"
import { getPlaybackRequestStore } from "../lib/miniPlayer/playbackRequest"
import { getSplashSession } from "../lib/splash/splashSession"
import { useExperienceSelection } from "./ExperienceSelectionProvider"

/**
 * Lifecycle host for the lapse reminders (KTD2): it runs the schedule pass on
 * mount, on `active`, on `background`, and on a record clear, it attaches the
 * playback subscriber that keeps the last-watched record current, it hosts the
 * once-per-install permission prompt (KTD6), and it bridges the router and the
 * experience selection into the router-free tap handler (KTD7).
 *
 * Every piece of state lives in a plain-module store or in the closure of one
 * attached handler. The single hook-lifetime ref holds the tap handler, and
 * setup assigns what cleanup clears, so a StrictMode remount arms the new
 * handler instead of leaving the selection effect holding a detached one.
 */
export function LapseReminderProvider({ children }: { children: ReactNode }) {
  const { currentSlug, isReady } = useExperienceSelection()
  const tapHandlerRef = useRef<LapseReminderTapHandler | null>(null)

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
    const tapHandler = createLapseReminderTapHandler({
      adapter: lapseReminderNotifications,
      enabled: LAPSE_REMINDERS_ENABLED,
      navigate: (target) => {
        if (target.screen === "home") router.replace("/(tabs)")
        else router.push(`/watch/${encodeURIComponent(target.slug)}`)
      },
      // By the VALIDATED slug: the url parser strips a `.html` suffix, so a
      // url-keyed arrival for such a slug is never claimed by the route.
      registerArrival: (slug, entry, origin) =>
        registerDeepLinkSlug(slug, entry, origin),
      telemetry: datadogLog,
    })
    tapHandlerRef.current = tapHandler
    const detachTap = tapHandler.attach()
    return () => {
      detachTap()
      tapHandlerRef.current = null
      detachPrompt()
      detachLifecycle()
      detachWriter()
    }
  }, [])

  // KTD7: the experience shell swaps element type when the stored slug
  // resolves, remounting the stack under any route pushed before it, so a cold
  // tap waits here for the selection to settle.
  useEffect(() => {
    tapHandlerRef.current?.selectionChanged({ isReady, slug: currentSlug })
  }, [isReady, currentSlug])

  return children
}
