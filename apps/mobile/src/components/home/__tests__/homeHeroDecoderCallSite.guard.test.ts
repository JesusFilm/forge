/**
 * SOURCE-SHAPE guard on HomeScreen's hero call site (U8, R9/R10).
 *
 * The predicate and the pager's mount gate are both proved behaviourally in
 * `homeHeroDecoder.test.tsx` — and BOTH stay green when HomeScreen simply
 * stops passing them. That revert is one line, it compiles, it typechecks, and
 * it puts a second decoder back under the floating window.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

function homeScreenSource(): string {
  return fs.readFileSync(path.join(__dirname, "..", "HomeScreen.tsx"), "utf8")
}

describe("HomeScreen yields the decoder to the mini player", () => {
  it("reads the session flag", () => {
    expect(homeScreenSource()).toContain(
      "const miniPlayerActive = useMiniPlayerActive()",
    )
  })

  it("composes it into the hero's paused predicate", () => {
    // Through the shared predicate, not a fourth inline `||`: the composition
    // is what has a test, and an inline one would not be the same expression.
    const source = homeScreenSource()

    expect(source).toContain("paused={heroPausedFor({")
    expect(source).toContain("scrolledAway: heroPaused,")
    expect(source).toContain("focused,")
    expect(source).toContain("miniPlayerActive,")
  })

  it("gates the hero's video view MOUNT, not only its transport", () => {
    // A paused player still holds its surface: `suspend()` never clears the
    // pager's videoReady latch, so pausing alone leaves the decoder held.
    expect(homeScreenSource()).toContain("videoSuppressed={miniPlayerActive}")
  })

  it("has exactly one hero call site", () => {
    // The positive control: without it the three checks above pass on a file
    // that grew a second, ungated HomeHeroPager somewhere else.
    const source = homeScreenSource()

    // The newline is load-bearing: `useRef<HomeHeroPagerHandle>` matches the
    // bare tag name too, and counting that as a render site hides a real one.
    expect(source.split("<HomeHeroPager\n").length - 1).toBe(1)
    expect(source.split("useMiniPlayerActive()").length - 1).toBe(1)
  })
})
