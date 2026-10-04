// The settings (U5, KTD12, R28-R30, R32, R47). Each case has its own store and
// fake storage; a relaunch is a new store over the same storage. The hook case
// wraps the element in StrictMode (RTL is not installed here).
import { StrictMode, act, createElement } from "react"

import {
  TestRenderer,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  PAUSE_SETTINGS_STORAGE_KEY,
  PAUSE_TIMERS,
  createPauseSettingsStore,
  usePauseSettings,
  type PauseSettingsSnapshot,
} from "../settings"

const KEY = PAUSE_SETTINGS_STORAGE_KEY

function makeStorage(seed: string | null = null) {
  const items = new Map<string, string>()
  if (seed != null) items.set(KEY, seed)
  return {
    items,
    getItem: jest.fn(async (key: string) => items.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      items.set(key, value)
    }),
  }
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

/** The four settings, without the store's status. */
function settingsOf(snapshot: PauseSettingsSnapshot) {
  return {
    meditationLength: snapshot.meditationLength,
    reminderOn: snapshot.reminderOn,
    reminderTime: snapshot.reminderTime,
    widgetOn: snapshot.widgetOn,
  }
}

const FIRST_LAUNCH = {
  meditationLength: 3,
  reminderOn: false,
  reminderTime: { hour: 7, minute: 0 },
  widgetOn: false,
}

describe("the pause timers (R30)", () => {
  it("sets the Reflect timer and the Pray ring by Meditation length", () => {
    expect(PAUSE_TIMERS).toEqual({
      1: { reflectSec: 20, praySec: 15 },
      3: { reflectSec: 45, praySec: 30 },
      5: { reflectSec: 90, praySec: 60 },
    })
  })
})

describe("the settings record (KTD12)", () => {
  it("reads 3 min, Notifications off at 7:00 AM, and the widget off on first launch", async () => {
    const store = createPauseSettingsStore(makeStorage())
    await store.hydrate()
    expect(store.getSnapshot().status).toBe("ready")
    expect(settingsOf(store.getSnapshot())).toEqual(FIRST_LAUNCH)
  })

  it("gives a change to subscribers at once, and keeps it after a relaunch", async () => {
    const storage = makeStorage()
    const store = createPauseSettingsStore(storage)
    await store.hydrate()
    const heard: PauseSettingsSnapshot[] = []
    store.subscribe(() => heard.push(store.getSnapshot()))

    store.update({ meditationLength: 5 })
    expect(heard).toHaveLength(1)
    expect(heard[0]!.meditationLength).toBe(5)

    store.update({ reminderOn: true, reminderTime: { hour: 6, minute: 30 } })
    store.update({ widgetOn: true })
    await settle()

    const next = createPauseSettingsStore(storage)
    await next.hydrate()
    expect(settingsOf(next.getSnapshot())).toEqual({
      meditationLength: 5,
      reminderOn: true,
      reminderTime: { hour: 6, minute: 30 },
      widgetOn: true,
    })
  })

  it.each([
    ["text that is not JSON", "{not json"],
    ["a list", "[]"],
    [
      "an older version",
      JSON.stringify({
        version: 0,
        meditationLength: 5,
        reminderOn: true,
        reminderTime: { hour: 6, minute: 30 },
        widgetOn: true,
      }),
    ],
  ])("reads %s as the defaults, with no throw", async (_, raw) => {
    const store = createPauseSettingsStore(makeStorage(raw))
    await expect(store.hydrate()).resolves.toBeUndefined()
    expect(store.getSnapshot().status).toBe("ready")
    expect(settingsOf(store.getSnapshot())).toEqual(FIRST_LAUNCH)
  })

  it("keeps each field that reads when another does not", async () => {
    const raw = JSON.stringify({
      version: 1,
      meditationLength: 4,
      reminderOn: true,
      reminderTime: { hour: 25, minute: 0 },
      widgetOn: "on",
    })
    const store = createPauseSettingsStore(makeStorage(raw))
    await store.hydrate()
    expect(settingsOf(store.getSnapshot())).toEqual({
      ...FIRST_LAUNCH,
      reminderOn: true,
    })
  })
})

describe("usePauseSettings under StrictMode", () => {
  let renderer: TestInstance | null = null

  afterEach(async () => {
    if (renderer) await unmount(renderer)
    renderer = null
  })

  it("applies a change at once (R28)", async () => {
    const store = createPauseSettingsStore(makeStorage())
    const seen: PauseSettingsSnapshot[] = []
    function Probe() {
      seen.push(usePauseSettings(store))
      return null
    }
    await act(async () => {
      renderer = TestRenderer.create(
        createElement(StrictMode, null, createElement(Probe)),
      )
    })
    expect(seen.at(-1)!.meditationLength).toBe(3)
    act(() => store.update({ meditationLength: 1 }))
    expect(seen.at(-1)!.meditationLength).toBe(1)
  })
})
