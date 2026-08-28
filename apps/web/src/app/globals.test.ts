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

  it("never transforms a grid tile, only fades it", () => {
    // A cell's side rules are drawn by its NEIGHBOUR, so a cell that
    // translates or scales slides out from under a rule that has not
    // moved and opens a visible strip. Pointing this back at
    // `watch-scroll-rise` — the obvious thing to reach for, and what it
    // used to use — reopens a 6.47px gap.
    const tile = blockBody(guard, ".watch-scroll-card {")
    expect(tile).toContain("watch-scroll-tile-in")
    expect(tile).not.toContain("watch-scroll-rise")
    expect(blockBody(css, "@keyframes watch-scroll-tile-in")).not.toContain(
      "transform",
    )
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

  it("covers the screen from the picture's top-right corner", () => {
    // The two edges that must never crop are pinned, because the projection
    // screen — the subject of the frame — sits in the picture's top-right.
    // Everything else travels; see the keyframes.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-intro-photo {")

    expect(rule).toMatch(/top:\s*0;/)
    expect(rule).toMatch(/left:\s*auto;/)
    expect(rule).toMatch(/translate:\s*none;/)
    // Anchoring to the card's top means covering has to reach this much
    // further down than the viewport is tall.
    expect(rule).toMatch(/--intro-overhang:\s*\d+px;/)
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

    // Opening: top edge flush with the top of the CARD, at the picture's own
    // aspect — read from the picture, never hard-coded here. The centre is
    // exactly half a rendered height down, so `50vw / aspect` with nothing
    // added to it.
    //
    // Neither of the two things tried before it: `50svh` centred the picture
    // on the screen, which split the letterbox and stacked its upper half
    // under the page's own dark band. Adding `39px` made it flush with the
    // SCREEN instead, which left those same 39px — the distance the scaled
    // card reaches above the viewport — showing as a band of card background
    // and grain for the whole approach, while the card's top edge was still
    // on screen.
    // Comments stripped first: they name the rejected values and even
    // contain the words "top: 0", so matching over the raw block text hits
    // the prose explaining the fix rather than the fix itself.
    const opening = from.replace(/\/\*[\s\S]*?\*\//g, "")

    // Sized by `max()` on both axes so it COVERS rather than fits, and
    // offset from the right so the crop falls on the left. Fitting the width
    // instead left the picture short of the height on anything wider than the
    // photograph, and letterboxed it on anything narrower.
    expect(opening).toMatch(/width:\s*calc\(\s*max\(100vw,/)
    expect(opening).toMatch(
      /height:\s*calc\(\s*max\(100vw \/ var\(--photo-aspect\)/,
    )
    expect(opening).toMatch(
      /right:\s*calc\(50% - 50vw \/ var\(--intro-scale\)\)/,
    )
    // Not screen-centred, and not left-anchored: both were tried and both
    // cropped or banded the picture in a way that hid the projection screen.
    expect(opening).not.toMatch(/left:\s*50%/)
    // Landed: the card's own box, exactly.
    expect(to).toMatch(/right:\s*0\s*;/)
    expect(to).toMatch(/width:\s*100%\s*;/)
    expect(to).toMatch(/height:\s*100%\s*;/)

    // …and it is actually wired to the zoom's range, or neither end applies.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-intro-photo {")

    expect(rule).toContain("animation: watch-scroll-intro-photo")
    expect(rule).toContain("animation-range: var(--intro-range)")
  })

  it("fades the lead card's outline in to the colour the card already uses", () => {
    // The outline is real chrome — it separates the cards once they stack —
    // so every card keeps it. Only the lead card holds its own back, because
    // while it is scaled wider than the screen its top edge draws a hairline
    // clear across the viewport above the photograph.
    //
    // The keyframe's `to` colour is duplicated from the card's Tailwind class
    // and the fill holds it for the rest of the page, so the two are tied
    // here across files. Changing the class alone would leave the lead card a
    // different shade from its siblings for good.
    const component = readFileSync(
      join(__dirname, "../components/whats-new/WatchWhatsNewPage.tsx"),
      "utf-8",
    )
    // Scoped to the era card's own expression: a bare `border-white/\d+`
    // match takes the first one anywhere in the file, which is a different
    // element's border and a different alpha.
    const classAlpha = component.match(
      /border-red-100\/\d+"\s*:\s*"border-white\/(\d+)/,
    )?.[1]
    const frames = blockBody(css, "@keyframes watch-scroll-intro-edge")
    const toAlpha = frames
      .slice(frames.indexOf("to {"))
      .match(/rgb\(255 255 255 \/ ([\d.]+)\)/)?.[1]

    expect(classAlpha).toBeDefined()
    expect(toAlpha).toBeDefined()
    expect(Number(toAlpha)).toBeCloseTo(Number(classAlpha) / 100, 4)
    // …and it starts invisible, which is the whole point.
    expect(frames.slice(0, frames.indexOf("to {"))).toContain("transparent")
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

  it("drives the transcript reel at every width, not only the pinned one", () => {
    // The inverse of the test above, and a bug that shipped. Every other
    // rule in this block is scoped to `>= 48rem` because the era stack
    // needs desktop room. The transcript does not: below that breakpoint
    // the phone still pins, and if the rule is scoped with its neighbours
    // the reel silently never runs on a phone — the reader arrives on a
    // static transcript. Nothing else fails when that happens, because
    // `translateY(0)` is a legitimate resting state.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const pinned = blockBody(guard, "@media (width >= 48rem)")
    const rule = blockBody(guard, ".watch-scroll-chat-stage {")

    expect(rule).toContain("animation-timeline: view()")
    expect(pinned).not.toContain(".watch-scroll-chat-stage")
  })

  it("scrolls the transcript in the same units the exchange is timed in", () => {
    // The reel's scroll and the steps of the exchange are one
    // choreography split across two files, so they have to share an axis.
    // A percentage is a fraction of the whole contain phase and a length
    // is an absolute offset into it — and the phone now sticks for the
    // length of the entire argument, so the same number means wildly
    // different places. Left as `%` while the steps became `svh`, the reel
    // scrolled roughly 800px after the content it follows, leaving the
    // citation card clipped off the bottom of the screen the whole time.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const rule = blockBody(guard, ".watch-scroll-chat-stage {")
    const range =
      /animation-range:\s*contain\s+(\d+)svh\s+contain\s+(\d+)svh/.exec(rule)

    expect(range, rule).not.toBeNull()
    const [, head, tail] = range!.map(Number)
    expect(tail).toBeGreaterThan(head)
    // It follows content that has outgrown the screen, so it belongs in
    // the back half of the exchange, never at the head.
    expect(head).toBeGreaterThan(50)
  })

  it("rests on a FINISHED exchange, not a half-played animation", () => {
    // What a reader gets with no scroll-driven animation at all: no
    // support, or reduced motion. The section's whole claim is that our
    // catalogue gets cited inside someone else's answer, so the resting
    // state has to be the answer — every step OPEN. A step resting closed
    // would leave those readers a blank phone, and no test that renders
    // the DOM would notice, because the markup is all there.
    const step = blockBody(css, ".watch-chat-step {")
    const think = blockBody(css, ".watch-chat-think {")
    const typed = blockBody(css, ".watch-chat-typed {")
    const staging = blockBody(css, ".watch-chat-home,")
    const app = blockBody(css, ".watch-chat-app {")

    expect(step).toContain("grid-template-rows: 1fr")
    // The exceptions are all things that only exist mid-play: a finished
    // exchange is not still waiting for its answer, the question has
    // already left the composer for the bubble, and the app has already
    // been opened — so a home screen and a pointer aiming at it would
    // strand these readers in front of a tap that never comes.
    expect(think).toContain("grid-template-rows: 0fr")
    expect(typed).toContain("max-height: 0")
    expect(staging).toContain("opacity: 0")
    expect(app).toContain("opacity: 1")
  })

  it("recedes the home screen without fading it", () => {
    // The app above is opaque by the time it covers the home screen, so
    // fading the home screen out as well only makes both layers
    // translucent at once — which turned a dark wallpaper over a white app
    // into flat grey for the whole transition. Scale, no opacity.
    const home = blockBody(css, "@keyframes watch-chat-home")
    const app = blockBody(css, "@keyframes watch-chat-app")

    expect(home).toContain("scale")
    expect(home).not.toContain("opacity")
    // And the app has to reach full opacity EARLY, so it covers rather
    // than blends for most of its travel.
    expect(app).toContain("opacity: 1")
  })

  it("puts a step's gap inside the box that clips it", () => {
    // `overflow: hidden` clips a box's CONTENT, never its own padding. A
    // closed step with padding still draws that padding, so the
    // conversation sits in a ladder of blank strips waiting for content
    // that has not arrived — measured at 14px per unopened step. The gap
    // has to be a child's margin, which is content and so gets clipped.
    const inner = blockBody(css, ".watch-chat-step-inner {")
    const child = blockBody(css, ".watch-chat-step-inner > * {")

    expect(inner).toContain("overflow: hidden")
    expect(inner).toContain("min-height: 0")
    expect(inner).not.toMatch(/padding/)
    expect(child).toContain("margin-block-start")
  })

  it("sizes the typed line against the device, not the page", () => {
    // The character budget on `phone.typedLines` only means anything if
    // the type scales with the phone: font and available width have to
    // move together, or a line that fits one device size is clipped at
    // another. `cqw` is what ties them.
    const line = blockBody(css, ".watch-chat-typed-line {")
    const device = blockBody(css, ".watch-chat-device {")

    expect(line).toContain("white-space: nowrap")
    expect(line).toMatch(/font-size:\s*clamp\([^)]*cqw/)
    expect(device).toContain("container-type: inline-size")
  })

  it("stacks the composer's two states in flow, not out of it", () => {
    // Placeholder and typed text occupy one grid cell so the pill's height
    // is the taller of them, which is how it grows a line at a time.
    // Absolute positioning stacks them equally well and is wrong: it takes
    // the typed text out of layout, so the pill stays one line tall and
    // the text spills through its bottom border.
    const slot = blockBody(css, ".watch-chat-slot {")
    const cell = blockBody(css, ".watch-chat-slot > * {")

    expect(slot).toContain("display: grid")
    expect(cell).toContain("grid-area: 1 / 1")
    expect(cell).not.toContain("position: absolute")
  })

  it("blinks the caret on its own clock, on its own element", () => {
    // Two elements because reveal and blink both drive opacity: in one
    // `animation` list the filling reveal wins outright and the caret
    // never blinks. And the blink is time-based — a cursor tied to scroll
    // freezes whenever the reader stops, which is most of the time.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const reveal = blockBody(guard, ".watch-scroll-chat-caret {")
    const blink = blockBody(
      guard,
      ".watch-scroll-chat-caret .watch-chat-caret {",
    )

    expect(reveal).toContain("animation-timeline: --watch-chat")
    expect(blink).toContain("infinite")
    expect(blink).not.toContain("animation-timeline")
  })

  it("names the timeline every step of the exchange reads", () => {
    // Each step attaches its own range to ONE timeline whose subject is
    // the pin stage. A step cannot use `view()` on itself: it starts at
    // zero height inside a pinned column inside an overflow-hidden screen,
    // so its own view progress says nothing about where the reader is.
    const guard = blockBody(css, "@supports (animation-timeline: view())")
    const stage = blockBody(guard, ".watch-scroll-chat-stage {")

    expect(stage).toContain("view-timeline-name: --watch-chat")
    for (const name of [
      "watch-scroll-chat-step",
      "watch-scroll-chat-think",
      "watch-scroll-chat-typed-line",
      "watch-scroll-chat-placeholder",
      "watch-scroll-chat-send",
    ]) {
      const rule = blockBody(guard, `.${name} {`)
      expect(rule, name).toContain("animation-timeline: --watch-chat")
      expect(rule, name).toContain("animation-range: var(--step-range)")
    }
  })

  it("measures the reel's screenful off its container, not a shared constant", () => {
    // These two rules are one calculation: the reel travels its own
    // height less ONE SCREENFUL of the phone's conversation viewport. It
    // reads that screenful as `100cqh`, which is why the viewport has to
    // be a size container. Before this it was a rem constant duplicated
    // in the component, where the two could drift with nothing to catch
    // it; now the viewport is free to be sized by flex layout so the
    // device can hold the iPhone ratio at any height.
    const viewport = blockBody(css, ".watch-chat-viewport {")
    const reel = blockBody(css, ".watch-chat-reel {")

    expect(viewport).toContain("container-type: size")
    expect(reel).toContain("100cqh")
    expect(reel).toContain("-100%")
    // Not a length constant standing in for the viewport height.
    expect(reel).not.toMatch(/--chat-viewport/)
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

  it("draws every grain tile at the size its noise was authored for", () => {
    // MEASURED. `baseFrequency` is per user unit, so rendering an N-unit
    // noise field into a box that is not N pixels scales the grain with the
    // box. A 512-unit field drawn at 148px comes out as 0.3px blobs and
    // averages to flat grey — a layer that costs paint and shows nothing.
    //
    // Scanned over EVERY rule that references a grain field, not the two
    // this started with. A merge added a third consumer at a size that
    // matched the field it was written against, and enlarging the shared
    // field silently broke it; a guard naming only the rules it knew about
    // could not have noticed.
    const authored = (suffix: string) =>
      Number(
        css.match(
          new RegExp(`--watch-grain-image${suffix}:[^;]*width='(\\d+)'`),
        )?.[1],
      )

    const consumers = [
      ...css.matchAll(
        /\.([\w-]+)\s*\{([^}]*background-image:\s*var\(--watch-grain-image(-fine)?\)[^}]*)\}/g,
      ),
    ].map((m) => ({
      name: m[1],
      drawn: Number(m[2].match(/background-size:\s*(\d+)px/)?.[1]),
      suffix: m[3] ?? "",
    }))

    // The scan itself has to be load-bearing: if it stops matching, every
    // assertion below passes vacuously.
    expect(consumers.length).toBeGreaterThanOrEqual(3)

    for (const { name, drawn, suffix } of consumers) {
      expect(drawn, `.${name} background-size`).toBe(authored(suffix))
    }

    // …and the two fields are genuinely different, not one size twice.
    expect(authored("")).not.toBe(authored("-fine"))
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

describe("improvement colour band", () => {
  const band = blockBody(css, ".whats-new-tint-band")

  it("layers radials over a base so no corner is left bald", () => {
    expect(band).not.toBe("")
    const radials = band.match(/radial-gradient\(/g) ?? []
    expect(radials.length).toBeGreaterThanOrEqual(3)
    // The base is what the radials sit on; without it their falloff leaves
    // the cell corners transparent and the band reads as three blobs.
    expect(band).toContain("linear-gradient(")
  })

  it("ends on a slanted fade, prefixed for older Safari", () => {
    // A level fade is what anyone would reach for by default; the slant is
    // the point. `to bottom`, or a bare 180deg, means the tilt was lost.
    const angle = band.match(/[^-]mask-image:\s*linear-gradient\(\s*(\d+)deg/)
    expect(angle).not.toBeNull()
    const deg = Number(angle![1])
    expect(deg).not.toBe(180)
    // Past 180deg tilts the fade so the RIGHT side ends lower; under 180
    // mirrors it, which is the direction this was deliberately moved away
    // from and is otherwise a silent one-character flip.
    expect(deg).toBeGreaterThan(180)
    expect(deg).toBeLessThanOrEqual(200)
    // Both spellings, or Safari < 15.4 drops the mask and shows a hard cut.
    expect(band).toContain("-webkit-mask-image:")
  })

  it("drives every layer from the per-cell tint properties", () => {
    // Hard-coding a colour here would paint all five cells identically
    // while the cells still carry five different tints.
    expect(band).toContain("var(--tint-from)")
    expect(band).toContain("var(--tint-to)")
    // #0c0a09 is the page base the mixes fall back to; any OTHER literal
    // hex is a colour that ignores the cell's tint.
    expect(band).not.toMatch(/#(?!0c0a09\b)[0-9a-f]{6}/i)
  })
})
