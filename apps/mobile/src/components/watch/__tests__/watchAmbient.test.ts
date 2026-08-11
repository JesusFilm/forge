/**
 * SOURCE-SHAPE assertions (apps/mobile has no component-render harness,
 * KTD11), so these pin structure, not appearance. Appearance was verified by
 * simulator screenshot.
 *
 * Each case below guards a regression that is SILENT — the layer still renders
 * and a screenshot still looks plausible, while the defect is a swallowed tap,
 * a banded gradient, or a status-bar contrast failure.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

const fs = require("node:fs")
const path = require("node:path")

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "WatchAmbient.tsx"),
  "utf8",
)
const ROUTE = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "..", "app", "watch", "[slug].tsx"),
  "utf8",
)

describe("WatchAmbient", () => {
  it("never intercepts touches", () => {
    // It spans the player and the top of the scroll view. Without this it
    // swallows every tap in that region — including the back button.
    expect(SOURCE).toContain('pointerEvents="none"')
  })

  it("is hidden from screen readers", () => {
    // Purely decorative: it has no content a screen reader should announce.
    expect(SOURCE).toContain("accessibilityElementsHidden")
    expect(SOURCE).toContain('importantForAccessibility="no-hide-descendants"')
  })

  it("builds gradient stops with hexToRgba, never the string transparent", () => {
    // Repo convention: "transparent" is rgba(0,0,0,0) and bands visibly when
    // it interpolates through a dark colour.
    expect(SOURCE).toContain("hexToRgba(BG_COLOR")
    expect(SOURCE).not.toContain('"transparent"')
  })

  it("keeps the wash under the status-bar contrast ceiling", () => {
    // The ONLY foreground over this strip is the white status-bar glyphs.
    // Above ~0.5 a bright poster drags them toward the 4.5:1 failure edge.
    const m = SOURCE.match(/AMBIENT_MAX_OPACITY = ([0-9.]+)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeLessThanOrEqual(0.5)
  })

  it("blurs the art, and keeps iOS well above Android", () => {
    // expo-image halves the iOS value internally, so equal numbers render as
    // a much weaker blur on iOS. Equalising them is the tempting wrong fix.
    expect(SOURCE).toContain("blurRadius={AMBIENT_BLUR}")
    const ios = Number(SOURCE.match(/"ios" \? ([0-9]+)/)![1])
    const android = Number(SOURCE.match(/"ios" \? [0-9]+ : ([0-9]+)/)![1])
    expect(ios).toBeGreaterThan(android)
  })

  it("cross-fades natively rather than with Animated", () => {
    // A looped Animated.sequence freezes after one pass on Fabric; expo-image's
    // own transition sidesteps that whole class.
    expect(SOURCE).toContain("transition={AMBIENT_FADE_MS}")
    expect(SOURCE).not.toContain("Animated")
  })

  it("mounts as a SIBLING of the player dock, not inside it", () => {
    // The dock carries paddingTop: insets.top. An absolutely-positioned child
    // is laid out against the padding box, so top:0 would land BELOW the strip
    // this layer exists to paint.
    const ambient = ROUTE.indexOf("<WatchAmbient")
    const dock = ROUTE.indexOf("Player pinned at route root")
    expect(ambient).toBeGreaterThan(-1)
    expect(dock).toBeGreaterThan(-1)
    expect(ambient).toBeLessThan(dock)
  })

  it("is dropped in fullscreen", () => {
    expect(ROUTE).toContain("{!isFullscreen && (")
  })
})
