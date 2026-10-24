// The per-key source record (i18n/source-record.json): a changed English
// string cannot merge while its old translations stay, unless it is pending
// (R18). The record holds one English hash per key, not one per locale.
import {
  describeProblem,
  readCatalogDir,
  readPolicy,
  readRecord,
  REAL_PATHS,
  recordProblems,
  stalePlaceholderProblems,
} from "../../../scripts/i18n/lib/catalogChecks"
import {
  englishHash,
  type SourceRecord,
  type TranslationPolicy,
} from "../../../scripts/i18n/lib/catalogOps"

const policy = (
  pendingKeys: Record<string, string> = {},
): TranslationPolicy => ({
  humanReviewedLocales: ["en"],
  intentionallyLocaleNeutral: [],
  englishOnlyLocales: ["crk"],
  pendingKeys,
})

const record = (hashes: Record<string, string>): SourceRecord => ({
  englishHashes: Object.fromEntries(
    Object.entries(hashes).map(([key, text]) => [key, englishHash(text)]),
  ),
})

describe("the real source record", () => {
  const { source, catalogs } = readCatalogDir(REAL_PATHS.messagesDir)
  const realPolicy = readPolicy(REAL_PATHS.policy)
  const realRecord = readRecord(REAL_PATHS.record)

  it("records the current English of every key that is not pending", () => {
    expect(
      recordProblems(source, realRecord, realPolicy).map(describeProblem),
    ).toEqual([])
  })

  it("shows no stale placeholder for a pending key", () => {
    expect(
      stalePlaceholderProblems(source, catalogs, realRecord, realPolicy).map(
        describeProblem,
      ),
    ).toEqual([])
  })
})

describe("the source-record check", () => {
  it("fails a key whose English changed while its hash stayed, and names the key", () => {
    const problems = recordProblems(
      { "Common.back": "Go back now" },
      record({ "Common.back": "Go back" }),
      policy(),
    )
    expect(problems).toEqual([{ key: "Common.back", kind: "stale" }])
    expect(describeProblem(problems[0])).toMatch(/--mark-pending Common\.back/)
  })

  it("passes the same key when it is pending", () => {
    expect(
      recordProblems(
        { "Common.back": "Go back now" },
        record({ "Common.back": "Go back" }),
        policy({ "Common.back": "2026-09-29" }),
      ),
    ).toEqual([])
  })

  it("fails a key with no hash and a hash for a deleted key", () => {
    expect(
      recordProblems(
        { "Common.new": "New" },
        record({ "Common.gone": "Gone" }),
        policy(),
      ),
    ).toEqual([
      { key: "Common.new", kind: "unrecorded" },
      { key: "Common.gone", kind: "deleted" },
    ])
  })

  it("fails a pending key whose English changed while a locale still shows another text", () => {
    const source = { "Common.back": "Go back now" }
    const catalogs = {
      es: { "Common.back": "Go back" },
      fr: { "Common.back": "Go back now" },
      crk: { "Common.back": "Go back" },
    }
    const pending = policy({ "Common.back": "2026-09-01" })
    expect(
      stalePlaceholderProblems(
        source,
        catalogs,
        record({ "Common.back": "Go back" }),
        pending,
      ),
    ).toEqual([{ locale: "es", key: "Common.back", kind: "stale-placeholder" }])
    // With a current hash, a value other than English is a fresh translation.
    expect(
      stalePlaceholderProblems(
        source,
        { es: { "Common.back": "Volver ahora" } },
        record(source),
        pending,
      ),
    ).toEqual([])
  })
})
