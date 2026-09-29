import { AppState, type AppStateStatus } from "react-native"

import {
  defaultAudioLanguage,
  getActiveTranslator,
  getCatalogTag,
  getLocaleEpoch,
  getLocaleResolution,
  getPhoneLocales,
  isPseudoLocaleRequested,
  localeResolutionAttributes,
  refreshLocale,
  resetLocaleStoreForTests,
  startLocaleSync,
  subscribeLocale,
} from "../localeStore"
import { resetMessageErrorReportsForTests } from "../translator"

const mockGetLocales = jest.fn()
jest.mock("expo-localization", () => ({
  getLocales: () => mockGetLocales(),
}))

const mockLocaleListeners: (() => void)[] = []
jest.mock("expo-localization/build/ExpoLocalization", () => ({
  addLocaleListener: (listener: () => void) => {
    mockLocaleListeners.push(listener)
    return { remove: () => undefined }
  },
}))

// A fixture catalog set: mobile ships only `en` today. Each loader records
// its call, so a case can prove which catalogs reached the heap (R8).
const mockCatalogLoads: string[] = []
jest.mock("../catalogs.generated", () => {
  const catalogs: Record<string, object> = {
    en: {
      Common: { goBackAriaLabel: "Go back" },
      Watch: {
        episodes: "{count, plural, one {# episode} other {# episodes}}",
      },
    },
    es: { Common: { goBackAriaLabel: "Volver" } },
    ru: { Common: { goBackAriaLabel: "Назад" }, Watch: {} },
  }
  return {
    CATALOG_TAGS: Object.keys(catalogs),
    CATALOG_LOADERS: Object.fromEntries(
      Object.entries(catalogs).map(([tag, messages]) => [
        tag,
        () => {
          mockCatalogLoads.push(tag)
          return messages
        },
      ]),
    ),
  }
})

const mockPluralLoads: string[] = []
jest.mock("../pluralData.generated", () => {
  const load = (tag: string, data: () => void) => () => {
    mockPluralLoads.push(tag)
    data()
  }
  return {
    PLURAL_DATA_TAG: { en: "en", es: "es", ru: "ru" },
    PLURAL_DATA_LOADERS: {
      en: load("en", () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/en.js"),
      ),
      es: load("es", () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/es.js"),
      ),
      ru: load("ru", () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/ru.js"),
      ),
    },
  }
})

jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const phone = (...tags: string[]) =>
  tags.map((languageTag) => ({
    languageTag,
    languageCode: languageTag.split("-")[0],
  }))

let appStateHandler: ((state: AppStateStatus) => void) | null = null

beforeEach(() => {
  resetLocaleStoreForTests()
  resetMessageErrorReportsForTests()
  mockGetLocales.mockReset()
  mockLocaleListeners.length = 0
  mockCatalogLoads.length = 0
  appStateHandler = null
  // react-native's jest setup already mocks this, so spyOn returns that same
  // mock and its calls outlive restoreAllMocks. Clear them per case.
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(((
      _type: string,
      handler: (state: AppStateStatus) => void,
    ) => {
      appStateHandler = handler
      return { remove: () => undefined }
    }) as typeof AppState.addEventListener)
    .mockClear()
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe("locale store defaults", () => {
  it("starts on en with epoch 0 and makes no native read", () => {
    expect(getCatalogTag()).toBe("en")
    expect(getLocaleEpoch()).toBe(0)
    expect(getActiveTranslator().translate("Common.goBackAriaLabel")).toBe(
      "Go back",
    )
    expect(mockGetLocales).not.toHaveBeenCalled()
    expect(getPhoneLocales()).toEqual([])
  })
})

describe("startLocaleSync", () => {
  it("sets es for [es-MX] with epoch 0 and notifies no listener", () => {
    mockGetLocales.mockReturnValue(phone("es-MX"))
    const listener = jest.fn()
    subscribeLocale(listener)

    startLocaleSync()

    expect(getCatalogTag()).toBe("es")
    expect(getLocaleEpoch()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
    expect(getActiveTranslator().translate("Common.goBackAriaLabel")).toBe(
      "Volver",
    )
  })

  it("keeps the raw phone language list readable", () => {
    const locales = phone("es-MX", "en-US")
    mockGetLocales.mockReturnValue(locales)
    startLocaleSync()
    expect(getPhoneLocales()).toBe(locales)
  })

  it("keeps en and records the reason when getLocales throws", () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error("Cannot find native module 'ExpoLocalization'")
    })

    expect(() => startLocaleSync()).not.toThrow()

    expect(getCatalogTag()).toBe("en")
    expect(getLocaleEpoch()).toBe(0)
    expect(getLocaleResolution()).toMatchObject({
      tag: "en",
      match: "error",
      errorReason: "Error: Cannot find native module 'ExpoLocalization'",
    })
  })

  it("loads en plural data before the active catalog's (KTD3)", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    mockPluralLoads.length = 0
    // Fresh modules: pluralRules.ts loads each tag once per module instance.
    jest.isolateModules(() => {
      const store =
        jest.requireActual<typeof import("../localeStore")>("../localeStore")
      store.startLocaleSync()
      expect(store.getCatalogTag()).toBe("ru")
    })
    expect(mockPluralLoads).toEqual(["en", "ru"])
  })

  it("keeps en when getLocales returns no list", () => {
    mockGetLocales.mockReturnValue(undefined)
    expect(() => startLocaleSync()).not.toThrow()
    expect(getCatalogTag()).toBe("en")
    expect(getLocaleResolution().errorReason).toBe(
      "getLocales returned no list",
    )
  })

  it("skips entries without a language tag", () => {
    mockGetLocales.mockReturnValue([
      null,
      { languageCode: "x" },
      ...phone("es"),
    ])
    startLocaleSync()
    expect(getCatalogTag()).toBe("es")
  })

  it("loads only the active catalog until a key is missing (R8)", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    startLocaleSync()
    expect(mockCatalogLoads).toEqual(["ru"])

    getActiveTranslator().translate("Watch.episodes", { count: 21 })
    expect(mockCatalogLoads).toEqual(["ru", "en"])
  })

  it("formats the English fallback under English rules while ru is active", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    startLocaleSync()
    expect(
      getActiveTranslator().translate("Watch.episodes", { count: 21 }),
    ).toBe("21 episodes")
  })

  it("registers its listeners once", () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    startLocaleSync()
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1)
    expect(mockLocaleListeners).toHaveLength(1)
    expect(mockGetLocales).toHaveBeenCalledTimes(1)
  })
})

