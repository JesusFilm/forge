import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { createTranslator, type AbstractIntlMessages } from "next-intl"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createCountTranslator,
  formatCount,
  hasCountNumberFormatSpec,
} from "./count-format"
import { AVAILABLE_UI_LOCALES } from "./generated-ui-locales"

const messagesDir = join(__dirname, "../../messages")

function catalog(locale: string): AbstractIntlMessages {
  return JSON.parse(
    readFileSync(join(messagesDir, `${locale}.json`), "utf8"),
  ) as AbstractIntlMessages
}

// A browser-like `Intl.NumberFormat`. Chromium's trimmed ICU has number data
// for only part of the Watch UI locales (measured on Chromium 152: no Tswana,
// Ewe, Kyrgyz, Georgian, Burmese, ...); for the rest it silently formats in
// the visitor's own browser locale. "de" stands in for that visitor here, and
// the supported set is a small sample of locales Chromium does ship.
const BROWSER_NUMBER_LOCALES = new Set(["en", "fr", "ru", "ar", "zh", "es"])
const NativeNumberFormat = Intl.NumberFormat

function installBrowserLikeNumberFormat() {
  vi.spyOn(Intl, "NumberFormat").mockImplementation(((
    locales?: string | string[],
    options?: Intl.NumberFormatOptions,
  ) => {
    const requested = [locales ?? []].flat()
    const supported = requested.filter((locale) =>
      BROWSER_NUMBER_LOCALES.has(locale.split("-")[0] ?? ""),
    )
    return new NativeNumberFormat(
      supported.length > 0 ? supported : "de",
      options,
    )
  }) as unknown as typeof Intl.NumberFormat)
}

afterEach(() => {
  vi.restoreAllMocks()
})

function languageCount(
  locale: string,
  count: number,
  translator: "count" | "plain",
): string {
  const messages = catalog(locale)
  if (translator === "count") {
    return createCountTranslator({
      locale,
      messages,
      namespace: "LanguagePickerModal",
    })("languageCount", { count })
  }
  const translate = createTranslator({
    locale,
    messages,
    namespace: "LanguagePickerModal",
  }) as unknown as (key: string, values: { count: number }) => string
  return translate("languageCount", { count })
}

describe("createCountTranslator", () => {
  it("renders the Tswana language count the same on the server and in a browser without Tswana number data", () => {
    const server = languageCount("tn", 2273, "count")
    installBrowserLikeNumberFormat()
    const browser = languageCount("tn", 2273, "count")

    expect(server).toBe("maleme a 2'273")
    expect(browser).toBe(server)
  })

  it("would diverge with the runtime formatter (the N17 seam this guards)", () => {
    const server = languageCount("tn", 2273, "plain")
    installBrowserLikeNumberFormat()
    const browser = languageCount("tn", 2273, "plain")

    expect(server).toBe("maleme a 2'273")
    expect(browser).toBe("maleme a 2.273")
  })

  it("keeps every UI catalog's language count stable across server and browser ICU", () => {
    const locales = readdirSync(messagesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
    const counts = [0, 1, 2, 21, 1000, 2273, 12345]
    const server = new Map(
      locales.map((locale) => [
        locale,
        counts.map((count) => languageCount(locale, count, "count")),
      ]),
    )
    installBrowserLikeNumberFormat()
    for (const locale of locales) {
      expect(
        counts.map((count) => languageCount(locale, count, "count")),
        locale,
      ).toEqual(server.get(locale))
    }
  })

  it("keeps the UI locale's own plural rules", () => {
    const translate = createCountTranslator({
      locale: "ru",
      messages: {
        Test: {
          count:
            "{count, plural, one {# язык} few {# языка} many {# языков} other {# языка}}",
        },
      },
      namespace: "Test",
    })

    expect(translate("count", { count: 21 })).toBe("21 язык")
    expect(translate("count", { count: 2273 })).toBe("2 273 языка")
    expect(translate("count", { count: 2275 })).toBe("2 275 языков")
  })
})

describe("formatCount", () => {
  it.each([
    ["tn", 2273, "2'273"],
    ["ee", 2273, "2273"],
    ["ee", 12273, "12273"],
    ["ee", 123456, "123,456"],
    ["es", 2273, "2273"],
    ["de", 2273, "2.273"],
    ["fr", 2273, "2 273"],
    ["kk", 2273, "2 273"],
    ["hi", 1234567, "12,34,567"],
    ["as", 2273, "২,২৭৩"],
    ["fa", 2273, "۲٬۲۷۳"],
    ["en", 0, "0"],
    ["en", 1234567, "1,234,567"],
  ])("formats %s %i as %s", (locale, count, expected) => {
    expect(formatCount(count, locale)).toBe(expected)
  })

  it("uses the explicit English fallback for a locale with no entry, not the runtime default", () => {
    installBrowserLikeNumberFormat()

    expect(hasCountNumberFormatSpec("xx-unknown")).toBe(false)
    expect(formatCount(2273, "xx-unknown")).toBe("2,273")
  })

  it("has an entry for every UI locale catalog", () => {
    expect(
      AVAILABLE_UI_LOCALES.filter(
        (locale) => !hasCountNumberFormatSpec(locale),
      ),
    ).toEqual([])
  })
})
