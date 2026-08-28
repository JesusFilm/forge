/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot } from "react-dom/client"
import { beforeEach, describe, expect, it } from "vitest"

import {
  CHAT_SEQUENCE_END_SVH,
  CHAT_STEPS,
  WhatsNewAssistantPhone,
} from "@/components/whats-new/WhatsNewAssistantPhone"
import { WHATS_NEW_ASSISTANTS } from "@/components/whats-new/whats-new-content"

/**
 * `contain <start>svh contain <end>svh`. The unit is part of the contract,
 * not incidental: a percentage is a fraction of the whole timeline and a
 * length is an absolute offset into it, so the same number means different
 * places. See the mixed-unit test below for what that cost once.
 */
const RANGE = /^contain\s+([\d.]+)svh\s+contain\s+([\d.]+)svh$/

function bounds(range: string): [number, number] {
  const match = RANGE.exec(range)
  expect(match, `${range} is not a contain range in svh`).not.toBeNull()
  return [Number(match![1]), Number(match![2])]
}

const start = (range: string): number => bounds(range)[0]
const end = (range: string): number => bounds(range)[1]

/** Every range the sequence declares, flattened. */
function allRanges(): string[] {
  return Object.values(CHAT_STEPS).flatMap((value) =>
    Array.isArray(value) ? [...value] : [value],
  )
}

