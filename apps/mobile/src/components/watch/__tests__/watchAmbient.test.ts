/**
 * SOURCE-SHAPE assertions, so these pin structure, not appearance. They
 * predate the component-render harness this app now has (apps/mobile/CLAUDE.md,
 * "Component render tests"). Appearance was verified by simulator screenshot.
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
    // The ceiling only binds if the constant actually drives the rendered
    // opacity. Without this, inlining `opacity: 0.9` leaves the constant
    // untouched and this test green while the ceiling is breached.
    expect(SOURCE).toMatch(/opacity: AMBIENT_MAX_OPACITY/)
  })

  it("composites the group offscreen before applying that opacity", () => {
    // ANDROID applies a ViewGroup's opacity to EACH CHILD unless the subtree is
    // composited offscreen first. This layer is exactly the shape that exposes
    // it — a group opacity over a poster with a gradient stacked on top — so
    // the gradient's OPAQUE tail blended over a dimmed poster instead of
    // covering it. The wash then never reached BG_COLOR and terminated in a
    // hard seam at the clipped bottom edge. Measured on the Pixel 9a with an
    // opaque magenta tail: #8a177f (poster leaking through) before, #810e7f
    // (exactly 45% magenta over BG_COLOR, i.e. nothing leaking) after.
    //
    // iOS composites correctly on its own and was byte-identical either way,
    // which is why this shipped unnoticed. Both halves are asserted: the prop
    // is only load-bearing while the layer still carries a group opacity.
    expect(SOURCE).toContain("needsOffscreenAlphaCompositing")
    expect(SOURCE).toMatch(/opacity: AMBIENT_MAX_OPACITY/)
  })

  it("blurs the art, and keeps iOS well above Android", () => {
    // expo-image halves the iOS value internally, so equal numbers render as
    // a much weaker blur on iOS. Equalising them is the tempting wrong fix.
    expect(SOURCE).toContain("blurRadius={AMBIENT_BLUR}")
    const ios = Number(SOURCE.match(/"ios" \? ([0-9]+)/)![1])
    const android = Number(SOURCE.match(/"ios" \? [0-9]+ : ([0-9]+)/)![1])
    expect(ios).toBeGreaterThan(android)
  })

  it("cross-fades the POSTER natively rather than with Animated", () => {
    // A looped Animated.sequence freezes after one pass on Fabric; expo-image's
    // own transition sidesteps that whole class.
    //
    // This assertion used to be a blanket `not.toContain("Animated")`. That was
    // too wide once the layer gained the play/pause fade, which is a single
    // Animated.timing — the SAFE form the repo rule explicitly allows. Narrowed
    // to the actual hazard so the Fabric trap stays covered: the poster's own
    // cross-fade must remain expo-image's, and no LOOPED sequence may appear.
    expect(SOURCE).toContain("transition={AMBIENT_FADE_MS}")
    expect(SOURCE).not.toContain("Animated.loop")
    expect(SOURCE).not.toContain("Animated.sequence")
  })

  it("retires the wash while the video plays, and brings it back on pause", () => {
    // The wash is POSTER-derived, so once playback moves past that frame it
    // stops describing what is on screen — and on a video with baked-in black
    // bars it frames them. It reads the one root player's state through the
    // module-scope store because the host is a `<Stack>` SIBLING: no context or
    // prop path reaches this layer.
    expect(SOURCE).toContain("usePlaybackPlaying")
    expect(SOURCE).toContain("PLAYING_OPACITY_MULTIPLIER")
  })

  it("seeds the fade from the CURRENT play state, never from a literal", () => {
    // A screen can mount while the video is already playing — leaving fullscreen
    // drops this layer and remounts it, and the mini player expands into a fresh
    // route. Seeding at a constant made those mounts re-present the wash and
    // fade it out again over the full PLAY_FADE_MS, which is the glitch the slow
    // ramp exists to avoid.
    //
    // Reads the seed EXPRESSION rather than a fixed spelling, so extracting it
    // to a named value stays green while a literal still fails.
    const seeded = SOURCE.match(/new Animated\.Value\(([^)]*)\)/)
    expect(seeded).not.toBeNull()
    const arg = seeded![1].trim()
    expect(arg).not.toMatch(/^[0-9.]+$/)
    expect(SOURCE).toMatch(new RegExp(`const ${arg}\\s*=\\s*playing \\?`))
  })

  it("ramps that fade slowly enough to read as deliberate", () => {
    // A quick dip beside a moving video reads as a glitch. Pinned as a FLOOR,
    // not an exact value, so the duration stays tunable without churning this.
    const m = SOURCE.match(/PLAY_FADE_MS = (\d+)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(2000)
  })

  it("animates its own node, never the one carrying the contrast ceiling", () => {
    // The killer regression: a second `opacity` in the SAME style array as
    // `opacity: AMBIENT_MAX_OPACITY` wins, silently discarding the status-bar
    // contrast ceiling while the ceiling's own guard above stays green — the
    // constant is still present, just overridden.
    //
    // Positive half first, so the negative below cannot pass vacuously by the
    // fade having been deleted outright.
    expect(SOURCE).toMatch(/StyleSheet\.absoluteFill, \{ opacity: playFade \}/)
    expect(SOURCE).not.toMatch(/styles\.root[^\]]*opacity: playFade/)
    // ...and the ceiling must still sit on the group, which is also the node
    // that needs Android's offscreen compositing for its two children.
    expect(SOURCE).toMatch(/root: \{[\s\S]*?opacity: AMBIENT_MAX_OPACITY/)
    expect(SOURCE).toMatch(
      /needsOffscreenAlphaCompositing[\s\S]{0,120}style=\{styles\.root\}/,
    )
  })

  it("hands over to BLACK, so letterbox bars sit on their own colour", () => {
    // Handing over to BG_COLOR instead would leave the bars ~28 levels darker
    // than their surround — quieter than the poster wash, but still a visible
    // sandwich on a 2.39:1 video. Pure black is what the bars actually are.
    expect(SOURCE).toContain("BLACK_FADE_COLORS")
    expect(SOURCE).toMatch(/BLACK_FADE_COLORS = \[BLACK, BLACK, BG_COLOR\]/)
  })

  it("dissolves that black into BG_COLOR instead of ending it on the edge", () => {
    // An opaque band that stops ON the clipped bottom edge is exactly the seam
    // this layer was already fixed for once (the Android per-child alpha bug).
    // The black therefore holds to the player's bottom and ramps across the
    // bleed — and that midpoint is DERIVED, because the inset and the screen
    // width both move it. A hard-coded fraction would be wrong on most devices.
    expect(SOURCE).toMatch(
      /blackLocations = \[[\s\S]*?topInset \+ playerHeight/,
    )
    expect(SOURCE).toMatch(/locations=\{blackLocations\}/)
  })

  it("drives both layers from ONE value, so they cannot both be up", () => {
    // Two independent animations would let a slow device show the wash and the
    // black together (too dark) or neither (a flash of the page behind).
    expect(SOURCE).toMatch(
      /opacity: playFade\.interpolate\(\{[\s\S]*?outputRange: \[1, 0\]/,
    )
  })

  it("mounts as a SIBLING of the player dock, not inside it", () => {
    // The dock carries paddingTop: insets.top. An absolutely-positioned child
    // is laid out against the padding box, so top:0 would land BELOW the strip
    // this layer exists to paint.
    //
    // Compares INDENTATION, not string offsets. Offsets only prove which text
    // comes first, so nesting the layer inside a new wrapper emitted above the
    // dock would keep an ordering assertion green while breaking this rule.
    const lines = ROUTE.split("\n")
    const indent = (i: number) => lines[i].length - lines[i].trimStart().length

    const ambientAt = lines.findIndex((l: string) =>
      l.includes("<WatchAmbient"),
    )
    expect(ambientAt).toBeGreaterThan(-1)
    let guardAt = ambientAt
    while (guardAt >= 0 && !lines[guardAt].includes("{!isFullscreen && (")) {
      guardAt -= 1
    }
    expect(guardAt).toBeGreaterThan(-1)

    const dockCommentAt = lines.findIndex((l: string) =>
      l.includes("Player pinned at route root"),
    )
    expect(dockCommentAt).toBeGreaterThan(-1)
    let dockTagAt = dockCommentAt
    while (
      dockTagAt < lines.length &&
      !lines[dockTagAt].trimStart().startsWith("<View")
    ) {
      dockTagAt += 1
    }
    expect(dockTagAt).toBeLessThan(lines.length)

    // Same nesting depth == siblings.
    expect(indent(guardAt)).toBe(indent(dockTagAt))
  })

  it("is dropped in fullscreen", () => {
    expect(ROUTE).toContain("{!isFullscreen && (")
  })
})
