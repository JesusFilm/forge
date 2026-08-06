/**
 * The progress store is keyed by admin Video id. A card surface that hands
 * WatchProgressBar a RENDER key instead renders no bar and fails silently —
 * shipped that way on Home, where `card.id` carries an index suffix.
 *
 * apps/mobile has no component-render tests (KTD11), so this pins the prop at
 * each call site by source. A pure adapter test cannot: reverting only the
 * consumer would leave it green. Node globals are declared locally rather than
 * pulled in via @types/node — KTD11 also forbids new test dependencies.
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
const SRC = path.join(__dirname, "..", "..")

/** Every surface that renders a bar, and the id expression it must pass. */
const CALL_SITES: ReadonlyArray<{ file: string; expression: string }> = [
  { file: "components/home/HomeCard.tsx", expression: "card.videoId" },
  {
    file: "components/series/SeriesEpisodeCard.tsx",
    expression: "episode.documentId",
  },
  {
    file: "components/watch/UpNextCarousel.tsx",
    expression: "item.documentId",
  },
  { file: "components/search/SearchResultCard.tsx", expression: "result.id" },
  { file: "components/sections/VideoCardRenderer.tsx", expression: "videoId" },
  {
    file: "components/sections/VideoCarouselRenderer.tsx",
    expression: "item.videoId",
  },
  {
    file: "components/sections/MediaCollectionRenderer.tsx",
    expression: "item.videoId",
  },
]

function read(relativePath: string): string {
  return fs.readFileSync(path.join(SRC, relativePath), "utf8")
}

function barProps(source: string): string[] {
  return [...source.matchAll(/<WatchProgressBar\s+videoId=\{([^}]+)\}/g)].map(
    (match) => match[1].trim(),
  )
}

describe("WatchProgressBar id sources (store-key guard)", () => {
  it.each(CALL_SITES)("$file passes $expression", ({ file, expression }) => {
    expect(barProps(read(file))).toEqual([expression])
  })

  it("no surface passes a card render key — the Home regression", () => {
    // `card.id` is `${coreId}-${index}`; it can never match a store entry.
    for (const { file } of CALL_SITES) {
      expect(barProps(read(file))).not.toContain("card.id")
    }
  })

  it("covers every call site in the tree, so a new surface cannot slip in", () => {
    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(SRC, dir), {
        withFileTypes: true,
      })) {
        const relativePath = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(relativePath)
        else if (
          entry.name.endsWith(".tsx") &&
          read(relativePath).includes("<WatchProgressBar")
        ) {
          found.push(relativePath)
        }
      }
    }
    walk("components")
    expect(found.sort()).toEqual(CALL_SITES.map((site) => site.file).sort())
  })
})
