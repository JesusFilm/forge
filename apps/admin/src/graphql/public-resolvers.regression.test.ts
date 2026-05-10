// Centralized regression test for intended-PUBLIC root resolvers.
//
// Why this exists: `src/scripts/print-schema.ts` strips `@authScopes`
// directives from the committed SDL before commit (gql.tada can't parse
// non-standard directive declarations). The `admin-schema-drift` CI job
// reads the stripped SDL — so any change to a resolver's `authScopes`
// produces ZERO diff and the drift gate is structurally blind to it.
//
// Per-resolver behavioral tests close part of that gap, but a behavioral
// test only catches regressions on resolvers it covers. A future
// contributor narrowing `experienceBySlug` from `public: true` back to
// `loggedIn: true` (in a refactor, a bad merge, an "I'll tighten this
// for safety" edit) would silently pass CI unless every PUBLIC resolver
// has dedicated tests.
//
// This test walks the source files of `src/graphql/types/` and asserts
// that every name in `INTENDED_PUBLIC_RESOLVERS` is declared with
// `authScopes: { public: true }`. Narrowing any intended-PUBLIC resolver
// breaks this assertion. Adding a new PUBLIC resolver requires
// extending the manifest — which is reviewable in PR.
//
// Static source-file scanning is intentional: full GraphQL pipeline
// execution in vitest is fragile because of the transitive-graphql
// double-instance issue (see `scene-recommendations.test.ts` and
// `hybrid-search.test.ts` for the pattern these tests work around).
// The static check is precise, fast, and survives the rest of the
// test infrastructure's limitations.
//
// Meta-defense: `classification.test.ts` asserts THIS file exists.
// Deleting either fails the other — both must survive together.
//
// Per consumer-migration U2 plan (2026-05-11).

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// Root resolvers in admin live in either `src/graphql/types/` (per-type
// modules that register their root queries alongside the type) or
// `src/graphql/queries/` (standalone query modules like search and
// scene-recommendations). Scan both.
const SOURCE_DIRS = [resolve(__dirname, "types"), resolve(__dirname, "queries")]
const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => resolve(dir, f)),
)

/**
 * Every GraphQL root resolver (Query or Mutation) intended to be PUBLIC.
 *
 * Adding a resolver here is a deliberate decision to expose it to
 * anonymous callers — review the field surface for editor-private data
 * before merging.
 *
 * Removing a resolver is a deliberate decision to narrow it. The
 * accompanying source change must remove the `authScopes: { public: true }`
 * from the resolver definition.
 *
 * Future maintainers: if you're tempted to remove a name here to make a
 * test pass, STOP and re-read the consumer-migration plan first.
 * Narrowing a PUBLIC resolver in admin breaks consumer reads in apps/web,
 * apps/mobile, and apps/tv.
 */
const INTENDED_PUBLIC_RESOLVERS = [
  // Pre-U2 (already PUBLIC before consumer-migration Unit 2 widening)
  "experienceBySlug",
  "searchExperiences",
  "search",
  "sceneRecommendations",
  // Added by consumer-migration U1 (video reads)
  "video",
  "videoBySlug",
  "videos",
  // Added by consumer-migration U3 (reference data widening)
  "languages",
  "countries",
  "keywords",
  // Added by consumer-migration U4 (new homepage configuration resolver)
  "watchSetting",
] as const

/**
 * Concatenate every type-module source so we can search across files
 * without coupling each resolver to a specific module path.
 */
function readAllTypeSources(): string {
  return SOURCE_FILES.map((path) => readFileSync(path, "utf8")).join(
    "\n\n// ===== file boundary =====\n\n",
  )
}

/**
 * Parse every `<name>: t.prismaField({ ... }) | t.field({ ... })` declaration
 * with balanced-brace tracking. Returns a Map of resolver name → its
 * complete options-block source. Brace-balanced parsing avoids the regex
 * trap where a non-greedy span absorbs neighboring field declarations.
 *
 * We restrict to `t.prismaField` / `t.field` because those are how root
 * resolvers and exposed object fields are declared in this codebase.
 */
