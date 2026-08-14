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

/** indexOf that fails loudly instead of yielding -1 into a slice. */
function at(source: string, marker: string, from = 0): number {
  const i = source.indexOf(marker, from)
  expect({ marker, found: i !== -1 }).toEqual({ marker, found: true })
  return i
}

describe("Android hero VideoViews opt into textureView", () => {
  it("HomeHeroPager's hero VideoView carries the platform-conditional surfaceType", () => {
    const source = readSource("..", "HomeHeroPager.tsx")
    const videoView = source.slice(
      at(source, "<VideoView"),
      at(source, "/>", at(source, "<VideoView")),
    )
    expect(videoView).toContain(SURFACE_TYPE_LITERAL)
  })

  it("VideoHeroRenderer's VideoView carries the platform-conditional surfaceType", () => {
    const source = readSource("..", "..", "sections", "VideoHeroRenderer.tsx")
    const videoView = source.slice(
      at(source, "<VideoView"),
      at(source, "/>", at(source, "<VideoView")),
    )
    expect(videoView).toContain(SURFACE_TYPE_LITERAL)
  })

  it("the floating mini player's VideoView carries it too", () => {
    // The window layers its poster and controls OVER the video, which is the
    // exact case an Android SurfaceView punches through.
    const source = readSource("..", "..", "watch", "MiniPlayerWindow.tsx")
    const videoView = source.slice(
      at(source, "<VideoView"),
      at(source, "/>", at(source, "<VideoView")),
    )
    expect(videoView).toContain(SURFACE_TYPE_LITERAL)
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
