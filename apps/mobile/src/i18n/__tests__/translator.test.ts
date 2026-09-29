// Node's `Intl.PluralRules` and `Intl.Locale` are deleted BEFORE the polyfill
// loads, as on Hermes, so every plural here goes through the polyfill-force
// path (KTD1), not through Node's own Intl.
import type * as TranslatorModule from "../translator"
import type * as PluralRulesModule from "../pluralRules"
import type * as DatadogModule from "../../lib/datadog"

jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

type IntlSlots = { PluralRules?: unknown; Locale?: unknown }
type Polyfilled = { polyfilled?: boolean; getDefaultLocale?: () => string }

// Test-only loaders. The app bundle requires plural data only through
// pluralData.generated.ts (R8); catalogIndex.guard.test.js pins that.
const TEST_PLURAL_LOADERS: Record<string, () => void> = {
  ar: () => jest.requireActual("@formatjs/intl-pluralrules/locale-data/ar.js"),
  en: () => jest.requireActual("@formatjs/intl-pluralrules/locale-data/en.js"),
  ru: () => jest.requireActual("@formatjs/intl-pluralrules/locale-data/ru.js"),
  sr: () => jest.requireActual("@formatjs/intl-pluralrules/locale-data/sr.js"),
  zh: () => jest.requireActual("@formatjs/intl-pluralrules/locale-data/zh.js"),
}

// The catalog-to-data pairs the generator derives for these tags;
// catalogIndex.guard.test.js pins the same pairs from the generator's output.
const PLURAL_TAG = {
  en: "en",
  ar: "ar",
  ru: "ru",
  "zh-Hans": "zh",
  "sr-Latn": "sr",
  qu: "en",
} as const

const FSI = "\u2068"
const PDI = "\u2069"

const EN = {
  Watch: {
    greeting: "Hello, {name}",
    episodes: "{count, plural, one {# episode} other {# episodes}}",
    title: "Watch",
  },
}

let translator: typeof TranslatorModule
let pluralRules: typeof PluralRulesModule
let datadog: typeof DatadogModule
let pluralRulesBefore: unknown
let localeBefore: unknown

beforeAll(() => {
  const intl = Intl as unknown as IntlSlots
  delete intl.PluralRules
  delete intl.Locale
  pluralRulesBefore = intl.PluralRules
  localeBefore = intl.Locale
  jest.isolateModules(() => {
    pluralRules = jest.requireActual("../pluralRules")
    translator = jest.requireActual("../translator")
  })
  // The translator requires the Datadog helper lazily, at failure time. That
  // require runs after the isolated registry closes, so it gets this mock.
  datadog = jest.requireMock("../../lib/datadog")
})

beforeEach(() => {
  jest.mocked(datadog.datadogLog.warn).mockClear()
  translator.resetMessageErrorReportsForTests()
})

function make(
  catalogTag: keyof typeof PLURAL_TAG,
  messages: Record<string, unknown>,
  fallback: TranslatorModule.UiTranslator | null = null,
): TranslatorModule.UiTranslator {
  const pluralTag = PLURAL_TAG[catalogTag]
  pluralRules.loadPluralData(pluralTag, TEST_PLURAL_LOADERS)
  return translator.createUiTranslator({
    catalogTag,
    pluralTag,
    messages,
    fallback: fallback ? () => fallback : null,
  })
}

function categories(catalogTag: keyof typeof PLURAL_TAG) {
  const t = make(catalogTag, {
    P: {
      pick: "{count, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}",
    },
  })
  return (count: number) => t.translate("P.pick", { count })
}

