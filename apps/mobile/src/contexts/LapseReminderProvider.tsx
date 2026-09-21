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
import { publishPushAppLanguageSlug } from "../lib/push/appLanguage"
import { getPushRegistration } from "../lib/push/registrationHost"
import { getRecommendationViewerStore } from "../lib/recommendations/viewerIdentityClient"
import { getSplashSession } from "../lib/splash/splashSession"
import { useExperienceSelection } from "./ExperienceSelectionProvider"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * Lifecycle host for the lapse reminders (KTD2): it runs the schedule pass on
 * mount, on `active`, on `background`, and on a record clear, it attaches the
 * playback subscriber that keeps the last-watched record current while the
 * gate is on (KTD8), it hosts the once-per-install permission prompt (KTD6),
 * and it bridges the router and the experience selection into the router-free
 * tap handler (KTD7).
 *
 * It is also the host for push registration (U7): the schedule pass hands the
 * permission it read to the registration controller, so nothing reads the
 * permission twice, and the token-rotation subscription belongs to this
 * provider's lifetime rather than to module scope (KTD9). The controller itself
 * is a module singleton, so "once per launch" survives a StrictMode remount.
 *
 * Every piece of state lives in a plain-module store or in the closure of one
 * attached handler. The single hook-lifetime ref holds the tap handler, and
 * setup assigns what cleanup clears, so a StrictMode remount arms the new
 * handler instead of leaving the selection effect holding a detached one.
 */
export function LapseReminderProvider({ children }: { children: ReactNode }) {
  const { currentSlug, isReady } = useExperienceSelection()
  const preferences = useWatchPreferences()
  const tapHandlerRef = useRef<LapseReminderTapHandler | null>(null)

  useEffect(() => {
    const record = getLastWatchedStore()
    const playback = getPlaybackRequestStore()
    const push = getPushRegistration()
    // KTD9: the announcements channel rides the reminder channel's upsert, so
    // both exist before the permission request and on every later pass.
    const notifications = {
      ...lapseReminderNotifications,
      ensureChannel: async () => {
        await lapseReminderNotifications.ensureChannel()
        await lapseReminderNotifications.ensureAnnouncementsChannel()
      },
    }
    // KTD8 reaches the COLLECTION too: a disabled feature stores no new
    // viewing history. A record written before the flip stays on the device,
    // because only R11's sign-out erases it.
    const detachWriter = LAPSE_REMINDERS_ENABLED
      ? attachLastWatchedWriter({
          subscribe: (listener) => playback.subscribe(listener),
          getSnapshot: () => playback.getSnapshot(),
          write: (videoSlug, videoTitle) => record.write(videoSlug, videoTitle),
        })
      : () => {}
    const lifecycle = createLapseReminderLifecycle({
      adapter: notifications,
      enabled: LAPSE_REMINDERS_ENABLED,
      getRecord: () => record.getRecord(),
      hydrateRecord: () => record.hydrate(),
      subscribeToRecordClear: (listener) => record.subscribeToClear(listener),
      subscribeToAppState: (listener) => {
        const subscription = AppState.addEventListener("change", listener)
        return () => subscription.remove()
      },
      now: () => Date.now(),
      // U7/KTD9: registration acts on the permission this pass already read, so
      // it never performs a second read.
      onPermissionRead: (permission) => push.onPermissionRead(permission),
      telemetry: datadogLog,
    })
    const detachLifecycle = lifecycle.attach()
    // R3: a rotated token is a new registration. Owned by this provider's
    // lifetime, never by module scope.
    const detachTokenRotation = notifications.subscribeToTokenRotation(
      (token) => push.tokenRotated(token),
    )
    // R2: the registration carries the viewer handle, so a re-issued one is a
    // refresh. The store answers `disabled` on its own when that client is off.
    const detachViewerIdentity = getRecommendationViewerStore().subscribe(() =>
      push.viewerIdentityChanged(),
    )
    const detachPrompt = attachLapseReminderPermissionPrompt({
      adapter: notifications,
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
      adapter: notifications,
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
      detachViewerIdentity()
      detachTokenRotation()
      detachLifecycle()
      detachWriter()
    }
  }, [])

  // R3: the app language a registration carries. Published as soon as the
  // preferences hydrate, because the provider persists them without awaiting,
  // so a payload read from storage alone could carry the previous slug.
  useEffect(() => {
    if (!preferences.isReady) return
    publishPushAppLanguageSlug(preferences.audioLanguageSlug)
    getPushRegistration().appLanguageChanged()
  }, [preferences.isReady, preferences.audioLanguageSlug])

  // KTD7: the experience shell swaps element type when the stored slug
  // resolves, remounting the stack under any route pushed before it, so a cold
  // tap waits here for the selection to settle.
  useEffect(() => {
    tapHandlerRef.current?.selectionChanged({ isReady, slug: currentSlug })
  }, [isReady, currentSlug])

  return children
}
