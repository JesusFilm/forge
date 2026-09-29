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

  // zh-Hans and sr-Latn load the bare zh and sr data; qu has no CLDR data, so
  // it formats with English rules.
  it.each<[keyof typeof PLURAL_TAG, number[], string[]]>([
    [
      "ar",
      [0, 1, 2, 5, 11, 100],
      ["zero", "one", "two", "few", "many", "other"],
    ],
    ["ru", [1, 2, 5, 21, 1.5], ["one", "few", "many", "one", "other"]],
    ["zh-Hans", [1, 2], ["other", "other"]],
    ["sr-Latn", [1, 3, 5, 21], ["one", "few", "other", "one"]],
    ["qu", [1, 2], ["one", "other"]],
  ])("formats %s plurals under its data tag", (tag, counts, expected) => {
    expect(counts.map(categories(tag))).toEqual(expected)
    const dataTag = PLURAL_TAG[tag]
    expect(new Intl.PluralRules(dataTag).resolvedOptions().locale).toBe(dataTag)
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
      kind: "{kind, select, movie {فيلم} other {عنصر}} {kind}",
      removal: "{count, plural, other {حذف {count} من {title}}}",
      at: "{count, number} {device} {count}",
    },
  }
  const CAST = { ar: AR, en: { Cast: { castingTo: "Casting to {device}" } } }

  // Only a Latin value in an en catalog stays byte-identical.
  it.each([
    ["ar", "جهاز التلفاز", `جارٍ الإرسال إلى ${FSI}جهاز التلفاز${PDI}`],
    ["ar", "Living Room TV", `جارٍ الإرسال إلى ${FSI}Living Room TV${PDI}`],
    ["en", "Living Room TV", "Casting to Living Room TV"],
    ["en", "جهاز التلفاز", `Casting to ${FSI}جهاز التلفاز${PDI}`],
    ["en", "הסלון", `Casting to ${FSI}הסלון${PDI}`],
  ] as const)("formats %s with the device %s", (tag, device, expected) => {
    const t = make(tag, CAST[tag])
    expect(t.translate("Cast.castingTo", { device })).toBe(expected)
  })

  // Every value is a string, so the type guard lets it through: only the
  // message walk keeps an argument that drives a select, plural, or number
  // unwrapped where it also appears as a plain `{arg}`.
  it.each([
    ["kind", { kind: "movie" }, "فيلم movie"],
    ["removal", { count: "3", title: "Jesus" }, `حذف 3 من ${FSI}Jesus${PDI}`],
    ["at", { count: "2", device: "TV" }, `2 ${FSI}TV${PDI} 2`],
  ])("wraps only the plain arguments of %s", (key, values, expected) => {
    expect(make("ar", AR).translate(`Cast.${key}`, values)).toBe(expected)
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

  // The padding is ceil(40%) of the literal characters, spaces included, and
  // counts the text in each plural branch.
  it.each([
    ["goBackAriaLabel", undefined, "[Ĝö ƀàçķ ~~~]"],
    ["greeting", { name: "Ana" }, "[Ĥéļļö, Ana ~~~]"],
    ["episodes", { count: 2 }, "[2 éþîšöðéš ~~~~~~~]"],
    ["apostrophe", undefined, "[Ðöñ'ţ šţöþ ~~~~]"],
  ])("accents, brackets, and pads %s", (key, values, expected) => {
    const t = make("en", translator.pseudoLocalizeMessages(SOURCE))
    expect(t.translate(`Common.${key}`, values)).toBe(expected)
  })
})
