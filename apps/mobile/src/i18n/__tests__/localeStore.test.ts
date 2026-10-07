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

// A synthetic catalog set, not the shipped one. Each loader records its call,
// so a case can prove which catalogs reached the heap (R8). The `fr` catalog
// file fails to load, and `fr` has no plural data either.
const mockCatalogLoads: string[] = []
jest.mock("../catalogs.generated", () => {
  const catalogs: Record<string, object | null> = {
    en: {
      Common: { goBackAriaLabel: "Go back" },
      Watch: {
        episodes: "{count, plural, one {# episode} other {# episodes}}",
      },
    },
    es: { Common: { goBackAriaLabel: "Volver" } },
    ru: { Common: { goBackAriaLabel: "Назад" }, Watch: {} },
    "zh-Hans": {
      Watch: { episodes: "{count, plural, one {# 集 (one)} other {# 集}}" },
    },
    fr: null,
  }
  return {
    CATALOG_TAGS: Object.keys(catalogs),
    ENGLISH_ONLY_TAGS: [],
    CATALOG_LOADERS: Object.fromEntries(
      Object.entries(catalogs).map(([tag, messages]) => [
        tag,
        () => {
          mockCatalogLoads.push(tag)
          if (!messages) throw new Error(`broken ${tag} catalog`)
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
    PLURAL_DATA_TAG: {
      en: "en",
      es: "es",
      ru: "ru",
      "zh-Hans": "zh",
      fr: "fr",
    },
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
      zh: load("zh", () =>
        jest.requireActual("@formatjs/intl-pluralrules/locale-data/zh.js"),
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
    expect(defaultAudioLanguage()).toBeNull()
  })
})

describe("startLocaleSync", () => {
  it("sets es for [es-MX] with epoch 0 and notifies no listener", () => {
    const locales = phone("es-MX", "en-US")
    mockGetLocales.mockReturnValue(locales)
    const listener = jest.fn()
    subscribeLocale(listener)

    startLocaleSync()

    expect(getCatalogTag()).toBe("es")
    expect(getLocaleEpoch()).toBe(0)
    expect(listener).not.toHaveBeenCalled()
    expect(getActiveTranslator().translate("Common.goBackAriaLabel")).toBe(
      "Volver",
    )
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
    expect(defaultAudioLanguage()).toBeNull()
  })

  // zh-Hans formats plurals under the zh data, where 1 is "other" (KTD1).
  it("loads en plural data, then the data tag of the active catalog (KTD3)", () => {
    mockGetLocales.mockReturnValue(phone("zh-Hans"))
    mockPluralLoads.length = 0
    // Fresh modules: pluralRules.ts loads each tag once per module instance.
    jest.isolateModules(() => {
      const store =
        jest.requireActual<typeof import("../localeStore")>("../localeStore")
      store.startLocaleSync()
      expect(store.getCatalogTag()).toBe("zh-Hans")
      expect(
        store.getActiveTranslator().translate("Watch.episodes", { count: 1 }),
      ).toBe("1 集")
    })
    expect(mockPluralLoads).toEqual(["en", "zh"])
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
      ...phone("", "es"),
    ])
    startLocaleSync()
    expect(getCatalogTag()).toBe("es")
    expect(defaultAudioLanguage()).toEqual({
      tag: "es",
      slug: "spanish-latin-american",
    })
  })

  it("loads only the active catalog until a key is missing (R8)", () => {
    mockGetLocales.mockReturnValue(phone("ru-RU"))
    startLocaleSync()
    expect(mockCatalogLoads).toEqual(["ru"])

    // The English fallback formats under English rules while ru is active.
    expect(
      getActiveTranslator().translate("Watch.episodes", { count: 21 }),
    ).toBe("21 episodes")
    expect(mockCatalogLoads).toEqual(["ru", "en"])
  })

  it("registers its listeners once", () => {
    mockGetLocales.mockReturnValue(phone("en-US"))
    startLocaleSync()
    startLocaleSync()
    expect(AppState.addEventListener).toHaveBeenCalledTimes(1)
    expect(mockLocaleListeners).toHaveLength(1)
    expect(mockGetLocales).toHaveBeenCalledTimes(1)
  })

  it("records the reason and keeps the catalog when AppState cannot subscribe", () => {
    jest.spyOn(AppState, "addEventListener").mockImplementation(() => {
      throw new Error("AppState unavailable")
    })
    mockGetLocales.mockReturnValue(phone("es-MX"))

    expect(() => startLocaleSync()).not.toThrow()

    expect(getCatalogTag()).toBe("es")
    expect(getLocaleEpoch()).toBe(0)
    expect(getLocaleResolution()).toMatchObject({
      match: "language",
      errorReason: null,
      listenerErrorReason: "Error: AppState unavailable",
    })
    expect(
      localeResolutionAttributes(getLocaleResolution())[
        "ui_locale.listener_error"
      ],
    ).toBe("Error: AppState unavailable")
    // Each listener is wired on its own, so the native event still arrives.
    expect(mockLocaleListeners).toHaveLength(1)
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
    expect(defaultAudioLanguage()).toEqual({ tag: "ru-RU", slug: "russian" })

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

  // The default audio reads the first phone tag, so its readers must hear a
  // change the catalog does not see; epoch snapshot readers stay put.
  it("notifies with no epoch move when the tags change inside one catalog", () => {
    mockGetLocales.mockReturnValue(phone("ha-NG"))
    startLocaleSync()
    const listener = jest.fn()
    subscribeLocale(listener)

    mockGetLocales.mockReturnValue(phone("ig-NG"))
    refreshLocale()
    expect(getCatalogTag()).toBe("en")
    expect(getLocaleEpoch()).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(defaultAudioLanguage()).toEqual({ tag: "ig-NG", slug: "igbo" })

    refreshLocale()
    refreshLocale()
    expect(listener).toHaveBeenCalledTimes(1)
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
  it("is null when the phone list is empty", () => {
    mockGetLocales.mockReturnValue([])
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

  it("keeps the tag when no slug maps, so a caller can match on it", () => {
    mockGetLocales.mockReturnValue(phone("xx-YY"))
    startLocaleSync()
    expect(defaultAudioLanguage()).toEqual({ tag: "xx-YY", slug: null })
  })
})

describe("ui_locale telemetry attributes", () => {
  // `requested` is always the first phone tag, so a later-preference match
  // still shows the demand for the missing catalog.
  it.each([
    [["es-MX"], "es", "language"],
    [["ru"], "ru", "none"],
    [["ha", "es"], "es", "later_preference"],
    [["ha"], "en", "english"],
  ])(
    "describes the phone list %j as %s, fallback %s",
    (tags, tag, fallback) => {
      mockGetLocales.mockReturnValue(phone(...tags))
      startLocaleSync()
      expect(localeResolutionAttributes(getLocaleResolution())).toEqual({
        "ui_locale.resolved": tag,
        "ui_locale.requested": tags[0],
        "ui_locale.fallback": fallback,
      })
    },
  )

  it("names the phone language and both failures when its catalog cannot load", () => {
    mockGetLocales.mockReturnValue(phone("fr-FR"))
    startLocaleSync()
    expect(getCatalogTag()).toBe("en")
    expect(localeResolutionAttributes(getLocaleResolution())).toEqual({
      "ui_locale.resolved": "en",
      "ui_locale.requested": "fr-FR",
      "ui_locale.fallback": "error",
      "ui_locale.error_reason": "Error: broken fr catalog",
      "ui_locale.plural_error": 'Error: No plural data loader for "fr"',
    })
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

  // A doMock cannot replace a module the registry already holds, and every
  // start above required this one, so the case resets the registry too.
  it("records the reason when the native locale event cannot be required", () => {
    const reason = "Error: Cannot find module 'ExpoLocalization'"
    jest.resetModules()
    jest.doMock("expo-localization/build/ExpoLocalization", () => {
      throw new Error("Cannot find module 'ExpoLocalization'")
    })
    try {
      mockGetLocales.mockReturnValue(phone("es-MX"))
      const store =
        jest.requireActual<typeof import("../localeStore")>("../localeStore")
      expect(() => store.startLocaleSync()).not.toThrow()
      expect(store.getCatalogTag()).toBe("es")
      expect(store.getLocaleEpoch()).toBe(0)
      expect(store.getLocaleResolution()).toMatchObject({
        errorReason: null,
        listenerErrorReason: reason,
      })
      expect(
        store.localeResolutionAttributes(store.getLocaleResolution())[
          "ui_locale.listener_error"
        ],
      ).toBe(reason)
    } finally {
      jest.doMock("expo-localization/build/ExpoLocalization", () => ({
        addLocaleListener: (listener: () => void) => {
          mockLocaleListeners.push(listener)
          return { remove: () => undefined }
        },
      }))
      jest.resetModules()
    }
  })
})