function parseResolverBlocks(source: string): Map<string, string> {
  const result = new Map<string, string>()
  // Match `<name>: t.prismaField(` or `<name>: t.field(` and capture position
  // right after the opening paren. We then walk forward, tracking brace
  // depth from the first `{` we encounter, until we close it.
  const re = /(\w+):\s*t\.(?:prismaField|field)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const name = m[1]
    let i = re.lastIndex
    // Skip whitespace to the opening `{`
    while (i < source.length && source[i] !== "{") i++
    if (i >= source.length) continue
    // Walk until matching close brace.
    let depth = 1
    const blockStart = i + 1
    i++
    // Track string literals to avoid counting braces inside strings.
    let inString: '"' | "'" | "`" | null = null
    let prev = ""
    while (i < source.length && depth > 0) {
      const c = source[i]
      if (inString) {
        if (c === inString && prev !== "\\") inString = null
      } else {
        if (c === '"' || c === "'" || c === "`") inString = c
        else if (c === "{") depth++
        else if (c === "}") depth--
      }
      prev = c
      i++
    }
    const block = source.slice(blockStart, i - 1)
    // Last write wins if a resolver name is reused — fine in practice
    // because each name appears at most once per type-files corpus.
    result.set(name, block)
  }
  return result
}

const SOURCES = readAllTypeSources()
const BLOCKS = parseResolverBlocks(SOURCES)

describe("centralized PUBLIC-resolvers regression", () => {
  for (const name of INTENDED_PUBLIC_RESOLVERS) {
    it(`Query.${name} is declared with authScopes: { public: true }`, () => {
      const block = BLOCKS.get(name)
      expect(
        block,
        `Query.${name} should be declared as t.prismaField or t.field ` +
          `somewhere under src/graphql/types/. No declaration found.`,
      ).toBeDefined()
      const hasPublic = /authScopes:\s*\{\s*public:\s*true\s*\}/.test(
        block ?? "",
      )
      expect(
        hasPublic,
        `Query.${name} should be declared with authScopes: { public: true }. ` +
          `If you narrowed this resolver intentionally (e.g., moved it ` +
          `behind a tier gate), remove "${name}" from ` +
          `INTENDED_PUBLIC_RESOLVERS in this test AND document the change ` +
          `in the consumer-migration runbook. Narrowing breaks anonymous ` +
          `reads from apps/web, apps/mobile, and apps/tv.`,
      ).toBe(true)
    })
  }
})

// -----------------------------------------------------------------------------
// Drift detection: surface accidental new PUBLIC resolvers.
//
// If a future contributor adds `authScopes: { public: true }` to a resolver
// they did not register in `INTENDED_PUBLIC_RESOLVERS`, the test below
// fires. The failure message instructs them to make a deliberate choice:
// either register the new resolver in the manifest (intentional new PUBLIC
// surface) or remove the authScopes flag (it was a copy-paste mistake).
// -----------------------------------------------------------------------------

describe("PUBLIC resolver manifest is exhaustive", () => {
  it("every authScopes: { public: true } resolver appears in the manifest", () => {
    const declared: string[] = []
    for (const [name, block] of BLOCKS) {
      if (/authScopes:\s*\{\s*public:\s*true\s*\}/.test(block)) {
        declared.push(name)
      }
    }
    const unregistered = declared.filter(
      (name) =>
        !(INTENDED_PUBLIC_RESOLVERS as readonly string[]).includes(name),
    )

    expect(
      unregistered.sort(),
      `Found PUBLIC resolvers not registered in INTENDED_PUBLIC_RESOLVERS: ` +
        `${unregistered.join(", ")}. If these were added intentionally, ` +
        `add them to the manifest in this file (with a comment naming the ` +
        `unit or PR that introduced them). If they were a copy-paste ` +
        `mistake, remove the authScopes: { public: true } and re-gate.`,
    ).toEqual([])
  })
})
