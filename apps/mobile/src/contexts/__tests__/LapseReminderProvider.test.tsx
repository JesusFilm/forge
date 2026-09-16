/**
 * The provider's wiring, driven through the REAL lifecycle and the REAL
 * permission prompt: only the native adapter, the two stores, the splash
 * session, device storage and the log sink are doubled, so these tests fail
 * when the provider stops passing a dependency either one depends on.
 *
 * The record store is doubled, so the only reader of storage here is the
 * prompt's asked-once latch, over the vendor's own AsyncStorage mock.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
// The gate is a build-time constant read through a live binding, so a test
// flips it on the mocked module. `jest.isolateModules` would hand the provider
// a second React.
jest.mock("../../lib/lapseReminders/constants", () => ({
  ...jest.requireActual("../../lib/lapseReminders/constants"),
}))
jest.mock("../../lib/lapseReminders/notificationsAdapter", () => {
  // A named parameter inside a function TYPE trips babel-plugin-jest-hoist's
  // out-of-scope check, so this factory keeps no listener registry: the test
  // fires the listener the provider handed to the mock.
  const unsubscribeResponses = jest.fn()
  return {
    lapseReminderNotifications: {
      ensureChannel: jest.fn(async () => {}),
      getPermission: jest.fn(async () => ({
        granted: true,
        canAskAgain: false,
      })),
      requestPermission: jest.fn(async () => ({
        granted: true,
        canAskAgain: false,
      })),
      schedule: jest.fn(async () => {}),
      cancel: jest.fn(async () => {}),
      dismissDelivered: jest.fn(async () => {}),
      getLastResponseData: jest.fn(() => null),
      clearLastResponse: jest.fn(),
      subscribeToResponses: jest.fn(() => unsubscribeResponses),
    },
    __unsubscribeResponses: unsubscribeResponses,
  }
})
// The imperative router: the provider navigates from a timer and from a native
// listener, neither of which is inside a render.
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn() },
}))
jest.mock("../../lib/splash/splashSession", () => {
  const CLEARED = { resolved: true, visible: false, presentation: null }
  const listeners = new Set<() => void>()
  let snapshot: Record<string, unknown> = CLEARED
  const session = {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,
  }
  return {
    getSplashSession: () => session,
    __setSplash: (next: Record<string, unknown>) => {
      snapshot = { ...CLEARED, ...next }
      for (const listener of [...listeners]) listener()
    },
    __resetSplash: () => {
      snapshot = CLEARED
    },
  }
})
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock("../../lib/lastWatched/store", () => {
  const clearListeners = new Set<() => void>()
  const store = {
    getRecord: jest.fn(() => ({
      videoSlug: "the-birth-of-jesus",
      recordedAt: 0,
    })),
    hydrate: jest.fn(async () => {}),
    write: jest.fn(),
    subscribeToClear: jest.fn((listener: () => void) => {
      clearListeners.add(listener)
      return () => clearListeners.delete(listener)
    }),
  }
  return {
    getLastWatchedStore: () => store,
    __emitClear: () => {
      for (const listener of [...clearListeners]) listener()
    },
    __clearListenerCount: () => clearListeners.size,
  }
})
jest.mock("../../lib/miniPlayer/playbackRequest", () => {
  let snapshot: {
    request: { session: { videoSlug: string } } | null
    playing: boolean
  } = { request: null, playing: false }
  const listeners = new Set<() => void>()
  // One store object, not a fresh one per call: the test reads the same
  // `subscribe` mock the provider was handed.
  const store = {
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    getSnapshot: () => snapshot,
  }
  return {
    getPlaybackRequestStore: () => store,
    // The writer only acts on a notification, so a store that never emits
    // cannot tell a wired provider from `write: () => {}`.
    __emitPlaying: (videoSlug: string) => {
      snapshot = { request: { session: { videoSlug } }, playing: true }
      for (const listener of [...listeners]) listener()
    },
    __resetPlayback: () => {
      snapshot = { request: null, playing: false }
      listeners.clear()
    },
  }
})

import { StrictMode, act } from "react"
import { AppState, type AppStateStatus } from "react-native"

import AsyncStorage from "@react-native-async-storage/async-storage"

import { router } from "expo-router"

import { LapseReminderProvider } from "../LapseReminderProvider"
import { ExperienceSelectionProvider } from "../ExperienceSelectionProvider"
import {
  consumeDeepLinkArrival,
  resetDeepLinkOrigins,
} from "../../lib/deepLinkOrigin"
import { buildLapseReminderPayload } from "../../lib/lapseReminders/payload"
import {
  LAPSE_REMINDER_IDENTIFIERS,
  LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY,
} from "../../lib/lapseReminders/constants"
import { LAPSE_REMINDER_PERMISSION_ASKED_VALUE } from "../../lib/lapseReminders/permissionPrompt"
import { lapseReminderNotifications } from "../../lib/lapseReminders/notificationsAdapter"
import { datadogLog } from "../../lib/datadog"
import { getLastWatchedStore } from "../../lib/lastWatched/store"
import {
  TestRenderer,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const recordStoreModule = (require as unknown as NodeRequireLike)(
  "../../lib/lastWatched/store",
) as {
  __emitClear: () => void
  __clearListenerCount: () => number
  getLastWatchedStore: () => { write: jest.Mock; getRecord: jest.Mock }
}

const splashModule = (require as unknown as NodeRequireLike)(
  "../../lib/splash/splashSession",
) as {
  __setSplash: (next: Record<string, unknown>) => void
  __resetSplash: () => void
}

const lapseConstants = jest.requireMock(
  "../../lib/lapseReminders/constants",
) as { LAPSE_REMINDERS_ENABLED: boolean }

const adapter = lapseReminderNotifications as unknown as {
  ensureChannel: jest.Mock
  getPermission: jest.Mock
  requestPermission: jest.Mock
  schedule: jest.Mock
  cancel: jest.Mock
  dismissDelivered: jest.Mock
  getLastResponseData: jest.Mock
  clearLastResponse: jest.Mock
  subscribeToResponses: jest.Mock
}

const notificationsModule = (require as unknown as NodeRequireLike)(
  "../../lib/lapseReminders/notificationsAdapter",
) as {
  __unsubscribeResponses: jest.Mock
}

/** Fires a warm tap through every listener the provider has subscribed. A
 *  detached one is still in the list, which is how a stale listener stays
 *  testable. */
