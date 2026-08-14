/**
 * SOURCE-SHAPE guard on the watch route's player block (U6, part 4).
 *
 * The rest of that screen reaches Apollo, the downloads provider and
 * expo-router, so it has no render suite — and every rule below is a one-line
 * revert that compiles, typechecks and leaves the whole suite green while
 * putting a second decoder back on one video. The BEHAVIOUR these lines reach
 * is proved in `src/hooks/__tests__/useHostPlayback.test.tsx`.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

function routeSource(): string {
  return fs.readFileSync(path.join(__dirname, "..", "[slug].tsx"), "utf8")
}

describe("the watch route borrows the root host's player", () => {
  it("renders the injectable surface, never the self-owning player", () => {
    const source = routeSource()

    expect(source).toContain("<VideoPlayerSurface")
    expect(source).not.toContain("<VideoPlayer\n")
    expect(source).not.toContain("<VideoPlayer ")
  })

  it("imports the surface rather than the self-owning wrapper", () => {
    // The two live in one module, so an import-level slip is invisible in the
    // JSX above until the render reads `progressIdentity` again.
    const source = routeSource()

    expect(source).toContain(
      'import { VideoPlayerSurface } from "../../src/components/watch/VideoPlayer"',
    )
  })

  it("takes its player from useHostPlayback", () => {
    const source = routeSource()

    expect(source).toContain("useHostPlayback({")
    expect(source).toContain("player={hostPlayer.player}")
    expect(source).toContain("isPlaying={hostPlayer.isPlaying}")
  })

  it("wires onPlayingChange to the admission latch", () => {
    // It was literally `undefined` before, which is what made the session
    // unpublishable: nothing else on this screen sees the first frame play.
    const source = routeSource()

    expect(source).toContain("onPlayingChange={onPlayingChange}")
    expect(source).not.toContain("onPlayingChange={undefined}")
  })

  it("claims on decodedSlug, not on video.slug", () => {
    // The two diverge while a new slug's record loads, and the window's expand
    // target is the route param — a session keyed on the record's slug would
    // expand onto a route that publishes a different identity.
    const source = routeSource()
    const claim = source.slice(
      source.indexOf("const playbackClaim = useMemo("),
      source.indexOf("const { player: hostPlayer"),
    )

    expect(claim).toContain("videoSlug: decodedSlug")
    expect(claim).not.toContain("video?.slug")
    expect(claim).not.toContain("video.slug")
  })

  it("mounts exactly one player render site", () => {
    // The positive control: without it every check above passes on a file that
    // grew a second, self-owning player somewhere else on the screen.
    const source = routeSource()

    expect(source.split("<VideoPlayerSurface").length - 1).toBe(1)
    expect(source.split("useHostPlayback(").length - 1).toBe(1)
  })
})