describe("plural polyfill on a Hermes-like engine (KTD1)", () => {
  it("starts from an engine with no Intl.PluralRules or Intl.Locale", () => {
    expect(pluralRulesBefore).toBeUndefined()
    expect(localeBefore).toBeUndefined()
    expect((Intl.PluralRules as unknown as Polyfilled).polyfilled).toBe(true)
    expect((Intl.Locale as unknown as Polyfilled).polyfilled).toBe(true)
  })

  it("registers en data before any other locale", () => {
    make("ar", {})
    const rules = Intl.PluralRules as unknown as Polyfilled
    expect(rules.getDefaultLocale?.()).toBe("en")
  })

  it("formats en with one and other", () => {
    const t = make("en", EN)
    expect(t.translate("Watch.episodes", { count: 1 })).toBe("1 episode")
    expect(t.translate("Watch.episodes", { count: 2 })).toBe("2 episodes")
  })

  it("formats ar with all six categories", () => {
    const pick = categories("ar")
    expect([0, 1, 2, 5, 11, 100].map(pick)).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "many",
      "other",
    ])
  })

  it("formats ru with one, few, and many", () => {
    const pick = categories("ru")
    expect([1, 2, 5, 21, 1.5].map(pick)).toEqual([
      "one",
      "few",
      "many",
      "one",
      "other",
    ])
  })

  it("formats zh-Hans under the bare zh data", () => {
    const pick = categories("zh-Hans")
    expect([1, 2].map(pick)).toEqual(["other", "other"])
    expect(new Intl.PluralRules("zh").resolvedOptions().locale).toBe("zh")
  })

  it("formats sr-Latn under the bare sr data", () => {
    const pick = categories("sr-Latn")
    expect([1, 3, 5, 21].map(pick)).toEqual(["one", "few", "other", "one"])
  })

  it("formats qu, which has no CLDR data, with English rules", () => {
    const pick = categories("qu")
    expect([1, 2].map(pick)).toEqual(["one", "other"])
  })
})