function emitResponse(data: unknown) {
  for (const call of adapter.subscribeToResponses.mock.calls) {
    const listener = call[0] as (value: unknown) => void
    listener(data)
  }
}

const fakeRouter = router as unknown as { push: jest.Mock; replace: jest.Mock }

/** The stored experience slug. The shell reads it, and the cold tap waits for
 *  it: the shell swaps element type when it resolves, remounting the stack. */
const EXPERIENCE_SLUG_STORAGE_KEY = "selectedExperienceSlug"

const appStateListeners = new Set<(state: AppStateStatus) => void>()

async function render(strict = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    const tree = (
      <ExperienceSelectionProvider>
        <LapseReminderProvider>{null}</LapseReminderProvider>
      </ExperienceSelectionProvider>
    )
    renderer = TestRenderer.create(
      strict ? <StrictMode>{tree}</StrictMode> : tree,
    )
  })
  // Let the mount pass settle before any assertion.
  await act(async () => {})
  return renderer
}

async function emitAppState(state: AppStateStatus) {
  await act(async () => {
    for (const listener of [...appStateListeners]) listener(state)
  })
}

function scheduledIdentifiers(): string[] {
  return adapter.schedule.mock.calls.map((call) => call[0].identifier)
}

/** Several act rounds: the prompt chain is longer than the mount pass. */
async function flush() {
  for (let round = 0; round < 4; round += 1) await act(async () => {})
}

