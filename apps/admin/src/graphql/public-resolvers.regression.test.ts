// Centralized PUBLIC-resolvers regression — substitutes for SDL-drift CI,
// which is blind to `authScopes` changes because `src/scripts/print-schema.ts`
// strips the directive pre-commit (gql.tada can't parse it). Static source
// scan over `src/graphql/{types,queries,mutations}/`. Meta-defended by
// `classification.test.ts:232`. Per consumer-migration U2 (2026-05-11).

import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const SOURCE_DIRS = [
  resolve(__dirname, "types"),
  resolve(__dirname, "queries"),
  resolve(__dirname, "mutations"),
]
const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => resolve(dir, f)),
)

/**
 * Every root resolver intended to be PUBLIC. Adding/removing a name here
 * is a deliberate auth widening/narrowing — narrowing breaks consumer
 * reads in apps/web, apps/mobile, apps/tv.
 */
const INTENDED_PUBLIC_RESOLVERS = [
  // Pre-existing
  "experienceBySlug",
  // Unlisted draft-lifetime capability. The resolver returns only the narrow
  // render DTO and never falls back to canonical content.
  "experiencePreview",
  "searchExperiences",
  "watchSearch",
  "watchSearchSuggestions",
  "recordWatchSearchEvent",
  "sceneRecommendations",
  // feat-368 U2/U4. Public-shaped; resolver-body authenticated for Web only.
  "semanticRecommendationDelivery",
  "recordSemanticRecommendationEvidence",
  "selectSemanticRecommendation",
  "claimSemanticRecommendationEpisode",
  "recordSemanticRecommendationPlayback",
  "recordRecommendationContentAction",
  "recommendationProfileStatus",
  "transitionRecommendationProfile",
  // feat-369. Issues the bounded, opaque context used by Watch playback
  // episodes; caller identity is still enforced inside the resolver body.
  "issueWatchPlaybackContext",
  // feat-477 / PR #2249. Public-shaped installation and source-free APIs;
  // service bodies enforce consumer bearer identity and opaque viewer/session
  // possession. Raw digest authority remains restricted to the Web backend.
  "createRecommendationViewer",
  "updateRecommendationViewer",
  "userRecommendations",
  // consumer-migration U2 (2026-05-11) — see
  // docs/plans/2026-05-11-001-feat-consumer-migration-unit-2-admin-public-widening-plan.md
  "video",
  "videoBySlug",
  "videos",
  // Forge /watch home showcase lookup: public consumer read, normal Video shape.
  "watchHomeVideos",
  // Forge /watch homepage infinite discovery feed: public, bounded collection
  // parents using the same Video visibility contract (feat-405).
  "watchCollectionFeed",
  // Forge /watch language inventory lookup: public consumer read, flat card shape.
  "watchLanguageInventory",
  // Forge /watch language-collection sidebar availability indicator: public
  // consumer read of aggregate COUNTS only — no language identities, titles, or
  // ids — over the same child-visibility contract as `childDubLanguages`.
  "watchCollectionLanguageCounts",
  // Forge /watch single-video cold route lookup: public consumer read, flat
  // route snapshot shape that replaces the hot nested videoBySlug graph.
  "watchVideoRouteSnapshotBySlug",
  // Lazy per-dub downloads/subtitles fetch for mobile's lean watch screen —
  // same public posture + visibility as videoBySlug{ dubs }.
  "videoDub",
  "languages",
  "countries",
  "keywords",
  "watchSetting",
  // Anonymous sticker voting on web's /watch/whats-new. Deliberately public:
  // the page has no login, so requiring one would cost the signal the votes
  // exist to collect. The abuse story is the per-IP mutation rate limit plus
  // the service's per-ballot budget — not the auth scope. Writes validate
  // every id server-side and refuse rather than throw.
  "whatsNewFeatureVoteTallies",
  "castWhatsNewFeatureVote",
  "retractWhatsNewFeatureVote",
  // Mobile in-app feedback — docs/plans/2026-09-14-1033-feat-mobile-feedback-linear-plan.md.
  // Public on purpose (reports without sign-in); abuse bound is the resolver's own
  // counters (5/10min/install, 20/h/address, fleet daily cap) + zod bounds — all answer as data.
  "submitFeedback",
] as const

