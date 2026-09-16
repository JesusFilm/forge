/**
 * The provider's wiring, driven through the REAL lifecycle: only the native
 * adapter, the two stores and the log sink are doubled, so these tests fail
 * when the provider stops passing a dependency the pass depends on.
 *
 * `@react-native-async-storage/async-storage` never loads here, because the
 * record store itself is doubled.
 */

jest.mock("../../lib/lapseReminders/notificationsAdapter", () => ({
  lapseReminderNotifications: {
    getPermission: jest.fn(async () => ({ granted: true, canAskAgain: false })),
    schedule: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    dismissDelivered: jest.fn(async () => {}),
  },
}))
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
  const snapshot = { request: null, playing: false }
  // One store object, not a fresh one per call: the test reads the same
  // `subscribe` mock the provider was handed.
  const store = {
    subscribe: jest.fn(() => jest.fn()),
    getSnapshot: () => snapshot,
  }
  return { getPlaybackRequestStore: () => store }
})

import { StrictMode, act } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { LapseReminderProvider } from "../LapseReminderProvider"
import { LAPSE_REMINDER_IDENTIFIERS } from "../../lib/lapseReminders/constants"
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
}

const adapter = lapseReminderNotifications as unknown as {
  getPermission: jest.Mock
  schedule: jest.Mock
  cancel: jest.Mock
  dismissDelivered: jest.Mock
}

const appStateListeners = new Set<(state: AppStateStatus) => void>()

async function render(strict = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    const tree = <LapseReminderProvider>{null}</LapseReminderProvider>
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

beforeEach(() => {
  jest.clearAllMocks()
  appStateListeners.clear()
  adapter.getPermission.mockResolvedValue({ granted: true, canAskAgain: false })
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
        <LapseReminderProvider>
          <>{null}</>
        </LapseReminderProvider>,
      )
    })
    await act(async () => {})

    expect(renderer.toJSON()).toBeNull()
    await act(async () => renderer.unmount())
  })
})