beforeEach(async () => {
  jest.clearAllMocks()
  // The ON value, not the file's: flipping the real switch is an OTA-speed
  // emergency lever, and it must not turn this suite red.
  lapseConstants.LAPSE_REMINDERS_ENABLED = true
  appStateListeners.clear()
  splashModule.__resetSplash()
  resetDeepLinkOrigins()
  // clearAllMocks leaves a queued return value in place, so reset the tap port
  // explicitly: a leaked response would navigate in an unrelated test.
  adapter.getLastResponseData.mockReturnValue(null)
  // The DEFAULT fixture is a later launch: the latch is already closed, so the
  // prompt reads it and stops. The first-launch cases below clear it.
  await AsyncStorage.clear()
  await AsyncStorage.setItem(
    LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY,
    LAPSE_REMINDER_PERMISSION_ASKED_VALUE,
  )
  // A settled selection is the ordinary case; the deadline test clears it.
  await AsyncStorage.setItem(EXPERIENCE_SLUG_STORAGE_KEY, "watch-home")
  adapter.getPermission.mockResolvedValue({ granted: true, canAskAgain: false })
  adapter.requestPermission.mockResolvedValue({
    granted: true,
    canAskAgain: false,
  })
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_type, listener) => {
      appStateListeners.add(listener)
      const remove = () => {
        appStateListeners.delete(listener)
      }
      return { remove } as never
    })
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("LapseReminderProvider wiring", () => {
  it("runs a real pass on mount, through the injected adapter", async () => {
    const renderer = await render()

    expect(adapter.getPermission).toHaveBeenCalledTimes(1)
    expect(scheduledIdentifiers()).toEqual([
      LAPSE_REMINDER_IDENTIFIERS.day1,
      LAPSE_REMINDER_IDENTIFIERS.day7,
    ])
    // The record store is wired, so the payload names the video, not Home.
    expect(adapter.schedule.mock.calls[0][0].data.target).toBe(
      "forgemobile://watch/the-birth-of-jesus",
    )
    await act(async () => renderer.unmount())
  })

  it("passes on foreground and on background, never on inactive", async () => {
    const renderer = await render()
    adapter.schedule.mockClear()

    await emitAppState("active")
    await emitAppState("inactive")
    await emitAppState("background")

    expect(adapter.schedule).toHaveBeenCalledTimes(4)
    await act(async () => renderer.unmount())
  })

  it("re-derives the reminders when the record is cleared (R18)", async () => {
    const store = getLastWatchedStore()
    const realGetRecord = store.getRecord
    const renderer = await render()
    adapter.schedule.mockClear()
    store.getRecord = jest.fn(() => null)

    await act(async () => {
      recordStoreModule.__emitClear()
    })
    await act(async () => {})

    expect(adapter.dismissDelivered).toHaveBeenCalled()
    expect(adapter.schedule.mock.calls[0][0].data.target).toBe("home")
    store.getRecord = realGetRecord
    await act(async () => renderer.unmount())
  })

  it("logs the pass through the Datadog info sink (KTD9)", async () => {
    const renderer = await render()

    expect(datadogLog.info).toHaveBeenCalledWith("lapse_reminder.pass", {
      pass_reason: "mount",
      outcome: "scheduled",
    })
    await act(async () => renderer.unmount())
  })

  it("attaches the last-watched writer to the playback store (U3)", async () => {
    const playback = (require as unknown as NodeRequireLike)(
      "../../lib/miniPlayer/playbackRequest",
    ) as {
      getPlaybackRequestStore: () => { subscribe: jest.Mock }
    }
    const renderer = await render()

    expect(playback.getPlaybackRequestStore().subscribe).toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("writes a playing session through to the record store", async () => {
    // Subscribing is not wiring. Without this, `write: () => {}` in the
    // provider leaves every mobile test green and the record never fills.
    const playback = (require as unknown as NodeRequireLike)(
      "../../lib/miniPlayer/playbackRequest",
    ) as { __emitPlaying: (slug: string) => void }
    const store = recordStoreModule.getLastWatchedStore()
    const renderer = await render()
    ;(store.write as jest.Mock).mockClear()

    await act(async () => {
      playback.__emitPlaying("considering-christmas")
    })

    expect(store.write).toHaveBeenCalledWith("considering-christmas")
    await act(async () => renderer.unmount())
  })

  it("stops writing once the provider unmounts", async () => {
    const playback = (require as unknown as NodeRequireLike)(
      "../../lib/miniPlayer/playbackRequest",
    ) as { __emitPlaying: (slug: string) => void }
    const store = recordStoreModule.getLastWatchedStore()
    const renderer = await render()

    await act(async () => renderer.unmount())
    ;(store.write as jest.Mock).mockClear()
    await act(async () => {
      playback.__emitPlaying("rivka")
    })

    expect(store.write).not.toHaveBeenCalled()
  })

  it("unsubscribes everything on unmount and passes no more", async () => {
    const renderer = await render()

    await act(async () => renderer.unmount())
    adapter.schedule.mockClear()
    await emitAppState("active")

    expect(appStateListeners.size).toBe(0)
    expect(recordStoreModule.__clearListenerCount()).toBe(0)
    expect(adapter.schedule).not.toHaveBeenCalled()
  })

  it("still passes on the next foreground after a StrictMode remount", async () => {
    // RTL's `wrapper` option would NOT double the effect cycle; wrapping the
    // rendered element is what makes setup → cleanup → setup run for real.
    const renderer = await render(true)
    // Anti-vacuous: two mount passes is the proof the effect cycle really ran
    // setup → cleanup → setup. One would make everything below say nothing.
    expect(adapter.getPermission).toHaveBeenCalledTimes(2)
    adapter.schedule.mockClear()

    await emitAppState("active")

    expect(appStateListeners.size).toBe(1)
    expect(scheduledIdentifiers()).toEqual([
      LAPSE_REMINDER_IDENTIFIERS.day1,
      LAPSE_REMINDER_IDENTIFIERS.day7,
    ])
    await act(async () => renderer.unmount())
  })

  it("renders its children", async () => {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <ExperienceSelectionProvider>
          <LapseReminderProvider>
            <>{null}</>
          </LapseReminderProvider>
        </ExperienceSelectionProvider>,
      )
    })
    await act(async () => {})

    expect(renderer.toJSON()).toBeNull()
    await act(async () => renderer.unmount())
  })
})

