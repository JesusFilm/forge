/**
 * @vitest-environment node
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const css = readFileSync(join(__dirname, "globals.css"), "utf-8")

/** Return the body of the first block whose header contains `needle`. */
function blockBody(source: string, needle: string): string {
  const header = source.indexOf(needle)
  if (header === -1) return ""
  const open = source.indexOf("{", header)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1
    if (source[i] === "}") {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return ""
}

describe("scroll-driven timeline choreography", () => {
  const guard = blockBody(css, "@supports (animation-timeline: view())")

  it("guards the whole choreography behind feature support", () => {
    expect(guard).not.toBe("")
    expect(guard).toContain("prefers-reduced-motion: no-preference")
  })

  it("declares no .watch-scroll rule outside that guard", () => {
    // LOAD-BEARING. These rules attach `animation: ... both`, whose
    // keyframes start at `opacity: 0`. A rule that escapes the guard can
    // leave a card, a beat, or the whole rail permanently invisible in a
    // browser without scroll-driven animations — a blank section that no
    // JSDOM test and no build step would catch.
    const all = [...css.matchAll(/\.watch-scroll-[a-z-]+\s*\{/g)].length
    const guarded = [...guard.matchAll(/\.watch-scroll-[a-z-]+\s*\{/g)].length

    expect(all).toBeGreaterThan(0)
    expect(guarded).toBe(all)
  })

  it("slides an incoming card in without an opacity ramp", () => {
    // A translucent card mid-travel shows the photograph underneath it.
    // `.watch-scroll-clip` on the card's wrapper is what hides it until it
    // arrives, so the keyframes must move it and nothing else.
    const slide = blockBody(css, "@keyframes watch-scroll-slide-in")

    expect(slide).toContain("translate:")
    expect(slide).not.toContain("opacity")
  })

  it("attaches every choreographed class to the view timeline", () => {
    // Anti-vacuous companion: a class sitting inside the guard with no
    // `animation-timeline` would satisfy the check above while animating
    // on the document timeline the moment the page loads.
    for (const name of [
      "watch-scroll-card",
      "watch-scroll-beat",
      "watch-scroll-media",
      "watch-scroll-node",
      "watch-scroll-rail",
    ]) {
      const rule = blockBody(guard, `.${name} {`)
      expect(rule, name).toContain("animation-timeline: view()")
      expect(rule, name).toContain("animation-range:")
    }
  })

  it("stops every grain layer under reduced motion, texture intact", () => {
    const reduced = blockBody(css, "prefers-reduced-motion: reduce")
    const grainRule = blockBody(reduced, ".watch-grain,")

    // All three layers, not just the first — a layer added later that is
    // left off this selector list keeps jittering for a reader who asked
    // for less motion, and nothing else would catch it.
    for (const layer of [".watch-grain,", ".watch-grain-fine"]) {
      expect(reduced, layer).toContain(layer)
    }
    expect(grainRule).toContain("animation: none")
    // The texture itself is not in the reduce block — only the motion is.
    expect(grainRule).not.toContain("background-image")
  })

  it("declares a grain layer for every class the page renders", () => {
    for (const name of ["watch-grain", "watch-grain-fine"]) {
      const rule = blockBody(css, `.${name} {`)
      expect(rule, name).toContain("background-image")
      expect(rule, name).toContain("steps(1, end) infinite")
      expect(rule, name).toContain("pointer-events: none")
    }
  })

  it("orders the fan's breakpoint override after the rule it overrides", () => {
    // The bundler flattens nested media queries and keeps source order.
    // Written above the base rule, this override loses the specificity tie
    // at every width and silently does nothing — which is exactly what
    // happened: the wide-viewport travel never applied and the cards
    // stopped overlapping.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const base = guard.indexOf("--fan-travel: 4rem")
    const override = guard.indexOf("--fan-travel: 4.5rem")

    expect(base).toBeGreaterThan(-1)
    expect(override).toBeGreaterThan(-1)
    expect(override).toBeGreaterThan(base)
  })

  it("never clips the stage, which would shear the full-bleed card", () => {
    // Measured, not reasoned: the stage's box sits inside the content rail,
    // so any overflow on it cuts 96px off each side of the opening card and
    // leaves black strips down both edges of an effect whose whole point is
    // to reach the viewport edges. `hidden` is worse still — it makes the
    // stage a scroll container and the pin's sticky never engages. The card
    // is bounded by the stage's top margin instead.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-stage {")

    expect(rule).not.toContain("overflow")
  })

  it("drops the lifted lead layer back to its own depth", () => {
    // The lead layer is raised over its siblings for the length of the zoom
    // so their clip-box shadows cannot draw a seam across the full-screen
    // photograph. It has to come back down: the pile is built bottom-up, so
    // a lead layer left on top would sit over every card that lands on it.
    const frames = blockBody(css, "@keyframes watch-scroll-intro-front")

    expect(frames).toContain("z-index: 30")
    expect(frames).toMatch(/100%\s*\{\s*z-index:\s*var\(--layer\)/)
  })

  it("opens the lead beat at full opacity, not faded out", () => {
    // Every other beat fades up as its card arrives. The lead beat is part
    // of the opening frame instead — it sits over the full-screen
    // photograph from the first pixel — so its keyframes must START opaque.
    // Reusing the cycle here leaves the opening composition wordless.
    const lead = blockBody(css, "@keyframes watch-scroll-beat-lead")
    const cycle = blockBody(css, "@keyframes watch-scroll-beat-cycle")

    expect(lead).toMatch(/0%,\s*\d+%\s*\{\s*opacity:\s*1/)
    expect(cycle).toMatch(/0%\s*\{\s*opacity:\s*0/)
    // …and it still gets out of the way for the card that comes for it.
    expect(lead).toMatch(/100%\s*\{\s*opacity:\s*0/)

    // The wiring, not just the shape. Asserting only on the keyframes lets
    // the rule be repointed at the cycle — which is the production defect,
    // and left this test green when it was tried.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-beatbox-lead {")

    expect(rule).toContain("watch-scroll-beat-lead")
    expect(rule).not.toContain("watch-scroll-beat-cycle")
  })

  it("runs the lead beat's weight over the zoom, not over its own slice", () => {
    // The beat carries two tracks on different ranges: hold-then-fade
    // belongs to the era's slice, weight and shadow to the opening zoom.
    // Collapsed onto one range, the paragraph would still be at its heavy
    // opening weight long after the photograph it was heavy FOR has gone.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-beatbox-lead {")

    expect(rule).toContain("watch-scroll-beat-weight")
    expect(rule).toContain(
      "animation-range: var(--beat-range), var(--intro-range)",
    )
    // Both tracks need a timeline; one entry drives only the first.
    expect(rule).toContain(
      "animation-timeline: --watch-era-stage, --watch-era-stage",
    )
  })

  it("eases the lead beat from a heavier weight that cannot re-wrap it", () => {
    // Measured: the paragraph re-wraps at weight 600 on every viewport at
    // or below 1024px, and gains a line at 700. Because this interpolates
    // during a scroll, a weight that re-wraps makes the lines jump under
    // the reader mid-zoom — so the opening weight is capped at 500.
    const frames = blockBody(css, "@keyframes watch-scroll-beat-weight")
    const opening = Number(
      frames.match(/from\s*\{[^}]*font-weight:\s*(\d+)/)?.[1],
    )
    const resting = Number(
      frames.match(/to\s*\{[^}]*font-weight:\s*(\d+)/)?.[1],
    )

    expect(opening).toBeGreaterThan(resting)
    expect(opening).toBeLessThanOrEqual(500)
    // `font-light` is the resting design; landing anywhere else leaves the
    // beat permanently off-weight, since the fill holds the last frame.
    expect(resting).toBe(300)
    // And the halo goes with it: over the black page it only muddies.
    expect(frames).toMatch(/to\s*\{[\s\S]*rgb\(0 0 0 \/ 0\)/)
  })

  it("sizes the opening photograph from the viewport, capped at the card", () => {
    // The card is far wider than the screen while it fills it, so a
    // card-filling box pushes ~40% of the picture off both sides. The box is
    // the VIEWPORT width instead, divided back out by the zoom — and capped
    // at the card's own footprint so the landed frame is unchanged. Drop the
    // cap and the landed card shows a crop it never used to.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-intro-photo {")

    expect(rule).toMatch(
      /width:\s*min\(\s*calc\(100vw \/ var\(--era-zoom\)\)\s*,\s*100%\s*\)/,
    )
  })

  it("lands the opening photograph on its card, not on the screen", () => {
    // Height and vertical centre have DIFFERENT right answers at the two
    // ends, so both are animated between them rather than computed once.
    // A single value correct at the opening frame is wrong at the landed one:
    // reading the screen's centre there pushed the picture 239px down inside
    // its own card, and taking the height from the viewport left it 96px
    // short of the card top and bottom on a tall window. Both shipped.
    const frames = blockBody(css, "@keyframes watch-scroll-intro-photo")
    const from = frames.slice(0, frames.indexOf("to {"))
    const to = frames.slice(frames.indexOf("to {"))

    // Opening: screen-centred, at the picture's own aspect — read from the
    // picture, never hard-coded here.
    expect(from).toContain("50svh")
    expect(from).toMatch(/height:\s*calc\(100vw \/ var\(--photo-aspect\)/)
    // Landed: the card's own box, exactly.
    expect(to).toMatch(/top:\s*50%\s*;/)
    expect(to).toMatch(/height:\s*100%\s*;/)

    // …and it is actually wired to the zoom's range, or neither end applies.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-intro-photo {")

    expect(rule).toContain("animation: watch-scroll-intro-photo")
    expect(rule).toContain("animation-range: var(--intro-range)")
  })

  it("keeps the opening zoom inside the pinned breakpoint", () => {
    // The veil and the caption fade start at `opacity: 0`. Below the
    // pinned breakpoint the stage declares no `--watch-era-stage`
    // timeline, so these would be animations with nothing to drive them —
    // the year rail and the lead card's caption riding on whether an
    // inactive timeline suppresses its own effect. Scope them instead.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const pinned = blockBody(guard, "@media (width >= 48rem)")

    expect(pinned).not.toBe("")
    for (const name of [
      "watch-scroll-intro",
      "watch-scroll-intro-front",
      "watch-scroll-intro-veil",
      "watch-scroll-intro-caption",
    ]) {
      const rule = blockBody(pinned, `.${name} {`)
      expect(rule, name).toContain("animation-timeline: --watch-era-stage")
      expect(rule, name).toContain("animation-range: var(--intro-range)")
    }
  })

  it("scales the opening zoom from the viewport, not from a guessed number", () => {
    // A hard-coded scale is right at one viewport height and wrong at
    // every other: too small leaves a strip of page showing around the
    // photograph, too large crops it to nothing. The trig pair is CSS
    // dividing two lengths into a bare number.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-intro {")

    expect(rule).toContain("100svh")
    expect(rule).toContain("atan2(")
    // Both axes: short viewports are bound by height, ultrawide ones by
    // the fixed content rail.
    expect(rule).toContain("100vw")
  })

  it("draws each grain tile at the size its noise was authored for", () => {
    // MEASURED. `baseFrequency` is per user unit, so rendering an N-unit
    // noise field into a box that is not N pixels scales the grain with the
    // box. The old `fine` layer asked for a 160-unit field at 74px and got
    // 0.5px blobs, which average to flat grey — a layer that cost paint and
    // contributed nothing. Authored size and background-size must match.
    const declared = (name: string) =>
      Number(
        css.match(
          new RegExp(`--watch-grain-image${name}:[^;]*width='(\\d+)'`),
        )?.[1],
      )
    const drawn = (selector: string) =>
      Number(blockBody(css, selector).match(/background-size:\s*(\d+)px/)?.[1])

    // Both halves: the size the rule draws at, AND that it draws the image
    // that size was authored for. Comparing only the numbers lets the fine
    // layer be repointed at the coarse image — which IS the mush bug, and
    // left this test green when it was tried.
    for (const [selector, suffix] of [
      [".watch-grain {", ""],
      [".watch-grain-fine {", "-fine"],
    ] as const) {
      const rule = blockBody(css, selector)
      expect(rule, selector).toContain(
        `background-image: var(--watch-grain-image${suffix})`,
      )
      expect(drawn(selector), selector).toBe(declared(suffix))
    }
    // …and the two images are genuinely different fields, not one size twice.
    expect(declared("")).not.toBe(declared("-fine"))
  })

  it("keeps the two grain tiles from repeating in step", () => {
    // Two layers only hide each other's repeat if their periods do not line
    // up. The old pair was 150 and 74 — within 1.5% of 2:1 — so they
    // reinforced every other tile and the pattern read as one 150px block.
    const coarse = Number(
      blockBody(css, ".watch-grain {").match(/background-size:\s*(\d+)px/)?.[1],
    )
    const fine = Number(
      blockBody(css, ".watch-grain-fine {").match(
        /background-size:\s*(\d+)px/,
      )?.[1],
    )
    const ratio = coarse / fine

    // Far from every simple ratio up to 3:1, in either direction.
    for (const simple of [1, 1.25, 1.333, 1.5, 2, 2.5, 3]) {
      expect(
        Math.abs(ratio - simple),
        `ratio ${ratio} vs ${simple}`,
      ).toBeGreaterThan(0.08)
    }
    // …and big enough that a screen holds only a couple of copies.
    expect(Math.min(coarse, fine)).toBeGreaterThan(300)
  })

  it("does not divide the grain tile by the zoom", () => {
    // MEASURED, and a reversal: the grain is rastered in the card's own
    // coordinate space and then GPU-scaled with it, so dividing the tile down
    // only asks for sub-pixel noise that averages to mush BEFORE the upscale.
    // It measured 3px soft blobs at the opening frame against 1px crisp
    // landed, and doubled the repeats across the screen at the same time.
    for (const selector of [".watch-grain {", ".watch-grain-fine {"]) {
      const rule = blockBody(css, selector)
      expect(rule, selector).not.toContain("--era-zoom")
    }
  })

  it("registers the zoom mirror so it can interpolate and be inherited", () => {
    // Unregistered, a custom property animates in discrete jumps — the tile
    // would snap between two sizes instead of holding one. And the grain
    // reads it from an ancestor, so it has to inherit. The 1 default is what
    // keeps every layer outside a zooming card dividing by nothing.
    const rule = blockBody(css, "@property --era-zoom")

    expect(rule).toContain('syntax: "<number>"')
    expect(rule).toContain("inherits: true")
    expect(rule).toContain("initial-value: 1")
  })

  it("keeps the zoom mirror tracking the scale it mirrors", () => {
    // `scale` and `--era-zoom` are animated as separate declarations, so
    // nothing but this stops them drifting apart — and a mirror that lags
    // the real scale mis-sizes the tile by exactly that difference.
    const frames = blockBody(css, "@keyframes watch-scroll-intro")
    const from = frames.slice(0, frames.indexOf("to {"))
    const to = frames.slice(frames.indexOf("to {"))

    expect(from).toMatch(/scale:\s*var\(--intro-scale[^)]*\)/)
    expect(from).toMatch(/--era-zoom:\s*var\(--intro-scale[^)]*\)/)
    // Anchored on the terminator: an unanchored `1` also matches `1.4`,
    // which is exactly the drift this is here to catch.
    expect(to).toMatch(/scale:\s*1\s*;/)
    expect(to).toMatch(/--era-zoom:\s*1\s*;/)
  })

  it("gives a reduced-motion reader the same grain strength as everyone else", () => {
    // The flicker animates the coarse layer's opacity, and reduced motion
    // switches it off — so the static value is what those readers actually
    // see. It has to sit at the flicker's MEAN. It used to be 0.72 against a
    // flicker that never exceeded 0.68, which handed the readers who asked
    // for less the strongest grain on the page.
    const flicker = blockBody(css, "@keyframes watch-grain-flicker")
    const frames = [...flicker.matchAll(/opacity:\s*([\d.]+)/g)].map((m) =>
      Number(m[1]),
    )
    // The last keyframe repeats the first; counting it would skew the mean.
    const cycle = frames.slice(0, -1)
    const mean = cycle.reduce((a, b) => a + b, 0) / cycle.length
    const still = Number(
      blockBody(css, ".watch-grain {").match(/opacity:\s*([\d.]+)/)?.[1],
    )

    expect(cycle.length).toBeGreaterThan(4)
    expect(still).toBeCloseTo(mean, 2)
  })

  it("keeps the grain loops from realigning into a visible pattern", () => {
    // Drift and density run as two animations with non-harmonic periods.
    // Equal or multiple durations would resync every cycle and the grain
    // would read as a short looping clip rather than film.
    const rule = blockBody(css, ".watch-grain {")
    const periods = [...rule.matchAll(/(\d+)ms/g)].map((m) => Number(m[1]))

    expect(periods).toHaveLength(2)
    const [a, b] = periods
    expect(a % b === 0 || b % a === 0).toBe(false)
    // …and slow enough to read as grain, not static.
    for (const period of periods) expect(period).toBeGreaterThan(1200)
  })
})
