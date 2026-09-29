/**
 * SOURCE-SHAPE guard: HomeCard must classify on `card.rawLabel`, never
 * `card.label`. A one-line revert to `card.label` compiles, typechecks, and
 * leaves every unit test green, because the predicate is correct either way --
 * only the value fed to it changes (homeHeroAndroidCompositing convention).
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

function readSource(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, ...parts), "utf8")
}

/** Where prettier breaks the call is its business, not the invariant's. */
function squish(source: string): string {
  return source.replace(/\s+/g, "")
}

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(source: string, marker: string, from = 0): number {
  const i = source.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

describe("HomeCard routes on the raw label, not display text", () => {
  it("feeds card.rawLabel into isSeriesSearchResult", () => {
    const source = readSource("..", "HomeCard.tsx")
    const start = at(source, "isSeriesSearchResult({")
    const call = squish(source.slice(start, at(source, "})", start)))
    expect(call).toContain("label:card.rawLabel")
    // The whole point: labelText turns an absent label into "Video", so the
    // display string reads as labelled and the childCount branch goes dead.
    expect(call).not.toContain("label:card.label")
  })

  it("keeps rawLabel on the card model as a nullable field", () => {
    // `label: string` is never null, so a non-nullable rawLabel would silently
    // reintroduce the sentinel problem this field exists to avoid.
    const model = squish(
      readSource("..", "..", "..", "lib", "watchHome", "model.ts"),
    )
    expect(model).toContain("rawLabel:string|null")
  })
})

/**
 * U6: the hero's "Watch Now" routed on `isSeriesLabel(label)`, and the slide's
 * label is catalog text, so a Spanish "Serie" opened /watch. It must route on
 * the slide's raw kind. `slideRouteArgs.test.ts` proves the value passes.
 */
describe("HomeScreen's Watch Now routes on the raw label kind", () => {
  function watchNowRoute(source: string): string {
    const start = at(source, "const handleWatchNow")
    return squish(source.slice(start, at(source, "router.navigate(", start)))
  }

  it("feeds rawLabel from slideRouteArgs into isSeriesLabel", () => {
    const route = watchNowRoute(readSource("..", "HomeScreen.tsx"))
    expect(route).toContain("isSeriesLabel(rawLabel)")
    expect(route).not.toContain("isSeriesLabel(label)")
  })

  it("flags the old display-text compare (negative control)", () => {
    const reverted = readSource("..", "HomeScreen.tsx").replace(
      "isSeriesLabel(rawLabel)",
      "isSeriesLabel(label)",
    )
    expect(watchNowRoute(reverted)).not.toContain("isSeriesLabel(rawLabel)")
  })
})

/**
 * KTD15: `card.label` is catalog text, so a Spanish catalog emptied the hero's
 * short-film pool while it compared `label` with "Short film". The behaviour
 * test in watchHomeModel.test.ts proves the pool; this pins the source shape.
 */
describe("the short-film hero pool classifies on the raw label kind", () => {
  const MODEL = ["..", "..", "..", "lib", "watchHome", "model.ts"]
  const VIDEO_LABEL = ["..", "..", "..", "lib", "videoLabel.ts"]

  /** The loop that fills the short-film pool, whitespace removed. */
  function poolLoop(source: string): string {
    const start = at(source, "const shortFilmById")
    return squish(source.slice(start, at(source, "shortFilmById.set", start)))
  }

  function classifiesOnRawKind(source: string): boolean {
    const loop = poolLoop(source)
    return (
      /\.rawLabel(!==|===)"SHORT_FILM"/.test(loop) &&
      !/\.label(!==|===)/.test(loop)
    )
  }

  /** Block and line comments removed; a `//` after `:` (a URL) stays. */
  function withoutComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1")
  }

  /** English label text from the catalog, as quoted literals in the code. */
  function englishLabelLiterals(source: string): string[] {
    const catalog = JSON.parse(
      readSource("..", "..", "..", "..", "messages", "en.json"),
    ) as { VideoLabel: Record<string, string> }
    const code = withoutComments(source)
    return Object.values(catalog.VideoLabel).filter(
      (text) => code.includes(`"${text}"`) || code.includes(`'${text}'`),
    )
  }

  it("compares rawLabel with the SHORT_FILM kind", () => {
    expect(classifiesOnRawKind(readSource(...MODEL))).toBe(true)
  })

  it("flags the old display-text compare (negative control)", () => {
    const reverted = readSource(...MODEL).replace(
      /\.rawLabel\s*!==\s*"SHORT_FILM"/,
      '.label !== "Short film"',
    )
    expect(reverted).not.toBe(readSource(...MODEL))
    expect(classifiesOnRawKind(reverted)).toBe(false)
  })

  it("holds no English label text in the model or the label module", () => {
    expect(englishLabelLiterals(readSource(...MODEL))).toEqual([])
    expect(englishLabelLiterals(readSource(...VIDEO_LABEL))).toEqual([])
  })

  it("finds English label text in a source that has it (positive control)", () => {
    expect(englishLabelLiterals('if (x === "Short film") return')).toEqual([
      "Short film",
    ])
    expect(
      englishLabelLiterals("const u = 'https://x.test' === 'Video'"),
    ).toEqual(["Video"])
  })

  it("ignores label text in a comment (negative control)", () => {
    expect(
      englishLabelLiterals('/** turns it into "Video" */\n// "Short film"\n'),
    ).toEqual([])
  })
})
