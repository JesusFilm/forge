/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WhatsNewFeatureVote } from "@/components/whats-new/WhatsNewFeatureVote"
import { WHATS_NEW_VOTES } from "@/components/whats-new/whats-new-content"
import { WATCH_FEEDBACK_OPEN_EVENT } from "@/lib/watch-feedback-events"

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.test/api/graphql" },
}))

const STORAGE_KEY = "watch:whats-new:feature-stickers"
const BALLOT_KEY = "watch:whats-new:ballot"
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

/**
 * jsdom has no `DataTransfer`, so drag tests hand the handlers the three
 * members this component actually uses. React reads `dataTransfer` off the
 * native event, so defining it here is enough.
 */
function dragEvent(type: string, stickerId: string) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, "dataTransfer", {
    value: {
      setData: () => {},
      setDragImage: () => {},
      getData: () => stickerId,
    },
  })
  return event
}

function dragStart(stickerId: string) {
  act(() => {
    q(`whats-new-vote-sticker-${stickerId}`)?.dispatchEvent(
      dragEvent("dragstart", stickerId),
    )
  })
}

/** Let the deferred "hide the source" frame run. */
async function nextFrame() {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
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

/**
 * The vote client is exercised for real against a stubbed `fetch`, so these
 * tests cover the operation names and variables that actually go on the wire —
 * mocking the client module would assert our own call shape back at us.
 */
type Sent = { operation: string; variables: Record<string, unknown> }
let sent: Sent[]
let tallies: Record<string, number>
let failNext: boolean
let refuseNext: boolean

function operationOf(query: string): string {
  return /(?:query|mutation)\s+(\w+)/.exec(query)?.[1] ?? "unknown"
}

function tallyRows() {
  return Object.entries(tallies).map(([featureId, votes]) => ({
    featureId,
    votes,
  }))
}

function installFetch() {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"))
    const operation = operationOf(String(body.query ?? ""))
    sent.push({ operation, variables: body.variables ?? {} })
    if (failNext) {
      failNext = false
      throw new TypeError("network down")
    }
    if (operation === "WhatsNewFeatureVoteTallies") {
      return jsonResponse({ whatsNewFeatureVoteTallies: tallyRows() })
    }
    if (operation === "CastWhatsNewFeatureVote") {
      // A refusal is a 200 with `accepted: false` — the budget is spent, not
      // the server broken.
      if (refuseNext) {
        refuseNext = false
        return jsonResponse({
          castWhatsNewFeatureVote: {
            accepted: false,
            refusal: "budget_exhausted",
            tallies: tallyRows(),
          },
        })
      }
      const featureId = String(body.variables.featureId)
      tallies[featureId] = (tallies[featureId] ?? 0) + 1
      return jsonResponse({
        castWhatsNewFeatureVote: {
          accepted: true,
          refusal: null,
          tallies: tallyRows(),
        },
      })
    }
    // Whole-ballot retraction is the null-placement case.
    if (body.variables.placementId == null) tallies = {}
    return jsonResponse({
      retractWhatsNewFeatureVote: {
        accepted: true,
        refusal: null,
        tallies: tallyRows(),
      },
    })
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data }),
  } as unknown as Response
}

/** Let the mount read + any queued flush settle. */
async function settle() {
  for (let pass = 0; pass < 6; pass += 1) {
    await act(async () => {
      await Promise.resolve()
    })
  }
}

const casts = () =>
  sent.filter((call) => call.operation === "CastWhatsNewFeatureVote")
const retractions = () =>
  sent.filter((call) => call.operation === "RetractWhatsNewFeatureVote")

