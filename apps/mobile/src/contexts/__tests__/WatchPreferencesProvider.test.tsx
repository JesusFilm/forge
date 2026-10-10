/**
 * The audio language write path (U6): the ISO 639-3 code travels with the slug,
 * and a fill for an older record lands only while that slug is still stored.
 * The saved Explore mute choice (feat-552 R11) is written the same way.
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

// The phone's languages reach the provider through the real locale store.
// `es` is a fixture catalog, so a phone change moves the locale epoch.
const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: () => ({ remove: () => undefined }),
}))
jest.mock("../../i18n/catalogs.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixtureCatalogs(jest.requireActual("../../i18n/catalogs.generated"), {
      es: {},
    }),
)
jest.mock("../../i18n/pluralData.generated", () =>
  jest
    .requireActual("../../test-utils/uiLocaleFixture")
    .withFixturePluralData(
      jest.requireActual("../../i18n/pluralData.generated"),
      ["es"],
    ),
)

import { StrictMode, act } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  getLocaleEpoch,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
} from "../../i18n/localeStore"
import { phoneLocales } from "../../test-utils/uiLocaleFixture"
import {
  WatchPreferencesProvider,
  useWatchPreferences,
} from "../WatchPreferencesProvider"
import {
  WATCH_PREFERENCES_STORAGE_KEY,
  cachedSubtitleName,
  parseStoredPreferences,
} from "../../lib/watchPreferences"
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

// KTD16: the cached subtitle name is display text in one UI language. On
// Android a language change reaches a running app, with no relaunch.
describe("the cached subtitle name and the UI language", () => {
  const ENGLISH_NAME = {
    subtitleLanguageSlug: "french",
    subtitleLanguageName: "French",
    subtitleLanguageNameLocale: "en",
  }

  async function changePhone(tag: string) {
    mockGetLocales.mockReturnValue(phoneLocales(tag))
    await act(async () => {
      refreshLocale()
    })
  }

  beforeEach(() => {
    resetLocaleStoreForTests()
    mockGetLocales.mockReturnValue(phoneLocales("en-US"))
    startLocaleSync()
  })

  afterEach(() => resetLocaleStoreForTests())

  // KD12: a screen open before the change keeps `en`, so it must still read
  // the name. A screen opened after the change captures `es` and must not.
  it("keeps the name and its tag through a live change, for each screen to gate", async () => {
    await renderWithStored(ENGLISH_NAME)
    expect(cachedSubtitleName(prefs, "en")).toBe("French")

    await changePhone("es-MX")

    expect(getLocaleEpoch()).toBe(1)
    expect(prefs.subtitleLanguageNameLocale).toBe("en")
    expect(cachedSubtitleName(prefs, "en")).toBe("French")
    expect(cachedSubtitleName(prefs, "es")).toBeNull()
    // The pick itself never follows the UI language.
    expect(prefs.subtitleLanguageSlug).toBe("french")
  })

  it("stores a new name with the UI tag it is in", async () => {
    await renderWithStored(ENGLISH_NAME)
    await changePhone("es-MX")

    await act(async () => {
      prefs.setPreferredSubtitleName("Francés")
    })

    expect(cachedSubtitleName(prefs, "es")).toBe("Francés")
    expect(await storedBlob()).toMatchObject({
      subtitleLanguageName: "Francés",
      subtitleLanguageNameLocale: "es",
    })

    // Back to English: a screen opened now must not paint the Spanish name.
    await changePhone("en-US")
    expect(cachedSubtitleName(prefs, "en")).toBeNull()
  })

  // U6: an open watch screen keeps its captured language through a live
  // change, so its English name must not be saved under the new Spanish tag.
  it("stores a name with the screen's captured tag when one is passed", async () => {
    await renderWithStored(null)
    await changePhone("es-MX")

    await act(async () => {
      prefs.setPreferredSubtitleName("French", "en")
    })

    expect(await storedBlob()).toMatchObject({
      subtitleLanguageName: "French",
      subtitleLanguageNameLocale: "en",
    })
    // The English screen reads it; a Spanish screen does not.
    expect(cachedSubtitleName(prefs, "en")).toBe("French")
    expect(cachedSubtitleName(prefs, "es")).toBeNull()
  })

  it("clears the locale with the name", async () => {
    await renderWithStored(ENGLISH_NAME)

    await act(async () => {
      prefs.setPreferredSubtitleName(null)
    })

    expect(prefs.subtitleLanguageName).toBeNull()
    expect(await storedBlob()).toMatchObject({
      subtitleLanguageName: null,
      subtitleLanguageNameLocale: null,
    })
  })
})

describe("setExploreMuted (feat-552 R11)", () => {
  it("starts with sound, and saves the mute choice to the device", async () => {
    await renderWithStored(null)
    expect(prefs.exploreMuted).toBe(false)

    await act(async () => {
      prefs.setExploreMuted(true)
    })

    expect(prefs.exploreMuted).toBe(true)
    const stored = await AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
    expect(parseStoredPreferences(stored).exploreMuted).toBe(true)
  })

  it("reads a saved mute choice back after a restart", async () => {
    await renderWithStored({ exploreMuted: true })
    expect(prefs.exploreMuted).toBe(true)

    await act(async () => {
      prefs.setExploreMuted(false)
    })

    const stored = await AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
    expect(parseStoredPreferences(stored).exploreMuted).toBe(false)
  })
})
