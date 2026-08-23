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