function readAllTypeSources(): string {
  return SOURCE_FILES.map((path) => readFileSync(path, "utf8")).join(
    "\n\n// ===== file boundary =====\n\n",
  )
}

// A `/` after one of these, or at the start of a line, opens a regex literal, not a division.
const REGEX_PRECEDERS = "(,=:![&|?{;"
function startsRegex(source: string, slash: number): boolean {
  let j = slash - 1
  while (j >= 0 && (source[j] === " " || source[j] === "\t")) j--
  return j < 0 || source[j] === "\n" || REGEX_PRECEDERS.includes(source[j])
}

// Index of the `/` that closes the regex literal opened at `open`. A class `[...]`
// may hold a bare `/`; a newline means the literal was misread, so stop there.
function regexEnd(source: string, open: number): number {
  let inClass = false
  for (let i = open + 1; i < source.length; i++) {
    const c = source[i]
    if (c === "\\") i++
    else if (c === "\n") return i
    else if (inClass) {
      if (c === "]") inClass = false
    } else if (c === "[") inClass = true
    else if (c === "/") return i
  }
  return source.length
}

// Index just past the bracket that closes the one at `open`. Skips strings, comments,
// and regex literals: an apostrophe in a comment ("U1's contract") once opened a string
// that ran into the next file, and the `\/\//` in a URL regex once opened a comment.
function skipBalanced(source: string, open: number): number {
  let depth = 1
  let i = open + 1
  let inString: '"' | "'" | "`" | null = null
  let inLineComment = false
  let inBlockComment = false
  let prev = ""
  while (i < source.length && depth > 0) {
    const c = source[i]
    const next = source[i + 1]
    if (inLineComment) {
      if (c === "\n") inLineComment = false
    } else if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false
        i++
      }
    } else if (inString) {
      if (c === inString && prev !== "\\") inString = null
    } else if (c === "/" && next === "/" && prev !== "\\") {
      inLineComment = true
      i++
    } else if (c === "/" && next === "*" && prev !== "\\") {
      inBlockComment = true
      i++
    } else if (c === "/" && startsRegex(source, i)) {
      i = regexEnd(source, i)
    } else {
      if (c === '"' || c === "'" || c === "`") inString = c
      else if ("{([".includes(c)) depth++
      else if ("})]".includes(c)) depth--
    }
    prev = c
    i++
  }
  return i
}

/** Fields under `builder.inputType(...)` read like resolvers and shadow them under
 * "last write wins" (`FeedbackSubmissionInput.video` hid `Query.video`). Each span is
 * one call's balanced `(`…`)` range, computed once; a match inside one is an input field. */
function inputTypeSpans(source: string): Array<[number, number]> {
  const spans: Array<[number, number]> = []
  const re = /\bbuilder\s*\.\s*inputType\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    spans.push([m.index, skipBalanced(source, re.lastIndex - 1)])
  }
  return spans
}

function isInputTypeField(
  spans: ReadonlyArray<[number, number]>,
  index: number,
): boolean {
  return spans.some(([start, end]) => index >= start && index < end)
}

