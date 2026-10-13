import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { createTranslator, type AbstractIntlMessages } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import {
  AVAILABLE_UI_LOCALES,
  DEFAULT_LOCALE,
  hasUiLocale,
} from "@/i18n/generated-ui-locales"
import { isSourceEquivalent } from "../../../scripts/openai-catalog-translator.mjs"
import { findPluralCategoryGaps, pluralGapKey } from "../plural-category-gaps"
import { icuSampleValues } from "./icu-sample-values"

vi.unmock("next-intl")

// Structural-parity gate: every key in messages/en.json must exist in
// every other locale catalog. Locales can ship later than en (a
// translator hasn't finished) but missing keys produce per-key fallback
// to English at runtime — surface the gap at CI time rather than as a
// silent mixed-locale UI.

const messagesDir = join(__dirname, "../../../messages")
const SOURCE_LOCALE = "en"
const provisionalLocales = new Set<string>(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        "../../../../../docs/i18n/watch-ui-provisional-catalogs.json",
      ),
      "utf-8",
    ),
  ).provisionalLocales,
)
const translationPolicy = JSON.parse(
  readFileSync(
    join(__dirname, "../../../scripts/ui-translation-policy.json"),
    "utf-8",
  ),
) as {
  intentionallyLocaleNeutral: string[]
  pendingTranslationPaths: string[]
}
const LANGUAGE_PICKER_KEYS = [
  "seeAllLanguages",
  "seeAllVideosInLanguage",
  "retryLoadingLanguages",
  "notAvailable",
  "switching",
] as const
const MAXIMUM_NORMALIZED_SOURCE_COPY_RATIO = 0.05

type MessageTree = {
  [key: string]: string | MessageTree
}

const catalogCache = new Map<string, MessageTree>()
const flattenedCatalogCache = new Map<string, Record<string, string>>()

function loadCatalog(locale: string): MessageTree {
  const cached = catalogCache.get(locale)
  if (cached != null) return cached

  const raw = readFileSync(join(messagesDir, `${locale}.json`), "utf-8")
  const catalog = JSON.parse(raw) as MessageTree
  catalogCache.set(locale, catalog)
  return catalog
}

function flattenCatalog(locale: string): Record<string, string> {
  const cached = flattenedCatalogCache.get(locale)
  if (cached != null) return cached

  const flattened: Record<string, string> = {}

  function visit(value: string | MessageTree, path: string[]): void {
    if (typeof value === "string") {
      flattened[path.join(".")] = value
      return
    }
    for (const [key, child] of Object.entries(value)) {
      visit(child, [...path, key])
    }
  }

  visit(loadCatalog(locale), [])
  flattenedCatalogCache.set(locale, flattened)
  return flattened
}

function placeholders(message: string): string[] {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)/g)]
    .map((match) => match[1])
    .sort()
}

function messageVariables(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\s*(?:,|\})/g)].map(
      (match) => match[1],
    ),
  )
}

function richTextTags(message: string): Set<string> {
  return new Set(
    [...message.matchAll(/<\/?([A-Za-z][A-Za-z0-9_]*)>/g)].map(
      (match) => match[1],
    ),
  )
}

function pluralAndSelectOperations(message: string): Set<string> {
  return new Set(
    [
      ...message.matchAll(
        /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*(plural|selectordinal|select)\b/g,
      ),
    ].map((match) => `${match[2]}:${match[1]}`),
  )
}

