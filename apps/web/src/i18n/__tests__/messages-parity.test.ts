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

describe("verified Turkmen subtitle labels", () => {
  it("uses Turkmen spelling and keeps the subtitle count ICU plural", () => {
    const turkmen = flattenCatalog("tk")

    expect(turkmen["LanguagePickerModal.subtitlesHeading"]).toBe("Subtitrler")
    expect(turkmen["HeroPlayer.subtitleCount"]).toBe(
      "Subtitrler: {count, plural, one {# dil} other {# dil}}",
    )
    expect(turkmen["LanguageInventory.subtitles"]).toBe("Subtitrler")
    expect(
      Object.values(turkmen).filter((value) => value.includes("ə")),
    ).toEqual([])
  })
})

function westernDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x0660),
  )
}

describe("Arabic count plurals", () => {
  // CLDR Arabic: 0 zero, 1 one, 2 two, 3-10 few, 11-99 many, 100-102 other.
  const counts = [0, 1, 2, 3, 11, 52, 100, 673] as const

  function formatArabic(key: string, values: Record<string, number>): string {
    const translate = createTranslator({
      locale: "ar",
      messages: loadCatalog("ar") as AbstractIntlMessages,
    }) as unknown as (key: string, values: Record<string, number>) => string
    return westernDigits(translate(key, values))
  }

  it("samples every Arabic CLDR plural category", () => {
    const rules = new Intl.PluralRules("ar")
    expect(counts.map((count) => rules.select(count))).toEqual([
      "zero",
      "one",
      "two",
      "few",
      "many",
      "many",
      "other",
      "many",
    ])
  })

  it.each([
    [
      "LanguageInventory.itemCount",
      [
        "0 عناصر",
        "1 عنصر",
        "2 عنصران",
        "3 عناصر",
        "11 عنصرًا",
        "52 عنصرًا",
        "100 عنصر",
        "673 عنصرًا",
      ],
    ],
    [
      "LanguageInventory.videoCount",
      [
        "0 فيديوهات",
        "1 فيديو",
        "2 فيديو",
        "3 فيديوهات",
        "11 فيديو",
        "52 فيديو",
        "100 فيديو",
        "673 فيديو",
      ],
    ],
    [
      "WatchLanguageIndex.languageCount",
      [
        "0 لغات",
        "1 لغة",
        "2 لغتان",
        "3 لغات",
        "11 لغةً",
        "52 لغةً",
        "100 لغة",
        "673 لغةً",
      ],
    ],
  ])("formats %s with the Arabic plural form for each count", (key, forms) => {
    expect(counts.map((count) => formatArabic(key, { count }))).toEqual(forms)
  })

  it("keeps the counted group noun grammatical after the preposition", () => {
    // After "في" the dual is genitive (مجموعتين); 11-99 keep the accusative
    // singular tamyiz (مجموعةً).
    expect(
      formatArabic("LanguageInventory.videosInGroups", {
        videoCount: 673,
        groupCount: 52,
      }),
    ).toBe("673 فيديو في 52 مجموعةً")
    expect(
      formatArabic("LanguageInventory.videosInGroups", {
        videoCount: 3,
        groupCount: 2,
      }),
    ).toBe("3 فيديوهات في 2 مجموعتين")
  })
})

describe("Watch catalog copy corrections", () => {
  const englishCatalogs = new Set(["en", ...provisionalLocales])

  it("does not leave the English phrase 'Jesus films' in translated language pages", () => {
    const leftovers = readdirSync(messagesDir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => file.slice(0, -5))
      .filter((locale) => !englishCatalogs.has(locale))
      .flatMap((locale) =>
        ["heroDescription", "metadataDescription"]
          .filter((key) =>
            /Jesus film/i.test(
              flattenCatalog(locale)[`LanguageInventory.${key}`] ?? "",
            ),
          )
          .map((key) => `${locale}:${key}`),
      )

    expect(leftovers).toEqual([])
  })

  it("spells Spanish 'video' without the Spain-only accent where English copy allows it", () => {
    // The two remaining accented messages would be byte-identical to English
    // without the accent ("Video", "# video/# videos"), which the
    // translated-copy gate below rejects. Aligning them needs a policy
    // decision on a per-locale neutral exemption, so they are pinned here.
    expect(
      Object.entries(flattenCatalog("es"))
        .filter(([, value]) => /vídeo/i.test(value))
        .map(([path]) => path)
        .sort(),
    ).toEqual(["LanguageInventory.videoCount", "VideoLabels.video"])
  })
})

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

function formattingValues(message: string): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const numericVariables = new Set(
    [
      ...message.matchAll(
        /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*(?:plural|selectordinal|number)\b/g,
      ),
    ].map((match) => match[1]),
  )
  for (const match of message.matchAll(
    /\{([A-Za-z][A-Za-z0-9_]*)\s*(?:,|\})/g,
  )) {
    values[match[1]] = numericVariables.has(match[1]) ? 2 : "Sample"
  }
  for (const match of message.matchAll(/<\/?([A-Za-z][A-Za-z0-9_]*)>/g)) {
    values[match[1]] = (chunks: unknown) => chunks
  }
  return values
}

function languagePickerMessages(locale: string): Record<string, string> {
  return loadCatalog(locale).LanguagePickerModal as Record<string, string>
}

describe("Spanish feedback catalog", () => {
  it("keeps the complete wizard translated despite other locales' pending paths", () => {
    const source = flattenCatalog(SOURCE_LOCALE)
    const spanish = flattenCatalog("es")
    const paths = Object.keys(source).filter((path) =>
      path.startsWith("Feedback."),
    )

    // “Idea” is the same word in Spanish and English. No other feedback UI
    // copy should silently return to the source while this namespace remains
    // pending globally for other locales.
    expect(paths.filter((path) => spanish[path] === source[path])).toEqual([
      "Feedback.categories.idea.label",
    ])

    const errors: unknown[] = []
    const translate = createTranslator({
      locale: "es",
      messages: loadCatalog("es") as AbstractIntlMessages,
      onError: (error) => errors.push(error),
    }) as (key: string, values?: Record<string, unknown>) => string
    for (const path of paths) {
      expect(messageVariables(spanish[path]), path).toEqual(
        messageVariables(source[path]),
      )
      expect(translate(path, formattingValues(source[path])), path).toBeTypeOf(
        "string",
      )
    }
    expect(errors).toEqual([])
    expect(
      translate("Feedback.steps.progressLabel", { step: 3, count: 5 }),
    ).toBe("Paso 3 de 5")
    expect(translate("Feedback.picker.selected", { role: "button" })).toBe(
      "Elemento seleccionado: button · elegir de nuevo",
    )
  })
})

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
          const formatted = translateRich(path, formattingValues(message))
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