describe("the first-launch permission prompt (U5)", () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY)
    adapter.getPermission.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    })
    // The real thing flips the status it reads, so the pass after the grant
    // sees a granted device rather than the pre-prompt answer.
    adapter.requestPermission.mockImplementation(async () => {
      adapter.getPermission.mockResolvedValue({
        granted: true,
        canAskAgain: false,
      })
      return { granted: true, canAskAgain: false }
    })
  })

  it("asks once, closes the latch, and schedules on the grant (R8, R16)", async () => {
    const renderer = await render()
    await flush()

    expect(adapter.requestPermission).toHaveBeenCalledTimes(1)
    expect(
      await AsyncStorage.getItem(LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY),
    ).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    expect(datadogLog.info).toHaveBeenCalledWith("lapse_reminder.permission", {
      prompt_outcome: "granted",
      prompted: true,
    })
    // The grant runs a pass through the REAL lifecycle, so the two reminders
    // the mount pass could not schedule are pending after it.
    expect(scheduledIdentifiers()).toEqual([
      LAPSE_REMINDER_IDENTIFIERS.day1,
      LAPSE_REMINDER_IDENTIFIERS.day7,
    ])
    await act(async () => renderer.unmount())
  })

  it("creates the Android channel before it asks (KTD6)", async () => {
    // The ORDER is the contract, not the count: the schedule pass ensures the
    // channel too, so a single-call assertion would only pin which module
    // happened to reach it first.
    const renderer = await render()
    await flush()

    expect(adapter.ensureChannel).toHaveBeenCalled()
    expect(adapter.ensureChannel.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.requestPermission.mock.invocationCallOrder[0],
    )
    await act(async () => renderer.unmount())
  })

  it("records a decline and schedules nothing (AE4)", async () => {
    adapter.requestPermission.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    })
    const renderer = await render()
    await flush()

    expect(datadogLog.info).toHaveBeenCalledWith("lapse_reminder.permission", {
      prompt_outcome: "denied",
      prompted: true,
    })
    expect(adapter.schedule).not.toHaveBeenCalled()
    expect(
      await AsyncStorage.getItem(LAPSE_REMINDER_PERMISSION_ASKED_STORAGE_KEY),
    ).toBe(LAPSE_REMINDER_PERMISSION_ASKED_VALUE)
    await act(async () => renderer.unmount())
  })

  it("asks exactly once across a StrictMode remount", async () => {
    const renderer = await render(true)
    await flush()

    // Anti-vacuous: one stand-down per mount pass is the proof the effect
    // cycle really ran setup → cleanup → setup. One would say nothing.
    const standDowns = (datadogLog.info as jest.Mock).mock.calls.filter(
      ([event, context]) =>
        event === "lapse_reminder.pass" && context.outcome === "not_granted",
    )
    expect(standDowns).toHaveLength(2)
    // The ASK is the one-shot. The channel upsert is idempotent and now runs
    // on every pass too, so counting it here would pin an unrelated fact.
    expect(adapter.requestPermission).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })

  it("waits for the splash session to clear, then asks (KTD6)", async () => {
    splashModule.__setSplash({ visible: true })
    const renderer = await render()
    await flush()

    // Inert in production while the animated splash is off, so this fixture is
    // the only place the wait is reachable. Anti-vacuous: nothing asked yet.
    expect(adapter.requestPermission).not.toHaveBeenCalled()

    await act(async () => {
      splashModule.__setSplash({ visible: false })
    })
    await flush()

    expect(adapter.requestPermission).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })

  it("asks nothing when the provider unmounts before the splash clears", async () => {
    splashModule.__setSplash({ visible: true })
    const renderer = await render()

    await act(async () => renderer.unmount())
    await act(async () => {
      splashModule.__setSplash({ visible: false })
    })
    await flush()

    expect(adapter.requestPermission).not.toHaveBeenCalled()
  })
})