describe("refreshLocale", () => {
  it("bumps the epoch when the tag changes, and repeat calls change nothing", () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    const listener = jest.fn()
    subscribeLocale(listener)

    mockGetLocales.mockReturnValue(phone("ru-RU"))
    refreshLocale()
    expect(getCatalogTag()).toBe("ru")
    expect(getLocaleEpoch()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    for (let i = 0; i < 10; i += 1) refreshLocale()
    expect(getLocaleEpoch()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getActiveTranslator().translate("Common.goBackAriaLabel")).toBe(
      "Назад",
    )
  })

  it("runs on a return to the foreground", () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    mockGetLocales.mockReturnValue(phone("es-ES"))

    appStateHandler?.("background")
    expect(getCatalogTag()).toBe("en")
    appStateHandler?.("active")
    expect(getCatalogTag()).toBe("es")
  })

  it("runs on the native locale event", () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    mockGetLocales.mockReturnValue(phone("es-ES"))
    mockLocaleListeners[0]?.()
    expect(getCatalogTag()).toBe("es")
    expect(getLocaleEpoch()).toBe(1)
  })

  it("keeps the current locale when the read fails", () => {
    mockGetLocales.mockReturnValue(phone("es-ES"))
    startLocaleSync()
    mockGetLocales.mockImplementation(() => {
      throw new Error("boom")
    })
    expect(() => refreshLocale()).not.toThrow()
    expect(getCatalogTag()).toBe("es")
    expect(getLocaleEpoch()).toBe(0)
  })

  it("does nothing before the store starts", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    refreshLocale()
    expect(mockGetLocales).not.toHaveBeenCalled()
    expect(getCatalogTag()).toBe("en")
  })
})

// KTD12: one phone-language default for audio, subtitles, the Bible reader,
// For You, and Explore.
describe("defaultAudioLanguage", () => {
  it("is null before the first read", () => {
    expect(defaultAudioLanguage()).toBeNull()
  })

  it("is null when the phone list is empty", () => {
    mockGetLocales.mockReturnValue([])
    startLocaleSync()
    expect(defaultAudioLanguage()).toBeNull()
  })

  it("is null when getLocales throws", () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error("Cannot find native module 'ExpoLocalization'")
    })
    startLocaleSync()
    expect(defaultAudioLanguage()).toBeNull()
  })

  it("takes the first phone language before any catalog fallback", () => {
    // ha has no catalog, so the UI falls to es; the audio stays Hausa (AE10).
    mockGetLocales.mockReturnValue(phone("ha-NG", "es-MX"))
    startLocaleSync()
    expect(getCatalogTag()).toBe("es")
    expect(defaultAudioLanguage()).toEqual({ tag: "ha-NG", slug: "hausa" })
  })

  it("maps a Russian phone to the russian slug", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    startLocaleSync()
    expect(defaultAudioLanguage()).toEqual({ tag: "ru-RU", slug: "russian" })
  })

  it("maps through the reviewed entries", () => {
    mockGetLocales.mockReturnValue(phone("es-ES"))
    startLocaleSync()
    expect(defaultAudioLanguage()?.slug).toBe("spanish-castilian")
    mockGetLocales.mockReturnValue(phone("bn-BD"))
    refreshLocale()
    expect(defaultAudioLanguage()?.slug).toBe("bangla-2")
  })

  it("keeps the tag when no slug maps, so a caller can match on it", () => {
    mockGetLocales.mockReturnValue(phone("xx-YY"))
    startLocaleSync()
    expect(defaultAudioLanguage()).toEqual({ tag: "xx-YY", slug: null })
  })

  it("skips entries without a language tag", () => {
    mockGetLocales.mockReturnValue([
      null,
      { languageCode: "x" },
      ...phone("ko"),
    ])
    startLocaleSync()
    expect(defaultAudioLanguage()).toEqual({ tag: "ko", slug: "korean" })
  })

  it("follows a phone change that keeps the catalog, with no epoch change", () => {
    mockGetLocales.mockReturnValue(phone("ha-NG"))
    startLocaleSync()
    mockGetLocales.mockReturnValue(phone("yo-NG"))
    refreshLocale()
    expect(getCatalogTag()).toBe("en")
    expect(getLocaleEpoch()).toBe(0)
    expect(defaultAudioLanguage()).toEqual({ tag: "yo-NG", slug: "yoruba" })
  })
})

