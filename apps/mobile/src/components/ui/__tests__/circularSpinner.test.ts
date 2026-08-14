/**
 * SOURCE-SHAPE assertions (apps/mobile has no component-render harness,
 * KTD11), so these pin structure, not motion. The spin itself was verified by
 * comparing simulator frames — a static read cannot see an animation.
 *
 * What makes them worth having anyway: both failure modes below are SILENT on
 * Fabric. The ring still renders, so a screenshot looks correct while the
 * animation is frozen or never paints.
 * See docs — apps/mobile/src/hooks/useShimmerOpacity.ts carries the same pair.
 */

// Superseded 2026-08-15: apps/mobile HAS a component-render harness now — see
// apps/mobile/CLAUDE.md "Component render tests". The assertions below still
// stand; only the "no harness" reason above is stale.

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "CircularSpinner.tsx"),
  "utf8",
)

describe("CircularSpinner", () => {
  it("loops a single timing, never a sequence", () => {
    // Animated.loop(Animated.sequence([...])) runs ONCE and freezes on this
    // build. The frozen ring still renders, so nothing looks broken in a
    // screenshot — only live frames reveal it.
    expect(SOURCE).toContain("Animated.loop(")
    // Anchored on the SHARED identifier, not on the two calls existing
    // separately: timing a different Animated.Value than the one `rotate`
    // interpolates satisfies every other assertion here while the ring never
    // moves — the same silent failure this suite exists to catch.
    expect(SOURCE).toMatch(/Animated\.timing\(progress,/)
    expect(SOURCE).toMatch(/rotate = useRef\(\s*progress\.interpolate/)
    // Match the CALL, not the name: the component's own comment explains the
    // trap by naming Animated.sequence, and a bare name check flags that prose.
    expect(SOURCE).not.toContain("Animated.sequence(")
  })

  it("stays on the native driver", () => {
    // The JS driver does not update the view AT ALL on this build.
    expect(SOURCE).toContain("useNativeDriver: true")
    expect(SOURCE).not.toContain("useNativeDriver: false")
  })

  it("stops the loop on unmount", () => {
    expect(SOURCE).toContain("return () => loop.stop()")
  })

  it("draws a ring with one bright arc, not a filled circle", () => {
    // borderTopColor over a dimmer borderColor IS the arc; losing either turns
    // the indicator into a plain circle that reads as a dot, not progress.
    expect(SOURCE).toContain("borderTopColor: color")
    expect(SOURCE).toContain("hexToRgba(color, TRACK_ALPHA)")
    expect(SOURCE).toContain("borderRadius: size / 2")
  })
})
