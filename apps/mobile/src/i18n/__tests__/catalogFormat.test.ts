// Every catalog message keeps the English placeholders, tags, and plurals, and
// formats with use-intl, the engine the app uses (R13).
import { createTranslator, type AbstractIntlMessages } from "use-intl/core"

import {
  contractProblems,
  describeProblem,
  readCatalogDir,
  REAL_PATHS,
} from "../../../scripts/i18n/lib/catalogChecks"
import {
  unflattenCatalog,
  type FlatCatalog,
} from "../../../scripts/i18n/lib/catalogOps"

type RichTranslate = (key: string, values: Record<string, unknown>) => unknown

function formattingValues(message: string): Record<string, unknown> {
  const numeric = new Set(
    [
      ...message.matchAll(
        /\{([A-Za-z][A-Za-z0-9_]*)\s*,\s*(?:plural|selectordinal|number)\b/g,
      ),
    ].map((match) => match[1]),
  )
  const values: Record<string, unknown> = {}
  for (const match of message.matchAll(
    /\{([A-Za-z][A-Za-z0-9_]*)\s*(?:,|\})/g,
  )) {
    values[match[1]] = numeric.has(match[1]) ? 2 : "Sample"
  }
  for (const match of message.matchAll(/<\/?([A-Za-z][A-Za-z0-9_]*)>/g)) {
    values[match[1]] = (chunks: unknown) => chunks
  }
  return values
}

function formatErrors(locale: string, flat: FlatCatalog): string[] {
  const errors: string[] = []
  let active = ""
  const translate = createTranslator({
    locale,
    messages: unflattenCatalog(flat) as AbstractIntlMessages,
    onError: (error) => {
      errors.push(`${locale}: ${active}: ${error.code}: ${error.message}`)
    },
  })
  const rich = translate.rich as unknown as RichTranslate
  for (const [key, message] of Object.entries(flat)) {
    active = key
    try {
      const output = rich(key, formattingValues(message))
      if (
        typeof output === "string" &&
        /\{[A-Za-z][^{}]*,\s*(?:plural|selectordinal|select)\b/.test(output)
      ) {
        errors.push(`${locale}: ${key}: unexpanded ICU expression`)
      }
    } catch (error) {
      errors.push(`${locale}: ${key}: ${String(error)}`)
    }
  }
  return errors
}

describe("the real catalogs", () => {
  const { source, catalogs } = readCatalogDir(REAL_PATHS.messagesDir)

  it("keep every English placeholder, tag, plural, and select", () => {
    expect(contractProblems(source, catalogs).map(describeProblem)).toEqual([])
  })

  it("format every message without an error", () => {
    const errors = [
      ...formatErrors("en", source),
      ...Object.entries(catalogs).flatMap(([locale, flat]) =>
        formatErrors(locale, flat),
      ),
    ]
    expect(errors).toEqual([])
  })
})

describe("the format checks", () => {
  const source = {
    "Common.count": "{count, plural, one {# video} other {# videos}}",
    "Common.title": "Watch {title}",
  }

  it("fail a message that drops {count}, and name the locale and the key", () => {
    const problems = contractProblems(source, {
      es: { "Common.title": "Ver {titulo}" },
    })
    expect(problems.map(describeProblem)).toEqual([
      "es: ICU variable mismatch: Common.title",
    ])
  })

  it("fail a plural that drops #", () => {
    const problems = contractProblems(source, {
      es: { "Common.count": "{count, plural, one {un vídeo} other {vídeos}}" },
    })
    expect(problems.map(describeProblem)).toEqual([
      "es: Plural substitution marker missing: Common.count",
    ])
  })

  it("fail a plural that becomes a select", () => {
    const problems = contractProblems(source, {
      es: { "Common.count": "{count, select, other {# vídeos}}" },
    })
    expect(problems.map(describeProblem)).toEqual([
      "es: Plural or select mismatch: Common.count; expected plural:count; found select:count",
    ])
  })

  it("fail a message that does not format", () => {
    expect(
      formatErrors("es", { "Common.count": "{count, plural, one {# vídeo}}" }),
    ).toEqual([expect.stringMatching(/^es: Common\.count: /)])
  })

  it("pass a correct translation", () => {
    const es = {
      "Common.count": "{count, plural, one {# vídeo} other {# vídeos}}",
      "Common.title": "Ver {title}",
    }
    expect(contractProblems(source, { es })).toEqual([])
    expect(formatErrors("es", es)).toEqual([])
  })
})