describe("ui_locale telemetry attributes", () => {
  it("describes a language fallback", () => {
    mockGetLocales.mockReturnValue(phone("es-MX"))
    startLocaleSync()
    expect(localeResolutionAttributes(getLocaleResolution())).toEqual({
      "ui_locale.resolved": "es",
      "ui_locale.requested": "es-MX",
      "ui_locale.fallback": "language",
    })
  })

  it("describes an exact first match as no fallback", () => {
    mockGetLocales.mockReturnValue(phone("ru"))
    startLocaleSync()
    expect(
      localeResolutionAttributes(getLocaleResolution())["ui_locale.fallback"],
    ).toBe("none")
  })

  it("describes a later preference and an English default", () => {
    mockGetLocales.mockReturnValue(phone("ha", "es"))
    startLocaleSync()
    expect(
      localeResolutionAttributes(getLocaleResolution())["ui_locale.fallback"],
    ).toBe("later_preference")

    resetLocaleStoreForTests()
    mockGetLocales.mockReturnValue(phone("ha"))
    startLocaleSync()
    expect(
      localeResolutionAttributes(getLocaleResolution())["ui_locale.fallback"],
    ).toBe("english")
  })

  it("carries the error reason and no reserved attribute name", () => {
    mockGetLocales.mockImplementation(() => {
      throw new Error("boom")
    })
    startLocaleSync()
    const attributes = localeResolutionAttributes(getLocaleResolution())
    expect(attributes).toEqual({
      "ui_locale.resolved": "en",
      "ui_locale.requested": "",
      "ui_locale.fallback": "error",
      "ui_locale.error_reason": "Error: boom",
    })
    for (const reserved of ["message", "source", "status", "host"]) {
      expect(attributes).not.toHaveProperty(reserved)
    }
  })
})

describe("pseudo-locale", () => {
  it("is requested only in development and only by an exact value", () => {
    expect(isPseudoLocaleRequested(true, "1")).toBe(true)
    expect(isPseudoLocaleRequested(true, "true")).toBe(true)
    expect(isPseudoLocaleRequested(false, "1")).toBe(false)
    expect(isPseudoLocaleRequested(true, undefined)).toBe(false)
    expect(isPseudoLocaleRequested(true, "0")).toBe(false)
  })

  it("accents English text, keeps en for content, and ignores the phone", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    startLocaleSync({ pseudo: true })
    expect(getCatalogTag()).toBe("en")
    expect(getLocaleResolution().match).toBe("pseudo")
    const text = getActiveTranslator().translate("Common.goBackAriaLabel")
    expect(text).not.toBe("Go back")
    expect(text).not.toMatch(/[A-Za-z]/)
  })

  it("cannot be selected in a production build", () => {
    const globals = globalThis as unknown as { __DEV__: boolean }
    const dev = globals.__DEV__
    globals.__DEV__ = false
    try {
      mockGetLocales.mockReturnValue(phone("en-US"))
      startLocaleSync({ pseudo: true })
      expect(getLocaleResolution().match).not.toBe("pseudo")
      expect(getActiveTranslator().translate("Common.goBackAriaLabel")).toBe(
        "Go back",
      )
    } finally {
      globals.__DEV__ = dev
    }
  })
})

// Last in the file: it swaps the module registry. A dev client built before
// this native module throws at require time, not inside getLocales().
describe("start without the native module", () => {
  it("keeps en when requiring expo-localization throws", () => {
    jest.resetModules()
    jest.doMock("expo-localization", () => {
      throw new Error("Cannot find native module 'ExpoLocalization'")
    })
    try {
      const store =
        jest.requireActual<typeof import("../localeStore")>("../localeStore")
      expect(() => store.startLocaleSync()).not.toThrow()
      expect(store.getCatalogTag()).toBe("en")
      expect(store.getLocaleResolution().errorReason).toBe(
        "Error: Cannot find native module 'ExpoLocalization'",
      )
      expect(
        store.getActiveTranslator().translate("Common.goBackAriaLabel"),
      ).toBe("Go back")
      // The default audio then falls to the video's primary language.
      expect(store.defaultAudioLanguage()).toBeNull()
    } finally {
      jest.doMock("expo-localization", () => ({
        getLocales: () => mockGetLocales(),
      }))
      jest.resetModules()
    }
  })
})