function sameSet(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

function languagePickerMessages(locale: string): Record<string, string> {
  return loadCatalog(locale).LanguagePickerModal as Record<string, string>
}

describe("messages catalogs — structural parity", () => {
  const source = flattenCatalog(SOURCE_LOCALE)
  const sourceKeys = Object.keys(source).sort()
  const sourceKeySet = new Set(sourceKeys)
  const otherLocales = readdirSync(messagesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .filter((l) => l !== SOURCE_LOCALE)

  it.each(otherLocales)("%s.json contains every key from en.json", (locale) => {
    const localeKeys = Object.keys(flattenCatalog(locale))
    const localeKeySet = new Set(localeKeys)
    const missing = sourceKeys.filter((key) => !localeKeySet.has(key))
    const unexpected = localeKeys.filter((key) => !sourceKeySet.has(key))
    expect({ missing, unexpected }).toEqual({ missing: [], unexpected: [] })
  })

  it.each(LANGUAGE_PICKER_KEYS)(
    "LanguagePickerModal.%s exists everywhere with source placeholder parity",
    (key) => {
      const sourceMessage = source[`LanguagePickerModal.${key}`]
      expect(sourceMessage).toBeTypeOf("string")

      for (const locale of otherLocales) {
        const message = flattenCatalog(locale)[`LanguagePickerModal.${key}`]
        expect(message, `${locale}.LanguagePickerModal.${key}`).toBeTypeOf(
          "string",
        )
        expect(
          placeholders(message),
          `${locale}.LanguagePickerModal.${key}`,
        ).toEqual(placeholders(sourceMessage))
      }
    },
  )
})

describe("non-English catalogs — translated-copy gate", () => {
  it("does not retain non-neutral English source strings", () => {
    const source = flattenCatalog(SOURCE_LOCALE)
    const intentionallyLocaleNeutral = new Set(
      translationPolicy.intentionallyLocaleNeutral,
    )
    const pendingTranslationPaths = new Set(
      translationPolicy.pendingTranslationPaths,
    )
    const translatablePaths = Object.keys(source).filter(
      (path) =>
        !intentionallyLocaleNeutral.has(path) &&
        !pendingTranslationPaths.has(path),
    )
    const sourceCopies = readdirSync(messagesDir)
      .filter((file) => file.endsWith(".json") && file !== "en.json")
      .map((file) => file.slice(0, -5))
      .filter((locale) => !provisionalLocales.has(locale))
      .flatMap((locale) => {
        const catalog = flattenCatalog(locale)
        const exactCopies = translatablePaths.filter(
          (path) => catalog[path] === source[path],
        )
        const normalizedCopies = translatablePaths.filter(
          (path) =>
            catalog[path] !== source[path] &&
            isSourceEquivalent(source[path], catalog[path]),
        )
        const maximumNormalizedCopies = Math.floor(
          translatablePaths.length * MAXIMUM_NORMALIZED_SOURCE_COPY_RATIO,
        )
        return exactCopies.length > 0 ||
          normalizedCopies.length > maximumNormalizedCopies
          ? [
              `${locale}: exact=${exactCopies.join(", ") || "none"}; normalized=${normalizedCopies.join(", ") || "none"}; maximumNormalized=${maximumNormalizedCopies}`,
            ]
          : []
      })

    expect(sourceCopies).toEqual([])
  })

  it.each(
    readdirSync(messagesDir)
      .filter((file) => file.endsWith(".json") && file !== "en.json")
      .map((file) => file.slice(0, -5)),
  )(
    "formats every %s LanguagePickerModal message without ICU errors",
    (locale) => {
      const errors: unknown[] = []
      const translate = createTranslator({
        locale,
        messages: loadCatalog(locale) as AbstractIntlMessages,
        namespace: "LanguagePickerModal",
        onError: (error) => errors.push(error),
      }) as (key: string, values?: Record<string, string | number>) => string
      const sourceMessages = languagePickerMessages(SOURCE_LOCALE)

      for (const [key, sourceMessage] of Object.entries(sourceMessages)) {
        const formatted = translate(key, {
          count: 2,
          language: "__LANGUAGE__",
        })
        expect(formatted, `${locale}.LanguagePickerModal.${key}`).toBeTypeOf(
          "string",
        )
        if (sourceMessage.includes("{language}")) {
          expect(formatted, `${locale}.LanguagePickerModal.${key}`).toContain(
            "__LANGUAGE__",
          )
        }
      }

      expect(errors, locale).toEqual([])
      expect(translate("languageCount", { count: 1 }), locale).not.toBe(
        translate("languageCount", { count: 2 }),
      )
    },
  )
})

describe("messages catalogs — ICU and rich-text syntax", () => {
  it("preserves English variable, rich-tag, and plural/select contracts", () => {
    const source = flattenCatalog(SOURCE_LOCALE)
    const contractErrors: string[] = []
    const locales = readdirSync(messagesDir)
      .filter((file) => file.endsWith(".json") && file !== "en.json")
      .map((file) => file.slice(0, -5))

    for (const locale of locales) {
      const catalog = flattenCatalog(locale)
      for (const [path, sourceMessage] of Object.entries(source)) {
        const translatedMessage = catalog[path]
        if (translatedMessage == null) continue

        const contracts = [
          [
            "variables",
            messageVariables(sourceMessage),
            messageVariables(translatedMessage),
          ],
          [
            "rich tags",
            richTextTags(sourceMessage),
            richTextTags(translatedMessage),
          ],
          [
            "plural/select operations",
            pluralAndSelectOperations(sourceMessage),
            pluralAndSelectOperations(translatedMessage),
          ],
        ] as const

        for (const [label, expected, actual] of contracts) {
          if (!sameSet(expected, actual)) {
            contractErrors.push(
              `${locale}:${path}: ${label}; expected=${JSON.stringify([...expected].sort())}; actual=${JSON.stringify([...actual].sort())}`,
            )
          }
        }
      }
    }

    expect(contractErrors).toEqual([])
  })

  it("formats every translated message without parser errors", () => {
    const errors: string[] = []
    const locales = readdirSync(messagesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))

    for (const locale of locales) {
      const catalog = loadCatalog(locale)
      let activePath = ""
      const translate = createTranslator({
        locale,
        messages: catalog as AbstractIntlMessages,
        onError(error) {
          errors.push(
            `${locale}:${activePath}: ${error.code}: ${error.message}`,
          )
        },
      })
      const translateRich = translate.rich as unknown as (
        key: string,
        values: Record<string, unknown>,
      ) => unknown

      for (const [path, message] of Object.entries(flattenCatalog(locale))) {
        activePath = path
        try {
          const formatted = translateRich(path, icuSampleValues(message))
          if (
            typeof formatted === "string" &&
            /\{[A-Za-z][^{}]*,\s*(?:plural|selectordinal|select)\b/.test(
              formatted,
            )
          ) {
            errors.push(`${locale}:${path}: unexpanded ICU expression`)
          }
        } catch (error) {
          errors.push(
            `${locale}:${path}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }

    expect(errors).toEqual([])
  }, 15_000)
})

/**
 * Plural-category completeness against each locale's own CLDR rules (the
 * forge#N33 class — see src/i18n/plural-category-gaps.ts for why next-intl's
 * silent `other` fallback lets these ship). A tracked pre-existing backlog
 * lives in docs/i18n/watch-ui-plural-category-gaps.json; failing CI on all
 * of it at once would block every unrelated PR over a translation backlog,
 * not a regression. The check is a ratchet in both directions:
 *  - a gap NOT in the backlog fails (a new plural block, a new locale, or a
 *    category regressing), and
 *  - a backlog entry that is already fixed fails too, so fixed gaps can't
 *    stay silently allowlisted and later regress unnoticed.
 * Regenerate the backlog with scripts/generate-plural-category-gaps.ts.
 */
const knownPluralGaps = JSON.parse(
  readFileSync(
    join(
      __dirname,
      "../../../../../docs/i18n/watch-ui-plural-category-gaps.json",
    ),
    "utf-8",
  ),
).knownGaps as Record<string, Record<string, string[]>>

describe("messages catalogs — CLDR plural-category completeness (ratchet)", () => {
  const locales = readdirSync(messagesDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -5))

  it.each(locales)(
    "%s has no plural-category gap beyond the tracked backlog",
    (locale) => {
      const gaps = findPluralCategoryGaps(locale, loadCatalog(locale))
      if (gaps == null) return // Intl.PluralRules can't resolve this tag
      const known = knownPluralGaps[locale] ?? {}

      const unexpected = gaps.flatMap((gap) => {
        const tracked = known[pluralGapKey(gap.path, gap.variable)] ?? []
        const newlyMissing = gap.missing.filter((c) => !tracked.includes(c))
        return newlyMissing.length > 0
          ? [
              `${gap.path} ({${gap.variable}, plural, ...}) is missing: ${newlyMissing.join(", ")}`,
            ]
          : []
      })

      expect(unexpected).toEqual([])
    },
  )

  it.each(Object.keys(knownPluralGaps))(
    "%s backlog entries are all still real gaps (remove fixed ones)",
    (locale) => {
      expect(
        locales.includes(locale),
        `${locale} is in the backlog but has no catalog`,
      ).toBe(true)
      const gaps = findPluralCategoryGaps(locale, loadCatalog(locale)) ?? []
      const actual = new Map(
        gaps.map((gap) => [pluralGapKey(gap.path, gap.variable), gap.missing]),
      )

      const stale = Object.entries(knownPluralGaps[locale]).flatMap(
        ([key, tracked]) => {
          const stillMissing = actual.get(key) ?? []
          const fixed = tracked.filter((c) => !stillMissing.includes(c))
          return fixed.length > 0
            ? [
                `${key}: ${fixed.join(", ")} now defined — regenerate docs/i18n/watch-ui-plural-category-gaps.json`,
              ]
            : []
        },
      )

      expect(stale).toEqual([])
    },
  )
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
