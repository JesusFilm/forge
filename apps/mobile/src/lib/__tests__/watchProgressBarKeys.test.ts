/**
 * The progress store is keyed by admin Video id. A surface that hands it a
 * RENDER key instead shows no bar and fails silently — shipped that way on
 * Home, where `card.id` carries an index suffix.
 *
 * This pins the id expression at each call site by source. A pure adapter test
 * cannot: it would stay green if only the consumer regressed. The app does
 * have a component-render harness (apps/mobile/CLAUDE.md, "Component render
 * tests"), but reaching every surface through it would need one case per
 * surface. Node globals are declared locally rather than via @types/node —
 * KTD11 forbids new test deps.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  readdirSync: (
    path: string,
    options: { withFileTypes: true },
  ) => Array<{ name: string; isDirectory: () => boolean }>
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")
/** apps/mobile — both `src/` and the Expo Router `app/` tree live here. */
const ROOT = path.join(__dirname, "..", "..", "..")
const WALK_DIRS = ["src", "app"]
const SKIP_DIRS = new Set(["node_modules", "ios", "android", "assets", ".expo"])

/**
 * Every surface reading the progress store, and the id expression it must
 * pass. Both consumers are listed: the visible bar AND the accessibility
 * label, which drifted apart once already.
 */
const BAR_SITES: ReadonlyArray<{ file: string; expression: string }> = [
  { file: "src/components/home/HomeCard.tsx", expression: "card.videoId" },
  {
    file: "src/components/series/SeriesEpisodeCard.tsx",
    expression: "episode.documentId",
  },
  {
    file: "src/components/watch/UpNextCarousel.tsx",
    expression: "item.documentId",
  },
  {
    file: "src/components/search/SearchResultCard.tsx",
    expression: "result.id",
  },
  {
    file: "src/components/sections/VideoCardRenderer.tsx",
    expression: "videoId",
  },
  {
    file: "src/components/sections/VideoCarouselRenderer.tsx",
    expression: "item.videoId",
  },
  {
    file: "src/components/sections/MediaCollectionRenderer.tsx",
    expression: "item.videoId",
  },
]

const ENTRY_SITES: ReadonlyArray<{ file: string; expression: string }> = [
  { file: "src/components/home/HomeCard.tsx", expression: "card.videoId" },
  {
    file: "src/components/series/SeriesEpisodeCard.tsx",
    expression: "episode.documentId",
  },
  // The hook itself forwards its prop; the bar's own sites are pinned above.
  { file: "src/components/watch/WatchProgressBar.tsx", expression: "videoId" },
  { file: "app/watch/[slug].tsx", expression: "video?.documentId" },
]

function read(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8")
}

/** `s` flag + \b so a prop reorder or line break still parses. */
function barProps(source: string): string[] {
  return [
    ...source.matchAll(/<WatchProgressBar\b[^>]*?videoId=\{([^}]+)\}/gs),
  ].map((match) => match[1].trim())
}

function entryArgs(source: string): string[] {
  return [...source.matchAll(/useWatchProgressEntry\(([^)]*)\)/g)]
    .map((match) => match[1].trim())
    .filter((arg) => arg.length > 0)
}

/** The hook's own definition matches its name; only consumers are pinned. */
const DEFINITION_FILES = new Set(["src/hooks/useWatchProgressEntry.ts"])

function walkForPattern(pattern: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), {
      withFileTypes: true,
    })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const relativePath = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(relativePath)
      else if (
        /\.tsx?$/.test(entry.name) &&
        !relativePath.includes("__tests__") &&
        !DEFINITION_FILES.has(relativePath) &&
        read(relativePath).includes(pattern)
      ) {
        found.push(relativePath)
      }
    }
  }
  for (const dir of WALK_DIRS) walk(dir)
  return found.sort()
}

describe("progress-store id sources (store-key guard)", () => {
  it.each(BAR_SITES)("$file bar passes $expression", ({ file, expression }) => {
    expect(barProps(read(file))).toEqual([expression])
  })

  it.each(ENTRY_SITES)(
    "$file reads the store by $expression",
    ({ file, expression }) => {
      expect(entryArgs(read(file))).toContain(expression)
    },
  )

  it("no surface reads the store by a card render key — the Home regression", () => {
    // `card.id` is `${coreId}-${index}`; it can never match a store entry.
    // This bit the bar and then, separately, the accessibility label.
    for (const { file } of [...BAR_SITES, ...ENTRY_SITES]) {
      const source = read(file)
      expect(barProps(source)).not.toContain("card.id")
      expect(entryArgs(source)).not.toContain("card.id")
    }
  })

  it("covers every call site in src AND app, so a new surface cannot slip in", () => {
    // Expo Router screens live in app/, a sibling of src/ — an earlier
    // version of this walk missed them entirely while claiming full coverage.
    expect(walkForPattern("<WatchProgressBar")).toEqual(
      BAR_SITES.map((site) => site.file).sort(),
    )
    expect(walkForPattern("useWatchProgressEntry(")).toEqual(
      ENTRY_SITES.map((site) => site.file).sort(),
    )
  })
})
