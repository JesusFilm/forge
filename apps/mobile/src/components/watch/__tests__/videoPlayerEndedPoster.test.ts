/**
 * Ended → poster overlay (2026-08-18): reaching the end must not leave the
 * player on a (often black) last frame under the Replay chrome. SOURCE-SHAPE
 * assertions (apps/mobile has no component-render harness, KTD11): they pin
 * the wiring, not runtime behaviour.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "VideoPlayer.tsx"),
  "utf8",
)

describe("VideoPlayer ended poster", () => {
  it("latches ended on playToEnd and clears it when playback resumes", () => {
    expect(SOURCE).toContain(
      'player.addListener("playToEnd", () => setEnded(true))',
    )
    expect(SOURCE).toContain("if (isPlaying) setEnded(false)")
  })

  it("drops the poster when a paused seek leaves the end", () => {
    // Scrub/skip while ended emits no playingChange — only the position
    // watcher can release the overlay.
    expect(SOURCE).toContain("player.currentTime < d - 0.5")
  })

  it("reuses the poster layer for the ended state, with a cross-fade", () => {
    expect(SOURCE).toContain(
      "(!hasStarted || castRemoteActive || ended) && resolvedPoster != null",
    )
    // The fade is an OWNED Animated opacity: expo-image's `transition` is
    // skipped for a memory-cached source, so it cannot carry the cross-fade.
    expect(SOURCE).toContain("posterFade.setValue(0)")
    expect(SOURCE).toContain("Animated.timing(posterFade")
    expect(SOURCE).toContain("{ opacity: posterFade }")
    expect(SOURCE).not.toContain("transition={")
  })
})
