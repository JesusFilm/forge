// Pothos `@classification` enforcement. Asserts (1) every prismaObject has
// a `@classification abac-gated|public-shape` tag and (2) no public-shape
// type declares a `t.relation` to an abac-gated target. Runtime ABAC parity
// test is `.todo` until Unit 7 service-layer resolvers exist.

import { describe, expect, it, test } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const TYPES_DIR = resolve(__dirname, "types")
const TYPE_FILES = readdirSync(TYPES_DIR).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
)

type Classification = "abac-gated" | "public-shape"

type ParsedType = {
  file: string
  typeName: string
  classification: Classification | null
  /** Names referenced by `t.relation("name")` calls inside this type. */
  relations: string[]
}

function parseTypeFile(file: string): ParsedType[] {
  const source = readFileSync(resolve(TYPES_DIR, file), "utf8")
  const results: ParsedType[] = []

  const callRegex = /builder\.prismaObject\(\s*"([^"]+)"\s*,/g
  let match: RegExpExecArray | null
  while ((match = callRegex.exec(source)) !== null) {
    const typeName = match[1]
    const callStart = match.index

    // 500-char backward window: JSDoc tags live immediately above the call.
    const lookback = source.slice(Math.max(0, callStart - 500), callStart)
    const jsdocMatch = lookback.match(
      /\/\*\*[\s\S]*?@classification\s+(abac-gated|public-shape)[\s\S]*?\*\//,
    )
    const classification = jsdocMatch ? (jsdocMatch[1] as Classification) : null

    // Bail at 5000 chars — no Pothos type in this codebase is that large.
    const fieldsStart = source.indexOf("{", callStart)
    let depth = 0
    let fieldsEnd = source.length
    for (
      let i = fieldsStart;
      i < Math.min(source.length, fieldsStart + 5000);
      i++
    ) {
      const ch = source[i]
      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          fieldsEnd = i
          break
        }
      }
    }
    const fieldsBlock = source.slice(fieldsStart, fieldsEnd)

    const relations: string[] = []
    const relRegex = /t\.relation\(\s*"([^"]+)"/g
    let relMatch: RegExpExecArray | null
    while ((relMatch = relRegex.exec(fieldsBlock)) !== null) {
      relations.push(relMatch[1])
    }

    results.push({ file, typeName, classification, relations })
  }
  return results
}

const ALL_TYPES: ParsedType[] = TYPE_FILES.flatMap(parseTypeFile)

const CLASSIFICATION_BY_NAME = new Map<string, Classification | null>(
  ALL_TYPES.map((t) => [t.typeName, t.classification]),
)

// -----------------------------------------------------------------------------

describe("Pothos type classification — every prismaObject is tagged", () => {
  for (const t of ALL_TYPES) {
    it(`${t.typeName} (${t.file}) carries an @classification tag`, () => {
      expect(
        t.classification,
        `Expected ${t.typeName} in src/graphql/types/${t.file} to have a JSDoc /** @classification abac-gated */ or /** @classification public-shape */ tag.`,
      ).not.toBeNull()
    })
  }
})

// -----------------------------------------------------------------------------

