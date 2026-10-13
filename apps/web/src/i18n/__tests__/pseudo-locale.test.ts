import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTranslator, type AbstractIntlMessages } from "next-intl"
import { describe, expect, it, vi } from "vitest"
import {
  isPseudoLocaleEnabled,
  literalRuns,
  phrasesOnScreen,
  pseudoLocalize,
  pseudoLocalizeCatalog,
  untranslatedRemainder,
} from "../pseudo-locale"
import { icuSampleValues } from "./icu-sample-values"

vi.unmock("next-intl")

describe("pseudoLocalize — the transform itself", () => {
  it("wraps plain literal text in brackets", () => {
    expect(pseudoLocalize("Download")).toMatch(/^\[\[.*\]\]$/)
  })

  it("leaves a placeholder untouched but brackets the surrounding text", () => {
    const result = pseudoLocalize("Hello {name}, welcome")
    expect(result).toContain("{name}")
    expect(result.replace("{name}", "")).toMatch(/^\[\[.*\]\]\[\[.*\]\]$/)
  })

  it("keeps a plural block's grammar but transforms the words in each body", () => {
    const result = pseudoLocalize(
      "{count, plural, one {# item} other {# items}}",
    )
    // Head, selectors and `#` stay exactly as written; only the words move.
    expect(result).toMatch(
      /^\{count, plural, one \{\[\[# .+\]\]\} other \{\[\[# .+\]\]\}\}$/,
    )
    expect(result).not.toContain("# item}")
  })

  it("keeps =N selectors, offsets and nested blocks, transforming every body", () => {
    const source =
      "{count, plural, offset:1 =0 {Nobody} other {{gender, select, female {She} other {They}} and # more}}"
    const result = pseudoLocalize(source)
    expect(result).toContain("{count, plural, offset:1 =0 {[[")
    expect(result).toContain("{gender, select, female {[[")
    expect(result).not.toMatch(/\{Nobody\}|\{She\}|\{They\}| and # more/)
  })

  it("leaves a plain placeholder and a number format untouched", () => {
    expect(pseudoLocalize("{count, number}")).toBe("{count, number}")
    expect(pseudoLocalize("{name}")).toBe("{name}")
  })

  it("leaves rich-text tags untouched but transforms the text between them", () => {
    const result = pseudoLocalize("<b>Important</b> notice")
    // Tags themselves are literal, unbracketed markup; the transformed text
    // sits between/after them, each run bracketed on its own.
    expect(result).toMatch(/^<b>\[\[.*\]\]<\/b>\[\[.*\]\]$/)
  })

  it("expands literal text length by roughly the target ratio", () => {
    const source = "Download"
    const result = pseudoLocalize(source)
    const innerLength = result.replace(/^\[\[|\]\]$/g, "").length
    expect(innerLength).toBeGreaterThan(source.length)
    expect(innerLength).toBeLessThan(source.length * 1.6)
  })

  it("substitutes accented lookalikes into the literal text", () => {
    const result = pseudoLocalize("Download")
    // At least one plain a/e/i/o/u should have become its accented form.
    expect(/[áéíóú]/i.test(result)).toBe(true)
  })

  it("does not bracket a whitespace-only run between two placeholders", () => {
    const result = pseudoLocalize("{a} {b}")
    expect(result).toBe("{a} {b}")
  })

  it("makes a hardcoded English fragment concatenated onto translated text visually obvious", () => {
    // Simulates forge#M37/N50's shape: a translated prefix with a literal
    // English suffix appended outside the translation system (represented
    // here as plain, un-pseudo-localized text glued onto a pseudo-localized
    // prefix) — the point of per-segment bracketing is that this reads as
    // an obvious seam, not a uniform pseudo-localized string.
    const translatedPrefix = pseudoLocalize("I agree to the ")
    const hardcodedSuffix = " Terms of Use" // never passed through pseudoLocalize
    const concatenated = translatedPrefix + hardcodedSuffix
    expect(concatenated).toMatch(/\]\] Terms of Use$/)
  })
})

describe("isPseudoLocaleEnabled — never for visitors", () => {
  it("is on only in a Playwright run of a non-production build", () => {
    expect(
      isPseudoLocaleEnabled({ NODE_ENV: "development", PLAYWRIGHT_TEST: "1" }),
    ).toBe(true)
  })

  it("is off in production even when the test flag is set", () => {
    expect(
      isPseudoLocaleEnabled({ NODE_ENV: "production", PLAYWRIGHT_TEST: "1" }),
    ).toBe(false)
  })

  it("is off outside a Playwright run", () => {
    expect(isPseudoLocaleEnabled({ NODE_ENV: "development" })).toBe(false)
    expect(
      isPseudoLocaleEnabled({ NODE_ENV: "test", PLAYWRIGHT_TEST: "0" }),
    ).toBe(false)
  })
})

describe("pseudoLocalizeCatalog — real English source catalog round-trip", () => {
  const sourceCatalogPath = join(__dirname, "../../../messages/en.json")
  const sourceCatalog = JSON.parse(readFileSync(sourceCatalogPath, "utf-8"))
  const pseudoCatalog = pseudoLocalizeCatalog(sourceCatalog)

  it("formats every real message in the English catalog without ICU errors once pseudo-localized", () => {
    const errors: string[] = []
    let activePath = ""
    const translate = createTranslator({
      locale: "en",
      messages: pseudoCatalog as AbstractIntlMessages,
      onError(error) {
        errors.push(`${activePath}: ${error.code}: ${error.message}`)
      },
    })
    const translateRich = translate.rich as unknown as (
      key: string,
      values: Record<string, unknown>,
    ) => unknown

    function visit(value: unknown, path: string[]): void {
      if (typeof value === "string") {
        activePath = path.join(".")
        try {
          translateRich(activePath, icuSampleValues(value))
        } catch (error) {
          errors.push(
            `${activePath}: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        return
      }
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        visit(child, [...path, key])
      }
    }
    visit(sourceCatalog, [])

    expect(errors).toEqual([])
  })

  it("preserves every placeholder name exactly across the whole real catalog", () => {
    function flatten(
      value: unknown,
      path: string[],
      out: Record<string, string>,
    ): void {
      if (typeof value === "string") {
        out[path.join(".")] = value
        return
      }
      for (const [key, child] of Object.entries(
        value as Record<string, unknown>,
      )) {
        flatten(child, [...path, key], out)
      }
    }
    const sourceFlat: Record<string, string> = {}
    const pseudoFlat: Record<string, string> = {}
    flatten(sourceCatalog, [], sourceFlat)
    flatten(pseudoCatalog, [], pseudoFlat)

    const placeholderNames = (message: string) =>
      [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)/g)]
        .map((m) => m[1])
        .sort()

    const mismatches: string[] = []
    for (const [path, sourceMessage] of Object.entries(sourceFlat)) {
      const sourceNames = placeholderNames(sourceMessage)
      const pseudoNames = placeholderNames(pseudoFlat[path])
      if (JSON.stringify(sourceNames) !== JSON.stringify(pseudoNames)) {
        mismatches.push(`${path}: source=${sourceNames}, pseudo=${pseudoNames}`)
      }
    }

    expect(mismatches).toEqual([])
  })
})

describe("untranslatedRemainder — text that skipped the catalogs", () => {
  it("accepts bracketed catalog text and known content", () => {
    expect(
      untranslatedRemainder("[[Šhárééé vídéóóó]] Dialog fixture video title", [
        "Dialog fixture video title",
      ]),
    ).toBeNull()
  })

  it("reports English sitting next to catalog text", () => {
    expect(
      untranslatedRemainder("[[ÍÍ ágréééé tóó théé ]] Terms of Use", []),
    ).toBe("Terms of Use")
  })

  it("matches content case-insensitively, since CSS can uppercase it", () => {
    expect(untranslatedRemainder("EN · ENGLISH", ["en", "English"])).toBeNull()
  })

  it("removes content only as whole words, never from inside a real word", () => {
    expect(
      untranslatedRemainder("Hardcoded English label", ["ar", "en", "English"]),
    ).toBe("Hardcoded label")
  })

  it("ignores numbers, punctuation and single letters", () => {
    expect(untranslatedRemainder("1 / 5 · 32:05 — x", [])).toBeNull()
  })
})

describe("phrasesOnScreen — how much of the catalog a page shows", () => {
  const catalog = pseudoLocalizeCatalog({
    Download: { title: "Download video", close: "Close" },
    Picker: { count: "{count, plural, one {# language} other {# languages}}" },
    Only: { placeholder: "{name}" },
  })

  it("counts a message once any of its runs is on screen, ignoring case", () => {
    const rendered = `${pseudoLocalize("Download video").toUpperCase()} elsewhere`
    expect(phrasesOnScreen(catalog, rendered)).toEqual({
      shown: ["Download.title"],
      total: 3,
    })
  })

  it("matches a plural body with the number ICU substituted for #", () => {
    const rendered = pseudoLocalize("{count, plural, other {# languages}}")
      .replace(/^\{count, plural, other \{/, "")
      .replace(/\}\}$/, "")
      .replace("#", "12")
    expect(phrasesOnScreen(catalog, rendered).shown).toEqual(["Picker.count"])
  })

  it("leaves messages without words out of the total", () => {
    expect(phrasesOnScreen(catalog, "").total).toBe(3)
  })
})

describe("literalRuns — the words a message puts on screen", () => {
  it("keeps literal text, drops placeholders and tags", () => {
    expect(literalRuns("Hello {name}, <b>welcome</b> back")).toEqual(
      ["Hello", ", ", "welcome", "back"]
        .map((run) => run.trim())
        .filter(Boolean),
    )
  })

  it("reads inside plural bodies and splits where the number goes", () => {
    expect(
      literalRuns("{count, plural, one {# video} other {# videos found}}"),
    ).toEqual(["video", "videos found"])
  })

  it("returns nothing for a message that is only a placeholder", () => {
    expect(literalRuns("{name}")).toEqual([])
  })
})
