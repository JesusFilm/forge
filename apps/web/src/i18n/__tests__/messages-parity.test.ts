import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { AVAILABLE_UI_LOCALES, hasUiLocale } from "@/i18n/locales"
import { UI_LOCALE_FAMILIES, isLocale } from "@/lib/locale"

// Structural-parity gate: every key in messages/en.json must exist in
// every other locale catalog. Locales can ship later than en (a
// translator hasn't finished) but missing keys produce per-key fallback
// to English at runtime — surface the gap at CI time rather than as a
// silent mixed-locale UI.

const messagesDir = join(__dirname, "../../../messages")
const SOURCE_LOCALE = "en"

type Messages = Record<string, Record<string, string>>

function loadCatalog(locale: string): Messages {
  const raw = readFileSync(join(messagesDir, `${locale}.json`), "utf-8")
  return JSON.parse(raw) as Messages
}

function flatten(messages: Messages): string[] {
  return Object.entries(messages)
    .flatMap(([ns, keys]) => Object.keys(keys).map((k) => `${ns}.${k}`))
    .sort()
}

describe("messages catalogs — structural parity", () => {
  const sourceKeys = flatten(loadCatalog(SOURCE_LOCALE))
  const otherLocales = readdirSync(messagesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((l) => l !== SOURCE_LOCALE)

  it.each(otherLocales)("%s.json contains every key from en.json", (locale) => {
    const localeKeys = flatten(loadCatalog(locale))
    const missing = sourceKeys.filter((k) => !localeKeys.includes(k))
    expect(missing).toEqual([])
  })
})

// Drift gate between the two parallel sources of truth:
//   - UI_LOCALE_FAMILIES (lib/locale.ts) — static narrowing tuple driving
//     isLocale + resolveUiLocale
//   - AVAILABLE_UI_LOCALES (i18n/locales.ts) — filesystem-derived catalog list
// Dropping a messages/{locale}.json without editing the tuple (or vice
// versa) breaks the runtime invariant where bcp47 narrowing and catalog
// availability disagree → silent English-fallback for a "supported"
// locale. This test fails the build at that exact moment.
describe("UI locale families ↔ filesystem catalogs — drift gate", () => {
  it("every static UI_LOCALE_FAMILIES entry has a corresponding catalog", () => {
    const missingCatalogs = UI_LOCALE_FAMILIES.filter((l) => !hasUiLocale(l))
    expect(missingCatalogs).toEqual([])
  })

  it("every catalog locale is also a recognized UI_LOCALE_FAMILIES entry", () => {
    const unknownNarrowing = AVAILABLE_UI_LOCALES.filter((l) => !isLocale(l))
    expect(unknownNarrowing).toEqual([])
  })
})
