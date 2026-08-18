/**
 * VideoPlayer's ended-poster RENDER SITE. The state machine itself is covered
 * behaviourally in src/hooks/__tests__/useEndedPosterFade.test.tsx; this file
 * only pins the wiring that a hook test cannot see, because apps/mobile has no
 * render harness for VideoPlayer itself (KTD11).
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const PLAYER = fs.readFileSync(
  path.join(__dirname, "..", "VideoPlayer.tsx"),
  "utf8",
)

describe("VideoPlayer ended poster rendering", () => {
  it("takes both values from the hook, keeping no local copy", () => {
    expect(PLAYER).toContain(
      "const { ended, posterFade } = useEndedPosterFade(player, isPlaying)",
    )
    // A second source of truth here would drift from the hook's latch.
    expect(PLAYER).not.toMatch(/const \[ended, setEnded\]/)
  })

  it("reuses the one poster layer for the ended state", () => {
    expect(PLAYER).toContain(
      "(!hasStarted || castRemoteActive || ended) && resolvedPoster != null",
    )
    expect(PLAYER).toContain("{ opacity: posterFade }")
  })

  it("does not fall back to expo-image's own transition", () => {
    // It is skipped for a memory-cached source, and the pre-start render has
    // already cached this exact poster — which is why the fade is owned.
    expect(PLAYER).not.toContain("transition={")
  })
})