// Brace-balanced parse; last write wins on duplicate names. A match inside an
// input-type span is skipped; every other `name: t.field(` / `t.prismaField(`
// becomes a block keyed by name.
function parseResolverBlocks(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const spans = inputTypeSpans(source)
  const re = /(\w+):\s*t\.(?:prismaField|field)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const name = m[1]
    if (isInputTypeField(spans, m.index)) continue
    let i = re.lastIndex
    while (i < source.length && source[i] !== "{") i++
    if (i >= source.length) continue
    const end = skipBalanced(source, i)
    result.set(name, source.slice(i + 1, end - 1))
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

// Drift detection: any `authScopes: { public: true }` not in the manifest fires.
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

// Constructed sources that pin the parser itself. Each case names the shape that once
// hid a resolver (or must keep working) and asserts which names are parsed and public.
describe("parseResolverBlocks (parser self-test)", () => {
  const PUBLIC = "authScopes: { public: true }"
  const PUBLIC_RE = /authScopes:\s*\{\s*public:\s*true\s*\}/
  const cases: Array<{
    label: string
    source: string
    names: string[]
    publicNames: string[]
  }> = [
    {
      label:
        "an input field of the same name does not shadow the root resolver",
      source: [
        `builder.inputType("XInput", { fields: (t) => ({ video: t.field({ type: "String" }) }) })`,
        `builder.queryFields((t) => ({ video: t.field({ type: "Boolean", ${PUBLIC}, resolve: () => true }) }))`,
      ].join("\n"),
      names: ["video"],
      publicNames: ["video"],
    },
    {
      label:
        "a prettier-chained builder .objectRef after an inputType is not an input type",
      source: [
        `builder.inputType("XInput", { fields: (t) => ({ a: t.string() }) })`,
        `builder`,
        `  .objectRef<Y>("Y")`,
        `  .implement({ fields: (t) => ({ b: t.field({ type: "Boolean", ${PUBLIC}, resolve: () => true }) }) })`,
      ].join("\n"),
      names: ["b"],
      publicNames: ["b"],
    },
    {
      label:
        "a comment naming builder.inputType inside a callback hides nothing after it",
      source: [
        `builder.inputType("XInput", { fields: (t) => ({ a: t.string() }) })`,
        `builder.mutationFields((t) => ({`,
        `  // the arg shape is the builder.inputType("XInput") above`,
        `  newDangerous: t.field({ type: "Boolean", ${PUBLIC}, args: { input: t.arg({ type: XInput }) }, resolve: () => true }),`,
        `}))`,
      ].join("\n"),
      names: ["newDangerous"],
      publicNames: ["newDangerous"],
    },
    {
      label:
        "an inline builder.inputType in a sibling's t.arg hides nothing after it",
      source: [
        `builder.queryFields((t) => ({`,
        `  first: t.field({ type: "Boolean", args: { input: t.arg({ type: builder.inputType("Inline", { fields: (t) => ({ a: t.string() }) }) }) }, resolve: () => true }),`,
        `  second: t.field({ type: "Boolean", ${PUBLIC}, resolve: () => true }),`,
        `}))`,
      ].join("\n"),
      names: ["first", "second"],
      publicNames: ["second"],
    },
    {
      label: "escaped slashes in a regex literal do not open a line comment",
      source: [
        `builder.queryFields((t) => ({`,
        `  guarded: t.field({`,
        `    type: "Boolean",`,
        `    args: { url: t.arg.string() },`,
        `    resolve: (_root, args) => {`,
        `      if (/^https?:\\/\\//u.test(args.url ?? "")) {`,
        `        return true`,
        `      }`,
        `      return false`,
        `    },`,
        `    ${PUBLIC},`,
        `  }),`,
        `}))`,
      ].join("\n"),
      names: ["guarded"],
      publicNames: ["guarded"],
    },
    {
      label:
        "an apostrophe in a regex class and /* inside a string are not delimiters",
      source: [
        `builder.queryFields((t) => ({`,
        `  quoted: t.field({`,
        `    type: "Boolean",`,
        `    resolve: () => {`,
        `      const hasQuote = /[']/u.test("x")`,
        `      const label = "/* not a comment */"`,
        `      return hasQuote || label.length > 0`,
        `    },`,
        `    ${PUBLIC},`,
        `  }),`,
        `}))`,
      ].join("\n"),
      names: ["quoted"],
      publicNames: ["quoted"],
    },
    {
      label:
        "control: a line comment with an apostrophe does not open a string",
      source: [
        `builder.queryFields((t) => ({`,
        `  plain: t.field({`,
        `    type: "Boolean",`,
        `    // U1's contract`,
        `    resolve: () => true,`,
        `    ${PUBLIC},`,
        `  }),`,
        `}))`,
      ].join("\n"),
      names: ["plain"],
      publicNames: ["plain"],
    },
  ]

  for (const c of cases) {
    it(c.label, () => {
      const blocks = parseResolverBlocks(c.source)
      expect([...blocks.keys()].sort()).toEqual([...c.names].sort())
      const publicNames = [...blocks.entries()]
        .filter(([, block]) => PUBLIC_RE.test(block))
        .map(([name]) => name)
      expect(publicNames.sort()).toEqual([...c.publicNames].sort())
    })
  }
})
