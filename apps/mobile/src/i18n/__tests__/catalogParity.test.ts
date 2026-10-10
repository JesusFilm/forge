// Key parity between messages/en.json and every other catalog (R16, AE7).
// The real catalogs run first; the fixtures prove that each failure is caught
// and named by locale and key.
import {
  describeProblem,
  parityProblems,
  readCatalogDir,
  readPolicy,
  REAL_PATHS,
  untranslatedProblems,
} from "../../../scripts/i18n/lib/catalogChecks"
import type { TranslationPolicy } from "../../../scripts/i18n/lib/catalogOps"

const policy = (over: Partial<TranslationPolicy> = {}): TranslationPolicy => ({
  humanReviewedLocales: ["en"],
  intentionallyLocaleNeutral: [],
  englishOnlyLocales: ["crk"],
  pendingKeys: {},
  ...over,
})

describe("the real catalogs", () => {
  const { source, catalogs } = readCatalogDir(REAL_PATHS.messagesDir)
  const realPolicy = readPolicy(REAL_PATHS.policy)

  it("have exactly the keys of en.json", () => {
    expect(parityProblems(source, catalogs).map(describeProblem)).toEqual([])
  })

  it("show English only for a pending, locale-neutral, or English-only key", () => {
    expect(
      untranslatedProblems(source, catalogs, realPolicy).map(describeProblem),
    ).toEqual([])
  })
})

describe("the parity check", () => {
  const source = { "Common.back": "Go back", "Common.new": "New" }

  it("fails a key that en.json has and a locale lacks, and names both (AE7)", () => {
    const problems = parityProblems(source, {
      es: { "Common.back": "Volver" },
      fr: { "Common.back": "Retour", "Common.new": "Nouveau" },
    })
    expect(problems).toEqual([
      { locale: "es", key: "Common.new", kind: "missing" },
    ])
    expect(describeProblem(problems[0])).toMatch(/^es: Common\.new is missing/)
  })

  it("passes a pending key that holds the English in every locale (AE7)", () => {
    const catalogs = {
      es: { "Common.back": "Volver", "Common.new": "New" },
      fr: { "Common.back": "Retour", "Common.new": "New" },
    }
    const pending = policy({ pendingKeys: { "Common.new": "2026-09-29" } })
    expect(parityProblems(source, catalogs)).toEqual([])
    expect(untranslatedProblems(source, catalogs, pending)).toEqual([])
  })

  it("fails a key that a locale keeps after en.json removed it", () => {
    expect(
      parityProblems(
        { "Common.back": "Go back" },
        { es: { "Common.back": "Volver", "Common.gone": "Ido" } },
      ),
    ).toEqual([{ locale: "es", key: "Common.gone", kind: "unexpected" }])
  })

  it("fails English text for a key that is not pending, and allows it for neutral and English-only", () => {
    const catalogs = {
      es: { "Common.back": "Go back", "Common.new": "BibleProject" },
      crk: { "Common.back": "Go back", "Common.new": "BibleProject" },
    }
    const problems = untranslatedProblems(
      { "Common.back": "Go back", "Common.new": "BibleProject" },
      catalogs,
      policy({ intentionallyLocaleNeutral: ["Common.new"] }),
    )
    expect(problems).toEqual([
      { locale: "es", key: "Common.back", kind: "untranslated" },
    ])
  })
})
