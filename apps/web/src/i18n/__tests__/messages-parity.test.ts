import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  AVAILABLE_UI_LOCALES,
  DEFAULT_LOCALE,
  hasUiLocale,
} from "@/i18n/generated-ui-locales"

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

describe("generated UI locale list ↔ filesystem catalogs — drift gate", () => {
  const filesystemLocales = readdirSync(messagesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort((a, b) => a.localeCompare(b))

  it("matches the generated edge-safe catalog module", () => {
    expect([...AVAILABLE_UI_LOCALES]).toEqual(filesystemLocales)
  })

  it("keeps the default locale present and guarded", () => {
    expect(DEFAULT_LOCALE).toBe(SOURCE_LOCALE)
    expect(hasUiLocale(DEFAULT_LOCALE)).toBe(true)
    expect(hasUiLocale("russian")).toBe(false)
  })
})
