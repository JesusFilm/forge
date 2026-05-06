// Pothos type classification enforcement.
//
// Every type in `src/graphql/types/` carries a `@classification` JSDoc
// tag with one of two values:
//
//   abac-gated    — ownership and/or state-based ABAC applies. Reads via
//                   direct query AND nested relation paths must resolve
//                   to the same row set for any given principal. In Unit 7,
//                   relations targeting abac-gated types route through
//                   service-layer resolvers that re-apply the ABAC WHERE.
//   public-shape  — Core-sourced read-only data. Safe to expose via
//                   `t.relation` from other types; tier-only auth gates.
//
// This test enforces:
//   1. Every `builder.prismaObject(...)` call has a preceding
//      `@classification` JSDoc tag.
//   2. No type tagged `public-shape` declares a `t.relation(...)` whose
//      target is a type tagged `abac-gated` — that would let a public read
//      reach ABAC-gated data without re-applying ABAC.
//
// The runtime ABAC PARITY test (assert that direct-query and nested-
// relation paths return identical row sets for the same principal against
// a live DB) lives as a `.todo` placeholder — it lands in Unit 7 once
// service-layer resolvers exist to be tested.

import { describe, expect, it, test } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
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

/**
 * Parse a single type module file and extract all `builder.prismaObject`
 * declarations along with their preceding JSDoc classification tag and
 * the `t.relation(...)` references inside their fields block.
 *
 * This is a deliberately simple regex/string parser — using ts-morph would
 * be more robust but adds dependency weight for a single-purpose check.
 * The patterns we look for are small and stable.
 */
function parseTypeFile(file: string): ParsedType[] {
  const source = readFileSync(resolve(TYPES_DIR, file), "utf8")
  const results: ParsedType[] = []

  // Find every `builder.prismaObject("X", ...)` call. For each, walk
  // backwards from the call site to find the most recent JSDoc block, and
  // forward into the fields block to collect t.relation("...") references
  // up to the closing }) for this prismaObject call.
  const callRegex = /builder\.prismaObject\(\s*"([^"]+)"\s*,/g
  let match: RegExpExecArray | null
  while ((match = callRegex.exec(source)) !== null) {
    const typeName = match[1]
    const callStart = match.index

    // Look for a preceding JSDoc block in the ~500 characters above.
    // Pothos types in this codebase always have the JSDoc tag on the
    // immediately preceding line, so a small backwards window suffices.
    const lookback = source.slice(Math.max(0, callStart - 500), callStart)
    const jsdocMatch = lookback.match(
      /\/\*\*[\s\S]*?@classification\s+(abac-gated|public-shape)[\s\S]*?\*\//,
    )
    const classification = jsdocMatch ? (jsdocMatch[1] as Classification) : null

    // Find the matching closing `})` for this prismaObject call to bound
    // the fields-block scan. Walk forward counting parens; bail at 5000
    // chars (no Pothos type is that large in this codebase).
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
  // Map (parentTypeName, relationFieldName) → target Pothos type. Pothos
  // Prisma plugin resolves `t.relation("foo")` to the type registered
  // for the Prisma model field `foo` on the parent's model — but
  // relation names are NOT globally unique (e.g. both Experience and
  // Video have a `locales` field pointing at different per-locale tables).
  // Without parsing the Prisma DMMF here, we maintain an explicit per-
  // parent registry. New abac-gated relations require an entry.
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
    },
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
    VideoSubtitle: { video: "Video", language: "Language" },
    VideoStudyQuestion: { language: "Language" },
    VideoDub: {
      language: "Language",
      videoEdition: "VideoEdition",
      muxVideo: "MuxVideo",
      downloads: "VideoDubDownload",
    },
  }

  // Every relation on every type MUST appear in RELATION_TARGETS. Silently
  // skipping unknown relations would let a new abac-gated relation slip
  // past the classification gate because nothing ever checks it. If you
  // see a failure here, add the (parent, relation) → targetType pair to
  // RELATION_TARGETS above.
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

// -----------------------------------------------------------------------------

test.todo(
  "ABAC parity (runtime, requires Unit 7 services + live DB): " +
    "for every abac-gated type, assert that Query.t(id) and every X.t / " +
    "X.ts relation path return the same row set for the same principal.",
)
