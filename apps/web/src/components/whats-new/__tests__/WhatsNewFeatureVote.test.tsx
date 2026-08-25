/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WhatsNewFeatureVote } from "@/components/whats-new/WhatsNewFeatureVote"
import { WHATS_NEW_VOTES } from "@/components/whats-new/whats-new-content"
import { WATCH_FEEDBACK_OPEN_EVENT } from "@/lib/watch-feedback-events"

const STORAGE_KEY = "watch:whats-new:feature-stickers"
const [first, second] = WHATS_NEW_VOTES.features
const [love, yes] = WHATS_NEW_VOTES.stickers

let container: HTMLDivElement
let root: Root

const q = <T extends Element>(id: string) =>
  container.querySelector<T>(`[data-testid="${id}"]`)

function render() {
  act(() => {
    root.render(<WhatsNewFeatureVote contentClass="mx-auto max-w-7xl" />)
  })
}

function click(testId: string) {
  act(() => {
    q<HTMLButtonElement>(testId)?.click()
  })
}

const cardFor = (featureId: string) => {
  const index = WHATS_NEW_VOTES.features.findIndex((f) => f.id === featureId)
  return container.querySelectorAll<HTMLElement>(
    '[data-testid="whats-new-vote-card"]',
  )[index]
}

/** Pick a sticker up, then tap a card — the touch/keyboard path. */
function place(stickerId: string, featureId: string) {
  click(`whats-new-vote-sticker-${stickerId}`)
  act(() => {
    cardFor(featureId).dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

const stuckOn = (featureId: string) =>
  container.querySelectorAll(
    `[data-testid^="whats-new-vote-peel-${featureId}-"]`,
  ).length

beforeEach(() => {
  window.localStorage.clear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  window.localStorage.clear()
})

describe("WhatsNewFeatureVote", () => {
  it("offers every sticker and the advertised budget", () => {
    render()
    for (const sticker of WHATS_NEW_VOTES.stickers) {
      expect(q(`whats-new-vote-sticker-${sticker.id}`)).not.toBeNull()
    }
    expect(q("whats-new-vote-remaining")?.textContent).toContain(
      String(WHATS_NEW_VOTES.budget),
    )
  })

  it("sticks a picked-up sticker onto the card that is tapped", () => {
    render()
    place(love.id, first.id)

    expect(stuckOn(first.id)).toBe(1)
    expect(stuckOn(second.id)).toBe(0)
    expect(q("whats-new-vote-remaining")?.textContent).toContain("2")
  })

  it("works without dragging at all", () => {
    // HTML5 drag-and-drop does not exist on touch. If placing required a
    // drag, the board would be unusable on a phone and by keyboard.
    render()
    place(love.id, first.id)
    place(yes.id, second.id)

    expect(stuckOn(first.id)).toBe(1)
    expect(stuckOn(second.id)).toBe(1)
  })

  it("records which sticker was used, not just a count", () => {
    render()
    place(yes.id, first.id)

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
    expect(stored[first.id]).toHaveLength(1)
    // The kind is recorded, not just a tally — a heart and a thumbs-up
    // are different signals if these are ever collected.
    expect(stored[first.id][0].s).toBe(yes.id)
  })

  it("stops at the budget instead of handing out a fourth sticker", () => {
    render()
    place(love.id, first.id)
    place(love.id, first.id)
    place(love.id, first.id)

    expect(q("whats-new-vote-remaining")?.textContent).toContain("0")
    for (const sticker of WHATS_NEW_VOTES.stickers) {
      expect(
        q<HTMLButtonElement>(`whats-new-vote-sticker-${sticker.id}`)?.disabled,
      ).toBe(true)
    }
  })

  it("frees a sticker again when one is peeled off", () => {
    render()
    place(love.id, first.id)
    place(yes.id, first.id)
    click(`whats-new-vote-peel-${first.id}-0`)

    expect(stuckOn(first.id)).toBe(1)
    expect(q("whats-new-vote-remaining")?.textContent).toContain("2")
  })

  it("never nests a peel button inside the card drop target", () => {
    // While a sticker is held the card itself is the target, so already
    // placed stickers must go inert. A button inside a button is invalid
    // and breaks keyboard traversal.
    render()
    place(love.id, first.id)
    click(`whats-new-vote-sticker-${yes.id}`)

    expect(cardFor(first.id).getAttribute("role")).toBe("button")
    expect(q(`whats-new-vote-peel-${first.id}-0`)).toBeNull()
  })

  it("sticks where the pointer lands, not in a fixed slot", () => {
    render()
    click(`whats-new-vote-sticker-${love.id}`)
    const card = cardFor(first.id)
    card.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect
    act(() => {
      card.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 300, clientY: 50 }),
      )
    })

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")
    expect(stored[first.id][0].x).toBeCloseTo(75, 0)
    expect(stored[first.id][0].y).toBeCloseTo(25, 0)
  })

  it("clamps a stored position that would park a sticker off the card", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ [first.id]: [{ s: love.id, x: 9999, y: -500, r: 90 }] }),
    )
    render()

    const sticker = q<HTMLElement>(`whats-new-vote-peel-${first.id}-0`)!
    const x = Number.parseFloat(sticker.style.left)
    const y = Number.parseFloat(sticker.style.top)
    expect(x).toBeLessThanOrEqual(100)
    expect(x).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(100)
    expect(y).toBeGreaterThanOrEqual(0)
  })

  it("leaves a gap in the pile while a sticker is held", () => {
    render()
    expect(q(`whats-new-vote-gap-${love.id}`)).toBeNull()

    click(`whats-new-vote-sticker-${love.id}`)

    // The sticker is on the cursor, so its slot must read as empty — grey
    // and flat, not a second sticker still sitting in the pile.
    const gap = q(`whats-new-vote-gap-${love.id}`)
    expect(gap).not.toBeNull()
    expect(gap?.className).toContain("border-dashed")
    const button = q<HTMLElement>(`whats-new-vote-sticker-${love.id}`)!
    expect(button.className).not.toContain("watch-sticker-art")
    expect(button.querySelector("span")?.className).toContain(
      "watch-sticker-ghost",
    )
    // Only the held one — the rest of the pile is untouched.
    expect(q(`whats-new-vote-gap-${yes.id}`)).toBeNull()
  })

  it("fills the gap back in once the sticker is placed", () => {
    render()
    place(love.id, first.id)

    expect(q(`whats-new-vote-gap-${love.id}`)).toBeNull()
    expect(
      q<HTMLElement>(`whats-new-vote-sticker-${love.id}`)?.className,
    ).toContain("watch-sticker-art")
  })

  it("carries the light-band sticker surface hook", () => {
    // The die-cut edge is white and the cast shadow is tuned per band. On
    // the white shelf the dark-band shadow reads as grime, so the section
    // has to opt into the lighter cast — dropping this class is a silent
    // regression no colour assertion elsewhere would catch.
    render()

    const section = q("whats-new-vote")
    expect(section?.className).toContain("watch-sticker-surface-light")
    expect(section?.className).toContain("bg-white")
  })

  it("offers the stickers as a loose pile with a prompt", () => {
    render()
    expect(q("whats-new-vote-pile")).not.toBeNull()
    expect(q("whats-new-vote-pile-hint")?.textContent).toBe(
      WHATS_NEW_VOTES.pileHint,
    )
  })

  it("hides the carousel scrollbar and bleeds it past the rail", () => {
    render()
    const carousel = q("whats-new-vote-carousel")!
    expect(carousel.className).toContain("[scrollbar-width:none]")
    expect(carousel.className).toContain("[&::-webkit-scrollbar]:hidden")
    // Negative right margin is what carries the row to the window edge.
    expect(carousel.className).toMatch(/-mr-/)
  })

  it("survives a reload", () => {
    render()
    place(love.id, first.id)

    act(() => {
      root.unmount()
    })
    root = createRoot(container)
    render()

    expect(stuckOn(first.id)).toBe(1)
  })

  it("refuses a stored board that would exceed the budget", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [first.id]: Array.from({ length: 20 }, () => ({
          s: love.id,
          x: 50,
          y: 50,
          r: 0,
        })),
      }),
    )
    render()

    expect(stuckOn(first.id)).toBe(WHATS_NEW_VOTES.budget)
    expect(q("whats-new-vote-remaining")?.textContent).toContain("0")
  })

  it("drops stored stickers that are not real kinds", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [first.id]: [
          { s: "not-a-sticker", x: 50, y: 50, r: 0 },
          { s: love.id, x: 50, y: 50, r: 0 },
        ],
      }),
    )
    render()

    expect(stuckOn(first.id)).toBe(1)
  })

  it("opens the support composer from the idea button", () => {
    const opened = vi.fn()
    window.addEventListener(WATCH_FEEDBACK_OPEN_EVENT, opened)
    render()
    click("whats-new-vote-idea")
    window.removeEventListener(WATCH_FEEDBACK_OPEN_EVENT, opened)

    expect(opened).toHaveBeenCalledOnce()
    expect(q("whats-new-vote-idea")?.textContent).toContain(
      WHATS_NEW_VOTES.ideaLabel,
    )
  })

  it("says on its face that stickers go nowhere yet", () => {
    render()
    expect(container.textContent).toContain(WHATS_NEW_VOTES.localOnlyNote)
  })
})