describe("public-shape types do not relate to abac-gated types", () => {
  // Per-parent map: relation names aren't globally unique (Experience.locales
  // ≠ Video.locales). New abac-gated relations require an entry here.
  const RELATION_TARGETS: Record<string, Record<string, string>> = {
    Experience: { locales: "ExperienceLocale" },
    Video: {
      primaryLanguage: "Language",
      origin: "VideoOrigin",
      locales: "VideoLocale",
      dubs: "VideoDub",
      subtitles: "VideoSubtitle",
      images: "VideoImage",
      studyQuestions: "VideoStudyQuestion",
      bibleCitations: "BibleCitation",
      parents: "VideoRelation",
      children: "VideoRelation",
    },
    VideoRelation: { parent: "Video", child: "Video" },
    VideoEdition: { dubs: "VideoDub", subtitles: "VideoSubtitle" },
    VideoScene: { locales: "VideoSceneLocale" },
    Language: { locales: "LanguageLocale" },
    LanguageLocale: { language: "Language" },
    Continent: { locales: "ContinentLocale" },
    ContinentLocale: { continent: "Continent" },
    Country: {
      continent: "Continent",
      countryLanguages: "CountryLanguage",
      locales: "CountryLocale",
    },
    CountryLocale: { country: "Country" },
    CountryLanguage: { country: "Country", language: "Language" },
    Keyword: { language: "Language" },
    BibleCitation: { bibleBook: "BibleBook" },
    MediaAsset: { locales: "MediaAssetLocale" },
    VideoLocale: { language: "Language" },
    VideoSubtitle: { video: "Video", language: "Language" },
    VideoStudyQuestion: { language: "Language" },
    VideoGeneratedQuestion: {
      language: "Language",
      sourceStudyQuestion: "VideoStudyQuestion",
    },
    VideoDub: {
      language: "Language",
      videoEdition: "VideoEdition",
      muxVideo: "MuxVideo",
      downloads: "VideoDubDownload",
    },
  }

  // Registry exhaustiveness — silent skips would let new abac-gated relations
  // bypass the classification gate. On failure: add the entry to RELATION_TARGETS.
  for (const t of ALL_TYPES) {
    const parentRegistry = RELATION_TARGETS[t.typeName] ?? {}
    for (const relName of t.relations) {
      it(`${t.typeName}.${relName} is registered in RELATION_TARGETS`, () => {
        expect(
          parentRegistry[relName],
          `${t.typeName}.${relName} is declared via t.relation(...) but has ` +
            `no entry in the RELATION_TARGETS registry in this test file. ` +
            `Add the target Pothos type name so the classification check ` +
            `can verify it.`,
        ).toBeDefined()
      })
    }
  }

  for (const t of ALL_TYPES) {
    if (t.classification !== "public-shape") continue
    const parentRegistry = RELATION_TARGETS[t.typeName] ?? {}
    for (const relName of t.relations) {
      const targetType = parentRegistry[relName]
      if (!targetType) continue // Registry-completeness test above will fail.
      const targetClass = CLASSIFICATION_BY_NAME.get(targetType)
      it(`${t.typeName}.${relName} → ${targetType} is not abac-gated`, () => {
        expect(
          targetClass,
          `${t.typeName} is public-shape but exposes t.relation("${relName}") whose target ${targetType} is ${targetClass}. ` +
            `Either change the relation to route through a service (Unit 7) ` +
            `or reclassify ${t.typeName} as abac-gated.`,
        ).not.toBe("abac-gated")
      })
    }
  }
})

// Meta-defense: pair file `public-resolvers.regression.test.ts` exists. Deleting
// it silently removes the only structural guard that intended-PUBLIC resolvers
// stay PUBLIC (SDL-drift CI is blind to `authScopes`). U2, 2026-05-11.
describe("public-resolvers regression test meta-defense", () => {
  it("apps/admin/src/graphql/public-resolvers.regression.test.ts exists", () => {
    const path = resolve(__dirname, "public-resolvers.regression.test.ts")
    expect(
      existsSync(path),
      "The centralized PUBLIC-resolvers regression test is the substitute " +
        "for SDL-drift CI's blindness to authScopes changes. Deleting it " +
        "removes the only structural guard that intended-PUBLIC resolvers " +
        "stay PUBLIC. If you really meant to delete it, also remove this " +
        "assertion AND document the new safeguard in `docs/solutions/`.",
    ).toBe(true)
  })
})

test.todo(
  "ABAC parity (runtime, requires Unit 7 services + live DB): " +
    "for every abac-gated type, assert that Query.t(id) and every X.t / " +
    "X.ts relation path return the same row set for the same principal.",
)
