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

  it("grows the fanned hand about its own centre, past its laid-out size", () => {
    // The growth is on the LIST, not on the cards: per-card growth costs
    // copy clearance proportional to card width (measured 16px -> -12px at
    // 1920), and scaling the list multiplies the gaps along with the cards.
    // Its origin is the list's centre, because the fan's pivot sits 190%
    // below each card and would lift the whole group out of its slot.
    const fan = blockBody(guard, ".watch-scroll-fan {")
    const hand = blockBody(guard, ".watch-scroll-fan-hand {")
    const lift = blockBody(css, "@keyframes watch-fan-lift")

    expect(fan).toContain("transform-origin: 50% 190%")
    expect(hand).toContain("transform-origin: 50% 50%")
    expect(hand).toContain("animation-timeline: view()")
    // Both halves of one motion must finish together.
    const range = /animation-range:([^;]+);/
    expect(hand.match(range)?.[1]).toBe(fan.match(range)?.[1])
    // The hand ends LARGER than it starts — that is the whole effect.
    const from = Number(lift.match(/from\s*\{\s*scale:\s*([\d.]+)/)?.[1])
    const to = Number(
      lift.match(/to\s*\{\s*scale:\s*var\(--fan-scale-end,\s*([\d.]+)/)?.[1],
    )
    expect(from).toBe(1)
    expect(to).toBeGreaterThan(1)
    // Measured ceiling: at 1.15 the grown hand reaches -2px at a 1920
    // viewport, i.e. the outer card is clipped by the page's `overflow-x`.
    expect(to).toBeLessThanOrEqual(1.12)
  })

  it("keeps the sticker pile larger than a stuck sticker", () => {
    // The pile is what you pick FROM, so it has to read as bigger than the
    // same sticker already spent on a card. Both ends derive from these two
    // numbers (see WhatsNewFeatureVote); a scale of 1 or less makes the pile
    // vanish into the board it feeds, and the class-level test in that
    // component's suite cannot see the value.
    const root = blockBody(css, ":root {")
    const stuck = root.match(/--watch-sticker-stuck:\s*([\d.]+)rem/)?.[1]
    const scale = Number(
      root.match(/--watch-sticker-pile-scale:\s*([\d.]+)/)?.[1],
    )

    expect(stuck).toBeDefined()
    expect(scale).toBeGreaterThan(1)
    // And not so far above it that the pile stops being a pile: at 6x it
    // was competing with the cards it sits under.
    expect(scale).toBeLessThanOrEqual(1.5)
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
