/**
 * The audio language write path (U6): the ISO 639-3 code travels with the slug,
 * and a fill for an older record lands only while that slug is still stored.
 * Rendered under StrictMode so the hydration effect runs its remount cycle.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)
jest.mock("../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

import { StrictMode, act } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  WatchPreferencesProvider,
  useWatchPreferences,
} from "../WatchPreferencesProvider"
import { WATCH_PREFERENCES_STORAGE_KEY } from "../../lib/watchPreferences"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Preferences = ReturnType<typeof useWatchPreferences>

let prefs!: Preferences
function Probe() {
  prefs = useWatchPreferences()
  return null
}

let mounted: TestInstance | null = null

async function renderWithStored(blob: object | null) {
  if (blob != null) {
    await AsyncStorage.setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      JSON.stringify(blob),
    )
  }
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <WatchPreferencesProvider>
          <Probe />
        </WatchPreferencesProvider>
      </StrictMode>,
    )
  })
  expect(prefs.isReady).toBe(true)
}

async function storedBlob(): Promise<Record<string, unknown>> {
  const raw = await AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
  return JSON.parse(raw ?? "{}") as Record<string, unknown>
}

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  await AsyncStorage.clear()
})

describe("setPreferredAudioLanguage", () => {
  it("stores the code with the slug", async () => {
    await renderWithStored(null)

    await act(async () => {
      prefs.setPreferredAudioLanguage("spanish", "spa")
    })

    expect(prefs.audioLanguageSlug).toBe("spanish")
    expect(prefs.audioLanguageIso3).toBe("spa")
    const blob = await storedBlob()
    expect(blob.audioLanguageSlug).toBe("spanish")
    expect(blob.audioLanguageIso3).toBe("spa")
  })

  it("clears the previous language's code when the new one carries none", async () => {
    await renderWithStored({
      audioLanguageSlug: "spanish",
      audioLanguageIso3: "spa",
    })
    expect(prefs.audioLanguageIso3).toBe("spa")

    await act(async () => {
      prefs.setPreferredAudioLanguage("thai", null)
    })

    expect(prefs.audioLanguageSlug).toBe("thai")
    expect(prefs.audioLanguageIso3).toBeNull()
    expect((await storedBlob()).audioLanguageIso3).toBeNull()
  })
})

describe("backfillAudioLanguageIso3", () => {
  it("fills the code of a record stored before the code existed", async () => {
    await renderWithStored({ audioLanguageSlug: "spanish" })
    expect(prefs.audioLanguageIso3).toBeNull()

    await act(async () => {
      prefs.backfillAudioLanguageIso3("spanish", "spa")
    })

    expect(prefs.audioLanguageSlug).toBe("spanish")
    expect(prefs.audioLanguageIso3).toBe("spa")
    expect((await storedBlob()).audioLanguageIso3).toBe("spa")
  })

  it("drops a fill for a slug that a pick in the same tick replaced", async () => {
    await renderWithStored({ audioLanguageSlug: "spanish" })

    await act(async () => {
      prefs.setPreferredAudioLanguage("thai", null)
      prefs.backfillAudioLanguageIso3("spanish", "spa")
    })

    expect(prefs.audioLanguageSlug).toBe("thai")
    expect(prefs.audioLanguageIso3).toBeNull()
    expect((await storedBlob()).audioLanguageIso3).toBeNull()
  })

  it("keeps a code that is already stored", async () => {
    await renderWithStored({
      audioLanguageSlug: "chinese-mandarin",
      audioLanguageIso3: "cmn",
    })

    await act(async () => {
      prefs.backfillAudioLanguageIso3("chinese-mandarin", "zho")
    })

    expect(prefs.audioLanguageIso3).toBe("cmn")
  })
})
