/**
 * A download is one dub: SOURCE-SHAPE assertions over the two routes that wire
 * the store's committed copy into playback and into the language sheet (the
 * watchScreenCastWiring.test.ts pattern). The pure decisions live in
 * playerSource.test.ts; what no render suite reaches is whether the routes
 * still feed them the real identities. A one-line revert at either call site
 * (`offlineDubDocumentId: null`, `if (offlineSource)`, dropping the sheet
 * prop) type-checks and leaves every behavioural suite green.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const APP = path.join(__dirname, "..", "..", "..", "..", "app", "watch")
const WATCH = fs.readFileSync(path.join(APP, "[slug].tsx"), "utf8")
const LANGUAGE = fs.readFileSync(path.join(APP, "language.tsx"), "utf8")

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(source: string, marker: string, from = 0): number {
  const i = source.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

describe("watch screen offline-dub wiring", () => {
  it("reads the committed copy under the record's slug, the download sheet's key", () => {
    expect(WATCH).toContain("const offlineSlug = video?.slug ?? decodedSlug")
    expect(WATCH).toContain("committedCopyFor(offlineSlug)")
    expect(WATCH).not.toContain("committedCopyFor(decodedSlug)")
  })

  it("feeds the resolver BOTH dub identities from the live values", () => {
    const start = at(WATCH, "const playerSource = resolvePlayerSource({")
    const call = WATCH.slice(start, at(WATCH, "})", start))
    expect(call).toContain("offlineDubDocumentId: offlineCopy?.dubDocumentId")
    expect(call).toContain("activeVariantDocumentId: activeVariant?.documentId")
    expect(call).toContain("variantSettled: activeVariant != null")
    // The reverts that restore the reported bug with every suite green.
    expect(call).not.toMatch(/offlineDubDocumentId:\s*null/)
    expect(call).not.toMatch(/activeVariantDocumentId:\s*null/)
  })

  it("derives playingOffline from the RESOLVED source and branches subtitles on it", () => {
    expect(WATCH).toContain(
      "const playingOffline = playerSource != null && playerSource === offlineSource",
    )
    const memo = at(WATCH, "const subtitleVttSrc = useMemo(() => {")
    const body = WATCH.slice(memo, at(WATCH, "}, [", memo))
    expect(body).toContain("if (playingOffline) return")
    expect(body).not.toContain("if (offlineSource)")
  })
})

describe("language sheet offline-dub wiring", () => {
  it("marks the dub of the committed copy, read under the record's slug", () => {
    const read = at(LANGUAGE, "committedCopyFor(video.slug)?.dubDocumentId")
    const gate = at(LANGUAGE, "downloadsReady")
    expect(gate).toBeLessThan(read)
    const sheet = at(LANGUAGE, "<LanguageSheetContent")
    const props = LANGUAGE.slice(sheet, at(LANGUAGE, "/>", sheet))
    expect(props).toContain("downloadedDubDocumentId={downloadedDubDocumentId}")
  })
})