beforeEach(() => {
  window.localStorage.clear()
  sent = []
  tallies = {}
  failNext = false
  refuseNext = false
  installFetch()
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

  it("takes the held sticker out of the pile entirely", () => {
    render()
    expect(q(`whats-new-vote-sticker-${love.id}`)).not.toBeNull()

    click(`whats-new-vote-sticker-${love.id}`)

    // It is in the reader's hand, so the pile does not have it any more —
    // no ghost, no dashed slot, nothing left behind to click twice.
    expect(q(`whats-new-vote-sticker-${love.id}`)).toBeNull()
    expect(q(`whats-new-vote-gap-${love.id}`)).toBeNull()
    // Only the held one. The rest of the pile is still pickable, which is
    // what an "emptied the pile" bug would take with it.
    expect(q(`whats-new-vote-sticker-${yes.id}`)).not.toBeNull()
  })

  it("keeps a dragged sticker mounted so the gesture survives", async () => {
    // Chrome cancels an in-flight drag when its source node leaves the DOM,
    // so "a held sticker leaves the pile" cannot apply to the dragged one.
    // Unmounting it here is what killed drag-and-drop once already.
    render()
    dragStart(love.id)

    const onDragStart = q<HTMLElement>(`whats-new-vote-sticker-${love.id}`)
    expect(onDragStart).not.toBeNull()
    // Still visible THIS frame: the browser snapshots the drag image during
    // the dragstart dispatch, and a hidden source snapshots as nothing.
    expect(onDragStart?.className).not.toContain("opacity-0")

    await nextFrame()

    const hidden = q<HTMLElement>(`whats-new-vote-sticker-${love.id}`)
    expect(hidden).not.toBeNull()
    // Out of the pile's flow, so the stickers behind it close the gap.
    expect(hidden?.className).toContain("opacity-0")
    expect(hidden?.className).toContain("absolute")
  })

  it("sticks a dropped sticker where it was dropped", async () => {
    render()
    dragStart(love.id)
    await nextFrame()

    act(() => {
      const card = cardFor(first.id)
      const event = dragEvent("drop", love.id)
      Object.defineProperty(event, "clientX", { value: 140 })
      Object.defineProperty(event, "clientY", { value: 90 })
      card.dispatchEvent(event)
    })

    expect(stuckOn(first.id)).toBe(1)
    // Back in the pile, and no longer the hidden drag source.
    const back = q<HTMLElement>(`whats-new-vote-sticker-${love.id}`)
    expect(back).not.toBeNull()
    expect(back?.className).not.toContain("opacity-0")
  })

  it("leaves the sticker in hand when a drag ends on nothing", async () => {
    render()
    dragStart(love.id)
    await nextFrame()

    act(() => {
      q(`whats-new-vote-sticker-${love.id}`)?.dispatchEvent(
        dragEvent("dragend", love.id),
      )
    })

    // Same state as a click pick-up: out of the pile, put-it-back offered.
    expect(q(`whats-new-vote-sticker-${love.id}`)).toBeNull()
    expect(q("whats-new-vote-put-back")).not.toBeNull()
    expect(stuckOn(first.id)).toBe(0)
  })

  it("returns the sticker to the pile once it is placed", () => {
    render()
    place(love.id, first.id)

    expect(q(`whats-new-vote-sticker-${love.id}`)).not.toBeNull()
    expect(stuckOn(first.id)).toBe(1)
  })

  it("hands the held sticker back when the reader changes their mind", () => {
    render()
    click(`whats-new-vote-sticker-${love.id}`)

    // The one way out: with the sticker gone from the pile there is nothing
    // else left to press, so losing this button strands the reader holding
    // a sticker they cannot put down except by spending it.
    const putBack = q<HTMLButtonElement>("whats-new-vote-put-back")
    expect(putBack).not.toBeNull()
    click("whats-new-vote-put-back")

    expect(q(`whats-new-vote-sticker-${love.id}`)).not.toBeNull()
    expect(q("whats-new-vote-put-back")).toBeNull()
    expect(stuckOn(first.id)).toBe(0)
  })

  it("keeps keyboard focus with the sticker across the hand-off", () => {
    render()
    click(`whats-new-vote-sticker-${love.id}`)

    // The sticker's own button unmounts on pick-up. Without the hand-off
    // focus lands on <body> and a keyboard reader has to tab in from the
    // top of the section to get anywhere.
    expect(document.activeElement).toBe(q("whats-new-vote-put-back"))

    click("whats-new-vote-put-back")

    expect(document.activeElement).toBe(q(`whats-new-vote-sticker-${love.id}`))
  })

  it("puts a held sticker back on Escape", () => {
    render()
    click(`whats-new-vote-sticker-${love.id}`)

    act(() => {
      q("whats-new-vote-put-back")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
    })

    expect(q(`whats-new-vote-sticker-${love.id}`)).not.toBeNull()
    expect(q("whats-new-vote-put-back")).toBeNull()
  })

  it("stands the pile under the cards, at pick-up size", () => {
    // Both are the point of the layout: the pile feeds the row above it, and
    // these are the only draggable objects on the page — at small type they
    // read as decoration beside the heading, which is where they used to be.
    render()
    const pile = q("whats-new-vote-pile")!
    const carousel = q("whats-new-vote-carousel")!

    expect(
      carousel.compareDocumentPosition(pile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    // The size has to sit on the PILE. Each sticker sets `fontSize` in `em`
    // inline to step the pile front-to-back, and an inline style beats a
    // `text-*` class on the same element — a size class on the button
    // resolves to nothing and the whole pile renders at the inherited 1rem,
    // which is what it did before this moved.
    expect(pile.className).toContain(
      "text-[length:calc(var(--watch-sticker-stuck)*var(--watch-sticker-pile-scale))]",
    )
    const sticker = q<HTMLElement>(`whats-new-vote-sticker-${love.id}`)!
    expect(sticker.style.fontSize).toMatch(/em$/)
    expect(sticker.className).not.toMatch(/\btext-\d?xl\b|\btext-\[/)
  })

  it("keeps the pile a step above the stuck size, from one number", () => {
    // The pile is "bigger than a spent sticker" BY CONSTRUCTION: both ends
    // read the same custom property, so tuning the stuck size carries the
    // pile with it. Two independent literals is how the pile ended up six
    // times the size of a stuck sticker.
    render()
    place(love.id, first.id)
    const pile = q("whats-new-vote-pile")!
    const stuck = q<HTMLElement>(`whats-new-vote-peel-${first.id}-0`)!

    expect(stuck.className).toContain(
      "text-[length:var(--watch-sticker-stuck)]",
    )
    expect(pile.className).toContain("var(--watch-sticker-stuck)")
    expect(pile.className).toContain("var(--watch-sticker-pile-scale)")
    // No sticker in the pile may render below the finished size, or the back
    // of the pile reads as spent rather than as further away.
    for (const sticker of container.querySelectorAll<HTMLElement>(
      '[data-testid^="whats-new-vote-sticker-"]',
    )) {
      expect(
        Number.parseFloat(sticker.style.fontSize),
        sticker.dataset.testid,
      ).toBeGreaterThanOrEqual(1 / 1.25)
    }
  })

  it("puts the idea button in the header, above the cards", () => {
    // A reader whose feature is not in the row should be told before they
    // scroll the whole carousel looking for it.
    render()
    const idea = q("whats-new-vote-idea")!
    const carousel = q("whats-new-vote-carousel")!
    const heading = container.querySelector("h2")!
    const headerRow = heading.parentElement?.parentElement

    expect(
      carousel.compareDocumentPosition(idea) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
    // Same header row as the heading, not a band of its own between them.
    expect(idea.parentElement).toBe(headerRow)
    // And ALONE in that corner. The heading column caps at 42rem and this
    // button is 346px; together they only just fit the content rail from
    // ~1200px up, so anything else added here wraps the whole row and drops
    // the button under the copy — which is where the carousel arrows used to
    // put it on a 1211px window.
    expect(headerRow?.children).toHaveLength(2)
    for (const nudge of container.querySelectorAll("button[aria-label]")) {
      if (!nudge.className.includes("size-10")) continue
      expect(
        carousel.compareDocumentPosition(nudge) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        nudge.getAttribute("aria-label") ?? "",
      ).toBeTruthy()
    }
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

  describe("recording votes", () => {
    it("sends a placement to the server and shows the new total", async () => {
      render()
      await settle()
      place(love.id, first.id)
      await settle()

      expect(casts()).toHaveLength(1)
      expect(casts()[0].variables).toMatchObject({
        featureId: first.id,
        sticker: love.id,
      })
      expect(q(`whats-new-vote-count`)?.textContent).toBe("1 vote")
    })

    it("shows each card its own count, from the server", async () => {
      tallies = { [first.id]: 12, [second.id]: 1 }
      render()
      await settle()

      const counts = [
        ...container.querySelectorAll<HTMLElement>(
          '[data-testid="whats-new-vote-count"]',
        ),
      ]
      const byFeature = new Map(
        counts.map((node) => [node.dataset.feature, node.textContent]),
      )
      expect(byFeature.get(first.id)).toBe("12 votes")
      expect(byFeature.get(second.id)).toBe("1 vote")
      // A feature nobody has voted for reads as a sentence, not "0 votes".
      expect(byFeature.get(WHATS_NEW_VOTES.features[2].id)).toBe("No votes yet")
    })

    it("says nothing at all until the first read lands", () => {
      // The page is statically cached, so there is no server-rendered count.
      // Rendering "No votes yet" before the read would be a guess.
      render()
      expect(q("whats-new-vote-count")?.textContent?.trim()).toBe("")
    })

    it("keeps one ballot across mounts and one id per placement", async () => {
      render()
      await settle()
      place(love.id, first.id)
      await settle()
      const firstBallot = window.localStorage.getItem(BALLOT_KEY)

      act(() => {
        root.unmount()
      })
      root = createRoot(container)
      render()
      await settle()
      place(yes.id, second.id)
      await settle()

      expect(window.localStorage.getItem(BALLOT_KEY)).toBe(firstBallot)
      const ballots = new Set(casts().map((call) => call.variables.ballotId))
      expect(ballots).toEqual(new Set([firstBallot]))
      // Distinct placements, or the second vote would land on the first's row
      // and the server would count one sticker for two.
      const placements = new Set(
        casts().map((call) => call.variables.placementId),
      )
      expect(placements.size).toBe(2)
    })

    it("takes a sent vote back when the sticker is peeled off", async () => {
      render()
      await settle()
      place(love.id, first.id)
      await settle()

      click(`whats-new-vote-peel-${first.id}-0`)
      await settle()

      expect(retractions()).toHaveLength(1)
      expect(retractions()[0].variables).toMatchObject({
        placementId: casts()[0].variables.placementId,
      })
    })

    it("takes the whole ballot back when the board is cleared", async () => {
      render()
      await settle()
      place(love.id, first.id)
      await settle()

      click("whats-new-vote-reset")
      await settle()

      // One call, not one per sticker: the null placement is the whole-ballot
      // case, and the alternative is N requests that can half-fail.
      expect(retractions()).toHaveLength(1)
      expect(retractions()[0].variables.placementId).toBeNull()
    })

    it("retries a placement whose request failed", async () => {
      // The page tells the reader their vote was recorded. A dropped request
      // has to be a retry, not a quiet lie — and the sticker stays on the card
      // either way, so nothing on screen says it is pending.
      render()
      await settle()
      failNext = true
      place(love.id, first.id)
      await settle()

      expect(casts()).toHaveLength(1)
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "{}",
      )
      expect(stored[first.id][0].sent).toBe(false)

      act(() => {
        root.unmount()
      })
      root = createRoot(container)
      render()
      await settle()

      expect(casts()).toHaveLength(2)
      expect(casts()[1].variables.placementId).toBe(
        casts()[0].variables.placementId,
      )
    })

    it("does not retry a vote the server refused", async () => {
      // A refusal is settled: the budget is spent. Retrying it would re-send
      // the same doomed request on every page load forever — the failure the
      // transport retry above is deliberately NOT extended to.
      render()
      await settle()
      refuseNext = true
      place(love.id, first.id)
      await settle()

      expect(casts()).toHaveLength(1)
      const stored = JSON.parse(
        window.localStorage.getItem(STORAGE_KEY) ?? "{}",
      )
      expect(stored[first.id][0].sent).toBe(true)

      act(() => {
        root.unmount()
      })
      root = createRoot(container)
      render()
      await settle()

      expect(casts()).toHaveLength(1)
      // And the optimistic bump is corrected by the server's own numbers.
      expect(
        container.querySelector<HTMLElement>(
          '[data-testid="whats-new-vote-count"]',
        )?.textContent,
      ).toBe("No votes yet")
    })

    it("does not resend a placement that already landed", async () => {
      // Anti-vacuous companion to the retry above: if `sent` were never
      // written, every mount would re-cast every sticker the reader owns.
      render()
      await settle()
      place(love.id, first.id)
      await settle()

      act(() => {
        root.unmount()
      })
      root = createRoot(container)
      render()
      await settle()

      expect(casts()).toHaveLength(1)
    })

    it("does not take back a placement the server never had", async () => {
      render()
      await settle()
      failNext = true
      place(love.id, first.id)
      await settle()

      click(`whats-new-vote-peel-${first.id}-0`)
      await settle()

      // Retracting an unsent placement would be a request for a row that does
      // not exist, and its budget slot was never spent.
      expect(retractions()).toHaveLength(0)
    })

    it("keeps rendering when the server is unreachable", async () => {
      // Voting is an extra on an announcement page. If the tally read fails
      // the cards must still be there, and the sticker must still stick.
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("offline")
        }),
      )
      render()
      await settle()
      place(love.id, first.id)
      await settle()

      expect(stuckOn(first.id)).toBe(1)
      expect(
        container.querySelectorAll('[data-testid="whats-new-vote-card"]'),
      ).toHaveLength(WHATS_NEW_VOTES.features.length)
    })
  })
})
