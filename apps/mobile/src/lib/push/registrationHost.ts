/**
 * The real wiring for the registration controller, as a module singleton — the
 * pattern `viewerIdentityClient.ts` uses for the viewer store.
 *
 * The singleton is what makes "once per launch" (R1) hold across a React
 * StrictMode remount: the provider's effect runs setup, cleanup and setup again
 * on the same mount, and a controller built inside that effect would arrive
 * fresh each time with its launch latch open. The controller outlives the
 * effect; only the token-rotation subscription belongs to the provider's
 * lifetime (KTD9).
 */

import { datadogLog } from "../datadog"
import { lapseReminderNotifications } from "../lapseReminders/notificationsAdapter"
import { withTimeout } from "../withTimeout"
import { getRecommendationViewerStore } from "../recommendations/viewerIdentityClient"
import { readPushAppLanguageSlug } from "./appLanguage"
import {
  PUSH_IDENTITY_READ_DEADLINE_MS,
  PUSH_REGISTRATION_ENABLED,
  PUSH_TOKEN_READ_DEADLINE_MS,
} from "./constants"
import { readPushDeviceEnvironment } from "./deviceEnvironment"
import type { PushViewerHandle } from "./payload"
import { createPushRegistration, type PushRegistration } from "./registration"
import { registerPushDevice } from "./registrationClient"
import { getPushRegistrationStore } from "./store"

/**
 * The recommendation viewer handle when that client is on and has one. The
 * store answers `disabled` on its own when the client is off, and every other
 * kind means "no handle to send", which is a registration without one (R2).
 */
async function readPushViewerHandle(): Promise<PushViewerHandle | null> {
  try {
    const result = await withTimeout(
      getRecommendationViewerStore().get(),
      PUSH_IDENTITY_READ_DEADLINE_MS,
    )
    if (result.kind !== "ready") return null
    return {
      viewerToken: result.identity.viewerToken,
      sessionToken: result.identity.sessionToken,
    }
  } catch {
    // A registration without a handle still reaches the audience; it only
    // cannot be attributed until a later refresh carries one.
    return null
  }
}

let registration: PushRegistration | null = null

export function getPushRegistration(): PushRegistration {
  if (registration == null) {
    registration = createPushRegistration({
      enabled: PUSH_REGISTRATION_ENABLED,
      store: getPushRegistrationStore(),
      readToken: () =>
        withTimeout(
          lapseReminderNotifications.getPushToken(),
          PUSH_TOKEN_READ_DEADLINE_MS,
        ),
      readAppLanguageSlug: readPushAppLanguageSlug,
      readIdentity: readPushViewerHandle,
      readEnvironment: readPushDeviceEnvironment,
      register: registerPushDevice,
      schedule: (run, ms) => {
        const timer = setTimeout(run, ms)
        return () => clearTimeout(timer)
      },
      now: () => Date.now(),
      // The sink name is load-bearing: the repo-wide reserved-attribute sweep
      // reads only sinks spelled datadogLog, DdLogs or telemetry.
      telemetry: datadogLog,
    })
  }
  return registration
}

/** Test seam: drop the singleton so the next getter builds a fresh controller. */
export function resetPushRegistrationForTests(): void {
  registration = null
}
