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
] as const

function readAllTypeSources(): string {
  return SOURCE_FILES.map((path) => readFileSync(path, "utf8")).join(
    "\n\n// ===== file boundary =====\n\n",
  )
}

// Brace-balanced parse of `<name>: t.prismaField({...}) | t.field({...})`
// declarations. Tracks string literals to avoid counting braces inside
// strings. Last write wins on duplicate names (each name appears at most
// once across the corpus in practice).
function parseResolverBlocks(source: string): Map<string, string> {
  const result = new Map<string, string>()
  const re = /(\w+):\s*t\.(?:prismaField|field)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const name = m[1]
    let i = re.lastIndex
    while (i < source.length && source[i] !== "{") i++
    if (i >= source.length) continue
    let depth = 1
    const blockStart = i + 1
    i++
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
    result.set(name, source.slice(blockStart, i - 1))
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