describe("missing keys and format errors", () => {
  it("returns the formatted English sentence for a missing key and logs once", () => {
    const english = make("en", EN)
    const ru = make("ru", { Watch: { title: "Смотреть" } }, english)

    expect(ru.translate("Watch.greeting", { name: "Ana" })).toBe("Hello, Ana")
    expect(ru.translate("Watch.greeting", { name: "Ana" })).toBe("Hello, Ana")
    expect(ru.translate("Watch.episodes", { count: 21 })).toBe("21 episodes")

    const warn = jest.mocked(datadog.datadogLog.warn)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith("ui_locale.message_error", {
      "ui_locale.key": "Watch.greeting",
      "ui_locale.catalog": "ru",
      "ui_locale.error_code": "MISSING_MESSAGE",
    })
  })

  it("returns the formatted English sentence for a formatting error and logs once", () => {
    const english = make("en", EN)
    const ru = make(
      "ru",
      {
        Watch: {
          greeting: "Привет, {person}",
          episodes: "{count, plural, one {# серия",
        },
      },
      english,
    )

    expect(ru.translate("Watch.greeting", { name: "Ana" })).toBe("Hello, Ana")
    expect(ru.translate("Watch.episodes", { count: 3 })).toBe("3 episodes")

    const warn = jest.mocked(datadog.datadogLog.warn)
    expect(warn).toHaveBeenCalledTimes(2)
    const codes = warn.mock.calls.map(
      ([, context]) =>
        (context as Record<string, string>)["ui_locale.error_code"],
    )
    expect(codes).toEqual(["FORMATTING_ERROR", "INVALID_MESSAGE"])
    for (const [, context] of warn.mock.calls) {
      for (const reserved of ["message", "source", "status", "host"]) {
        expect(context).not.toHaveProperty(reserved)
      }
    }
  })

  it("does not print use-intl's own console errors", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation()
    const english = make("en", EN)
    make("ru", {}, english).translate("Watch.greeting", { name: "Ana" })
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it("formats the English fallback under English plural rules", () => {
    const english = make("en", EN)
    const zh = make("zh-Hans", { Watch: {} }, english)
    expect(zh.translate("Watch.episodes", { count: 1 })).toBe("1 episode")
    expect(zh.translate("Watch.episodes", { count: 3 })).toBe("3 episodes")

    const ru = make("ru", { Watch: {} }, english)
    expect(ru.translate("Watch.episodes", { count: 21 })).toBe("21 episodes")
  })

  it("returns the key path when English also has no message", () => {
    const english = make("en", EN)
    const ru = make("ru", {}, english)
    expect(ru.translate("Watch.nowhere")).toBe("Watch.nowhere")
    const catalogs = jest
      .mocked(datadog.datadogLog.warn)
      .mock.calls.map(
        ([, context]) =>
          (context as Record<string, string>)["ui_locale.catalog"],
      )
    expect(catalogs).toEqual(["ru", "en"])
  })

  it("answers has() for the active catalog only", () => {
    const english = make("en", EN)
    const ru = make("ru", { Watch: { title: "Смотреть" } }, english)
    expect(ru.has("Watch.title")).toBe(true)
    expect(ru.has("Watch.greeting")).toBe(false)
  })
})

describe("bidirectional isolation of values (KTD13)", () => {
  const AR = {
    Cast: {
      castingTo: "جارٍ الإرسال إلى {device}",
      items: "{count, plural, other {# عناصر}}",
      kind: "{kind, select, movie {فيلم} other {عنصر}}",
      kindAgain: "{kind, select, movie {فيلم} other {عنصر}} {kind}",
      at: "{count, number} {device}",
    },
  }
  const EN_CAST = { Cast: { castingTo: "Casting to {device}" } }

  it("wraps an Arabic device name in an ar catalog", () => {
    const t = make("ar", AR)
    expect(t.translate("Cast.castingTo", { device: "جهاز التلفاز" })).toBe(
      `جارٍ الإرسال إلى ${FSI}جهاز التلفاز${PDI}`,
    )
  })

  it("wraps a Latin value in a right-to-left catalog", () => {
    const t = make("ar", AR)
    expect(t.translate("Cast.castingTo", { device: "Living Room TV" })).toBe(
      `جارٍ الإرسال إلى ${FSI}Living Room TV${PDI}`,
    )
  })

  it("leaves a Latin value in an en catalog byte-identical", () => {
    const t = make("en", EN_CAST)
    expect(t.translate("Cast.castingTo", { device: "Living Room TV" })).toBe(
      "Casting to Living Room TV",
    )
  })

  it("wraps a right-to-left value in an en catalog", () => {
    const t = make("en", EN_CAST)
    expect(t.translate("Cast.castingTo", { device: "جهاز التلفاز" })).toBe(
      `Casting to ${FSI}جهاز التلفاز${PDI}`,
    )
  })

  it("never wraps a plural count", () => {
    const t = make("ar", AR)
    expect(t.translate("Cast.items", { count: 3 })).not.toContain(FSI)
  })

  it("never wraps a select argument, even one also used as a plain value", () => {
    const t = make("ar", AR)
    expect(t.translate("Cast.kind", { kind: "movie" })).toBe("فيلم")
    expect(t.translate("Cast.kindAgain", { kind: "movie" })).toBe("فيلم movie")
  })

  it("wraps only the plain argument next to a number argument", () => {
    const t = make("ar", AR)
    const out = t.translate("Cast.at", { count: 2, device: "TV" })
    expect(out.startsWith(FSI)).toBe(false)
    expect(out.endsWith(`${FSI}TV${PDI}`)).toBe(true)
  })
})

describe("pseudo-locale", () => {
  const SOURCE = {
    Common: {
      goBackAriaLabel: "Go back",
      greeting: "Hello, {name}",
      episodes: "{count, plural, one {# episode} other {# episodes}}",
      apostrophe: "Don't stop",
    },
  }

  function pseudo() {
    return make("en", translator.pseudoLocalizeMessages(SOURCE))
  }

  it("accents the text and makes it about 40% longer", () => {
    const out = pseudo().translate("Common.goBackAriaLabel")
    expect(out).not.toBe("Go back")
    expect(out).not.toMatch(/[A-Za-z]/)
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil("Go back".length * 1.4))
  })

  it("keeps placeholders, plurals, and apostrophes working", () => {
    const t = pseudo()
    expect(t.translate("Common.greeting", { name: "Ana" })).toContain("Ana")
    expect(t.translate("Common.episodes", { count: 2 })).toContain("2")
    expect(t.translate("Common.apostrophe")).toContain("'")
  })
})
