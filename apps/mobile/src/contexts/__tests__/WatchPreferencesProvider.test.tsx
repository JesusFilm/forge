/**
 * The saved Explore mute choice (R11): the setter changes the value every
 * consumer reads, and writes it to the device so it survives a restart.
 */

jest.mock("@react-native-async-storage/async-storage", () =>
  jest.requireActual(
    "@react-native-async-storage/async-storage/jest/async-storage-mock",
  ),
)
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

import { act } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  WatchPreferencesProvider,
  useWatchPreferences,
} from "../WatchPreferencesProvider"
import {
  WATCH_PREFERENCES_STORAGE_KEY,
  parseStoredPreferences,
} from "../../lib/watchPreferences"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Prefs = ReturnType<typeof useWatchPreferences>

let latest: Prefs | null = null
function Probe() {
  latest = useWatchPreferences()
  return null
}

async function mount(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <WatchPreferencesProvider>
        <Probe />
      </WatchPreferencesProvider>,
    )
  })
  return renderer
}

afterEach(async () => {
  latest = null
  await AsyncStorage.clear()
  jest.clearAllMocks()
})

describe("WatchPreferencesProvider — Explore mute", () => {
  it("starts with sound, and saves the mute choice to the device", async () => {
    const renderer = await mount()
    expect(latest?.isReady).toBe(true)
    expect(latest?.exploreMuted).toBe(false)

    await act(async () => {
      latest?.setExploreMuted(true)
    })
    expect(latest?.exploreMuted).toBe(true)
    const stored = await AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
    expect(parseStoredPreferences(stored).exploreMuted).toBe(true)

    await act(async () => {
      renderer.unmount()
    })
  })

  it("reads a saved mute choice back after a restart", async () => {
    await AsyncStorage.setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ exploreMuted: true }),
    )
    const renderer = await mount()
    expect(latest?.exploreMuted).toBe(true)

    await act(async () => {
      latest?.setExploreMuted(false)
    })
    const stored = await AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
    expect(parseStoredPreferences(stored).exploreMuted).toBe(false)

    await act(async () => {
      renderer.unmount()
    })
  })
})