describe("the spent permission latch", () => {
  it("asks nothing on a later launch, even while permission is denied", async () => {
    adapter.getPermission.mockResolvedValue({
      granted: false,
      canAskAgain: true,
    })
    const renderer = await render()
    await flush()

    expect(adapter.requestPermission).not.toHaveBeenCalled()
    expect(adapter.ensureChannel).not.toHaveBeenCalled()
    expect(datadogLog.info).not.toHaveBeenCalledWith(
      "lapse_reminder.permission",
      expect.anything(),
    )
    await act(async () => renderer.unmount())
  })
})

describe("the reminder tap (U6)", () => {
  const SLUG = "the-birth-of-jesus"
  const WATCH_PATH = `/watch/${SLUG}`

  function coldTap(kind: "day1" | "day7", slug: string | null) {
    adapter.getLastResponseData.mockReturnValue(
      buildLapseReminderPayload(kind, slug == null ? null : { slug }),
    )
  }

  it("opens the recorded video and leaves a reminder arrival (AE8, R12)", async () => {
    coldTap("day7", SLUG)
    const renderer = await render()

    expect(fakeRouter.push).toHaveBeenCalledTimes(1)
    expect(fakeRouter.push).toHaveBeenCalledWith(WATCH_PATH)
    // Through the REAL registry, keyed the way the watch route consumes it.
    expect(consumeDeepLinkArrival(SLUG)).toEqual({
      entry: "cold",
      origin: "reminder",
    })
    expect(adapter.clearLastResponse).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })

  it("logs the tap through the Datadog info sink (R15, KTD9)", async () => {
    coldTap("day7", SLUG)
    const renderer = await render()

    expect(datadogLog.info).toHaveBeenCalledWith("lapse_reminder.tap", {
      outcome: "watch",
      arrival: "cold",
      reminder_kind: "day7",
      content_id: SLUG,
      parse_reason: null,
    })
    await act(async () => renderer.unmount())
  })

  it("opens the Home tab when there is nothing to resume (AE6, R13)", async () => {
    coldTap("day1", null)
    const renderer = await render()

    expect(fakeRouter.replace).toHaveBeenCalledWith("/(tabs)")
    expect(fakeRouter.push).not.toHaveBeenCalled()
    expect(consumeDeepLinkArrival(SLUG)).toBeNull()
    await act(async () => renderer.unmount())
  })

  // KTD7: the experience shell swaps element type when the stored slug
  // resolves, which remounts the stack under a route pushed before it. The
  // handler's own suite pins the deadline that ends this wait.
  it("waits while the experience selection has no slug", async () => {
    await AsyncStorage.removeItem(EXPERIENCE_SLUG_STORAGE_KEY)
    coldTap("day1", SLUG)
    const renderer = await render()

    expect(fakeRouter.push).not.toHaveBeenCalled()
    expect(adapter.clearLastResponse).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("navigates at once for a tap that arrives while the app runs (R12)", async () => {
    const renderer = await render()
    expect(fakeRouter.push).not.toHaveBeenCalled()

    await act(async () => {
      emitResponse(buildLapseReminderPayload("day1", { slug: SLUG }))
    })

    expect(fakeRouter.push).toHaveBeenCalledWith(WATCH_PATH)
    expect(consumeDeepLinkArrival(SLUG)).toEqual({
      entry: "warm",
      origin: "reminder",
    })
    await act(async () => renderer.unmount())
  })

  it("navigates once across a StrictMode remount", async () => {
    coldTap("day7", SLUG)
    const renderer = await render(true)

    // Anti-vacuous: two mount passes prove the effect cycle really ran
    // setup -> cleanup -> setup, so one push is a result and not an accident.
    expect(adapter.getPermission).toHaveBeenCalledTimes(2)
    expect(fakeRouter.push).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })

  it("stops listening for taps on unmount", async () => {
    const renderer = await render()
    expect(adapter.subscribeToResponses).toHaveBeenCalledTimes(1)

    await act(async () => renderer.unmount())
    // Both halves: the subscription is released, and the listener the module
    // still holds navigates nothing.
    emitResponse(buildLapseReminderPayload("day1", { slug: SLUG }))

    expect(notificationsModule.__unsubscribeResponses).toHaveBeenCalledTimes(1)
    expect(fakeRouter.push).not.toHaveBeenCalled()
  })
})

describe("the build-time gate (KTD8)", () => {
  it("records no new video while the gate is off", async () => {
    const playback = (require as unknown as NodeRequireLike)(
      "../../lib/miniPlayer/playbackRequest",
    ) as {
      __emitPlaying: (slug: string) => void
      getPlaybackRequestStore: () => { subscribe: jest.Mock }
    }
    const store = recordStoreModule.getLastWatchedStore()
    lapseConstants.LAPSE_REMINDERS_ENABLED = false
    const renderer = await render()

    await act(async () => {
      playback.__emitPlaying("considering-christmas")
    })

    // Over the WHOLE render: the writer also reads once at attach, so a
    // mockClear after the render would hide that first write.
    expect(store.write).not.toHaveBeenCalled()
    // And the mechanism, not just the outcome: no writer is attached at all.
    expect(playback.getPlaybackRequestStore().subscribe).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it("still stands the pending reminders down while the gate is off", async () => {
    lapseConstants.LAPSE_REMINDERS_ENABLED = false
    const renderer = await render()

    // KTD8's off path is load-bearing: the OS keeps the reminders scheduled
    // before the flip, so the pass that schedules nothing still clears them.
    expect(adapter.cancel.mock.calls.map((call) => call[0])).toEqual([
      LAPSE_REMINDER_IDENTIFIERS.day1,
      LAPSE_REMINDER_IDENTIFIERS.day7,
    ])
    expect(adapter.dismissDelivered).toHaveBeenCalled()
    expect(adapter.schedule).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})
