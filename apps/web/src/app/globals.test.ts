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

    expect(rule).toContain("animation-name: watch-scroll-beat-lead")
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