describe("WhatsNewAssistantPhone", () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement("div")
    document.body.append(container)
    act(() => {
      createRoot(container).render(<WhatsNewAssistantPhone />)
    })
  })

  describe("the workflow it acts out", () => {
    it("runs in the order a person actually does it", () => {
      // The whole point of the sequence is cause and effect: a question is
      // typed, sent, waited on, and then answered. Retime one step past
      // another and the phone answers before it is asked — which still
      // renders, still passes every other test here, and is nonsense.
      const order = [
        ["home screen", start(CHAT_STEPS.home)],
        ["pointer sets off", start(CHAT_STEPS.pointer)],
        ["pointer arrives", end(CHAT_STEPS.pointer)],
        ["tap", start(CHAT_STEPS.tap)],
        ["app opens", start(CHAT_STEPS.app)],
        ["typing starts", start(CHAT_STEPS.typedLines[0])],
        ["typing ends", end(CHAT_STEPS.typedLines.at(-1)!)],
        ["send", start(CHAT_STEPS.clear)],
        ["question appears", start(CHAT_STEPS.ask)],
        ["wait begins", start(CHAT_STEPS.think)],
        ["answer begins", start(CHAT_STEPS.answer[0])],
        ["sources", start(CHAT_STEPS.sources)],
        ["rest of answer", start(CHAT_STEPS.answer[1])],
        ["citation", start(CHAT_STEPS.citation)],
      ] as const

      for (let i = 1; i < order.length; i += 1) {
        const [prevName, prev] = order[i - 1]
        const [name, value] = order[i]
        expect(
          value,
          `${name} must not precede ${prevName}`,
        ).toBeGreaterThanOrEqual(prev)
      }
    })

    it("times every step in the same unit", () => {
      // One mixed unit is all it takes. The reel's own scroll lived in
      // globals.css as a PERCENTAGE while these became lengths, and once
      // the phone started sticking for the length of the whole argument
      // that put the two roughly 800px apart: the citation card appeared
      // and then sat clipped off the bottom of the screen until a scroll
      // position that had nothing to do with it.
      for (const range of allRanges()) {
        expect(range).toMatch(RANGE)
      }
    })

    it("finishes inside the window it is given", () => {
      // These are offsets in `svh` into the stage's contain phase, and
      // `CHAT_SEQUENCE_END_SVH` is what the stage is sized against — so a
      // step past it plays only if the stage happens to be taller than
      // required. Anything genuinely past the end of the phase never plays
      // at all: silently, and only at some viewport sizes.
      //
      // The chain is stage `min-h` -> this budget -> these steps, and both
      // links are tested: the page suite compares the stage against the
      // budget, this compares the budget against the steps. Extending the
      // sequence therefore has to move BOTH numbers, which is the point.
      for (const range of allRanges()) {
        expect(end(range), range).toBeLessThanOrEqual(CHAT_SEQUENCE_END_SVH)
        expect(end(range), range).toBeGreaterThan(start(range))
      }
      // Anti-vacuous: a budget far above the sequence would make the
      // check above meaningless, and would also waste stage height.
      const last = Math.max(...allRanges().map(end))
      expect(CHAT_SEQUENCE_END_SVH).toBeLessThanOrEqual(last + 8)
    })

    it("taps only once the pointer has arrived", () => {
      // A tap that fires while the pointer is still crossing the screen
      // reads as the icon reacting to nothing, which is worse than no
      // pointer at all.
      expect(start(CHAT_STEPS.tap)).toBeGreaterThanOrEqual(
        end(CHAT_STEPS.pointer),
      )
      // And the app has to open out of the tap, not alongside it.
      expect(start(CHAT_STEPS.app)).toBeGreaterThanOrEqual(
        start(CHAT_STEPS.tap),
      )
      // The home screen holds until the app has taken over.
      expect(end(CHAT_STEPS.home)).toBeGreaterThanOrEqual(
        end(CHAT_STEPS.app) - 4,
      )
    })

    it("starts typing only after the app is open", () => {
      // Otherwise the question is already being typed into a composer the
      // reader has not been shown yet.
      expect(start(CHAT_STEPS.typedLines[0])).toBeGreaterThanOrEqual(
        end(CHAT_STEPS.app) - 1,
      )
    })

    it("holds the caret until the question is sent, not before typing ends", () => {
      // A caret that appears mid-word reads as a rendering fault rather
      // than a cursor. It belongs in the pause between the last character
      // and the send.
      expect(start(CHAT_STEPS.caret)).toBeGreaterThanOrEqual(
        end(CHAT_STEPS.typedLines.at(-1)!) - 1,
      )
      expect(start(CHAT_STEPS.caret)).toBeLessThan(start(CHAT_STEPS.clear))
    })

    it("gives one typing window per line of the question", () => {
      expect(CHAT_STEPS.typedLines).toHaveLength(
        WHATS_NEW_ASSISTANTS.phone.typedLines.length,
      )
    })
  })

  describe("what it renders", () => {
    it("draws a composer that types, a wait, and a send control", () => {
      for (const id of [
        "whats-new-phone-placeholder",
        "whats-new-phone-typed",
        "whats-new-phone-thinking",
        "whats-new-phone-send",
      ]) {
        expect(
          container.querySelector(`[data-testid="${id}"]`),
          id,
        ).not.toBeNull()
      }
      expect(
        container.querySelectorAll(
          '[data-testid="whats-new-phone-typed-line"]',
        ),
      ).toHaveLength(WHATS_NEW_ASSISTANTS.phone.typedLines.length)
    })

    it("opens the app OVER the home screen, with its own background", () => {
      // Layering, and it is not cosmetic. The other way round — home on
      // top fading away to reveal the app — leaves both layers translucent
      // mid-transition, and a dark wallpaper over a white app washes the
      // whole screen out to flat grey. An absolutely positioned sibling
      // also paints above a static one whatever the source order, so the
      // app needs the z-index; and a layer with no background of its own
      // cannot cover the one beneath however opaque it gets.
      const app = container.querySelector<HTMLElement>(
        '[data-testid="whats-new-phone-app"]',
      )
      const home = container.querySelector<HTMLElement>(
        '[data-testid="whats-new-phone-home"]',
      )

      expect(app?.className).toMatch(/\bz-10\b/)
      expect(app?.className).toMatch(/\bbg-white\b/)
      expect(home?.className).toMatch(/\babsolute\b/)
    })

    it("aims the pointer at the icon's own box, not the whole cell", () => {
      // Two geometries ride on this. A circle sized in percent is only
      // round inside a square box, and the pointer only lands centred if
      // its box is the ICON's — the cell includes the label underneath,
      // which pulled the landing point 8px low and made the pointer an
      // ellipse at the same time.
      const pointer = container.querySelector(
        '[data-testid="whats-new-phone-pointer"]',
      )
      const box = pointer?.parentElement
      const icon = container.querySelector(
        '[data-testid="whats-new-phone-app-icon"]',
      )

      expect(box?.className).toMatch(/aspect-square/)
      // Same box, so the two cannot drift apart.
      expect(icon?.parentElement).toBe(box)
    })

    it("keeps the home screen out of the accessible name", () => {
      // The device is one `role="img"` describing the exchange. The home
      // screen is staging for it, and an app grid read aloud tile by tile
      // is noise in front of the point.
      expect(
        container
          .querySelector('[data-testid="whats-new-phone-home"]')
          ?.getAttribute("aria-hidden"),
      ).toBe("true")
    })

    it("gives every animated step a range to run over", () => {
      // A step with no `--step-range` inherits none and its animation gets
      // an empty range, so it either never runs or runs over the whole
      // timeline. Both look like the step is simply broken.
      const steps = [
        ...container.querySelectorAll<HTMLElement>(
          ".watch-scroll-chat-step, .watch-scroll-chat-think, .watch-scroll-chat-typed-line, .watch-scroll-chat-typed, .watch-scroll-chat-placeholder, .watch-scroll-chat-caret, .watch-scroll-chat-send",
        ),
      ]

      expect(steps.length).toBeGreaterThan(8)
      for (const step of steps) {
        expect(
          step.style.getPropertyValue("--step-range"),
          step.className,
        ).toMatch(RANGE)
      }
    })

    it("pairs every step with the box that clips it", () => {
      // The open/close animation sizes a grid row; the clipping child is
      // what actually hides the content. A step without one animates a row
      // around content that stays visible the whole time.
      for (const step of container.querySelectorAll(".watch-chat-step")) {
        expect(
          step.querySelector(":scope > .watch-chat-step-inner"),
          step.className,
        ).not.toBeNull()
      }
    })

    it("keeps the typed question out of the accessible name", () => {
      // The device is one `role="img"` whose alt already states the whole
      // exchange. The composer's copy of the question is decorative, and
      // read aloud it would repeat the question twice.
      const typed = container.querySelector(
        '[data-testid="whats-new-phone-typed"]',
      )

      expect(typed?.getAttribute("aria-hidden")).toBe("true")
    })
  })
})
