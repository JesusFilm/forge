/**
 * SOURCE-SHAPE guards for the RN 0.86 Android hero-compositing fixes: a
 * one-line revert compiles and stays green, and jest cannot see native
 * compositing, so these pin the props (videoPlayerAutostart convention).
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SURFACE_TYPE_LITERAL =
  'surfaceType={Platform.OS === "android" ? "textureView" : undefined}'

function readSource(...parts: string[]): string {
  return fs.readFileSync(path.join(__dirname, ...parts), "utf8")
}

/** Where prettier breaks the prop is its business, not the invariant's. No
 *  token inside the literal carries a space, so dropping them all is safe. */
function squish(source: string): string {
  return source.replace(/\s+/g, "")
}

/** The first VideoView element in a file, whitespace-normalized. */
function videoViewElement(source: string): string {
  const start = at(source, "<VideoView")
  return squish(source.slice(start, at(source, "/>", start)))
}

const SURFACE_TYPE = squish(SURFACE_TYPE_LITERAL)

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(source: string, marker: string, from = 0): number {
  const i = source.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

describe("Android VideoViews opt into textureView", () => {
  it("HomeHeroPager's hero VideoView carries the platform-conditional surfaceType", () => {
    expect(videoViewElement(readSource("..", "HomeHeroPager.tsx"))).toContain(
      SURFACE_TYPE,
    )
  })

  it("VideoHeroRenderer's VideoView carries the platform-conditional surfaceType", () => {
    expect(
      videoViewElement(
        readSource("..", "..", "sections", "VideoHeroRenderer.tsx"),
      ),
    ).toContain(SURFACE_TYPE)
  })

  // KTD7/KTD17: one root-owned view serves the full screen AND the floating
  // window, so the shrink can never swap surface classes mid-animation. The
  // window renders no video view of its own — this is the only one to pin.
  it("the playback host's single VideoView carries the platform-conditional surfaceType", () => {
    const source = readSource("..", "..", "watch", "PlaybackHost.tsx")
    expect(videoViewElement(source)).toContain(SURFACE_TYPE)
    expect(source.split("<VideoView")).toHaveLength(2)
  })

  it("the mini player window renders no video view of its own", () => {
    const source = readSource("..", "..", "watch", "MiniPlayerWindow.tsx")
    expect(source).not.toContain("<VideoView")
  })

  // The two viewer-initiated SDUI players (U9). They predate this guard by four
  // months and were simply never enumerated, so both shipped without the prop.
  // The video route draws a poster and a veil over its surface; the collection
  // route is overlapped by the floating mini-player window.
  it("the SDUI video route's VideoView carries the platform-conditional surfaceType", () => {
    const source = readSource(
      "..",
      "..",
      "..",
      "..",
      "app",
      "video",
      "[sectionKey].tsx",
    )
    expect(videoViewElement(source)).toContain(SURFACE_TYPE)
  })

  it("the SDUI collection route's VideoView carries the platform-conditional surfaceType", () => {
    const source = readSource(
      "..",
      "..",
      "..",
      "..",
      "app",
      "collection",
      "[sectionKey].tsx",
    )
    expect(videoViewElement(source)).toContain(SURFACE_TYPE)
  })
})

describe("Home RefreshControl stays transparent over the z-0 hero layer", () => {
  it("wires the RefreshControl to styles.refreshControl", () => {
    const source = readSource("..", "HomeScreen.tsx")
    const refreshControl = source.slice(
      at(source, "<RefreshControl"),
      at(source, "/>", at(source, "<RefreshControl")),
    )
    expect(refreshControl).toContain("style={styles.refreshControl}")
  })

  it("defines styles.refreshControl with a transparent background", () => {
    const source = readSource("..", "HomeScreen.tsx")
    const style = source.slice(
      at(source, "refreshControl: {"),
      at(source, "}", at(source, "refreshControl: {")),
    )
    expect(style).toContain('backgroundColor: "transparent"')
  })
})
