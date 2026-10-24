/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WhatsNewNoteBoard } from "@/components/whats-new/WhatsNewNoteBoard"
import { WHATS_NEW_BOARD } from "@/components/whats-new/whats-new-content"
import { WATCH_FEEDBACK_OPEN_EVENT } from "@/lib/watch-feedback-events"

const STORAGE_KEY = "watch:whats-new:board-notes"
const MAX_TEXT = 100
const MAX_NOTES = 12
/** What a starter note holds; see the test below. */
const SEED_MAX_TEXT = 90

const [praise, requests] = WHATS_NEW_BOARD.boards
const [butter, rose] = WHATS_NEW_BOARD.papers

/** The cork the component measures drags against. jsdom lays nothing out. */
const SURFACE = { left: 0, top: 0, width: 1000, height: 500 }

let container: HTMLDivElement
let root: Root

const q = <T extends Element>(id: string) =>
  container.querySelector<T>(`[data-testid="${id}"]`)

function render() {
  act(() => {
    root.render(<WhatsNewNoteBoard contentClass="mx-auto max-w-7xl" />)
  })
}

function click(testId: string) {
  act(() => {
    q<HTMLButtonElement>(testId)?.click()
  })
}

function type(value: string) {
  const field = q<HTMLTextAreaElement>("whats-new-board-input")
  if (!field) throw new Error("no composer")
  act(() => {
    // React tracks the last value it wrote, so setting `.value` directly is
    // ignored on the next change event. Go through the native setter.
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

function write(text: string) {
  type(text)
  click("whats-new-board-pin")
}

/**
 * Dispatch a pointer event React will pick up. jsdom ships no
 * `PointerEvent`, so this is a MouseEvent carrying the two pointer fields
 * the component reads.
 */
function pointerEvent(
  kind: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  const event = new MouseEvent(kind, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  })
  Object.defineProperty(event, "pointerId", { value: 7 })
  Object.defineProperty(event, "pointerType", { value: "mouse" })
  return event
}

function pointer(
  element: Element,
  kind: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
) {
  act(() => {
    element.dispatchEvent(pointerEvent(kind, x, y))
  })
}

/**
 * A whole gesture inside ONE `act`, so React never re-renders between the
 * events — which is what a real browser does when press, move, and release
 * land in the same task. Dispatching each event in its own `act` flushes a
 * render in between and hides any handler that reads drag state from a
 * stale render closure.
 */
function drag(
  element: Element,
  points: ReadonlyArray<{ x: number; y: number }>,
) {
  act(() => {
    element.dispatchEvent(pointerEvent("pointerdown", points[0].x, points[0].y))
    for (const point of points.slice(1, -1)) {
      element.dispatchEvent(pointerEvent("pointermove", point.x, point.y))
    }
    const last = points[points.length - 1]
    element.dispatchEvent(pointerEvent("pointermove", last.x, last.y))
    element.dispatchEvent(pointerEvent("pointerup", last.x, last.y))
  })
}

function key(element: Element, code: string, shiftKey = false) {
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: code,
        bubbles: true,
        cancelable: true,
        shiftKey,
      }),
    )
  })
}

const notes = () => [
  ...container.querySelectorAll<HTMLElement>(
    '[data-testid="whats-new-board-note"]',
  ),
]

const mine = () => [
  ...container.querySelectorAll<HTMLElement>(
    '[data-testid="whats-new-board-note"][data-mine]',
  ),
]

const textOf = (note: HTMLElement) => note.textContent ?? ""

const stored = () =>
  JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")

/**
 * Where a note sits, read back off the positioned `li`. `left`/`top` are
 * `clamp(<half>, <n>%, calc(100% - <half>))` — the CSS edge guard that
 * keeps a note on the cork at narrow widths — so pull the percentage out
 * of the middle rather than parsing from the start of the string.
 */
function percentOf(value: string): number {
  const match = /,\s*(-?[\d.]+)%\s*,/.exec(value)
  if (!match) throw new Error(`no percentage in ${value}`)
  return Number.parseFloat(match[1])
}

/**
 * The `li` is the grid cell and keeps its square whether or not the note is
 * still in it; the position lives on the frame INSIDE it, which is what
 * floats out when a note is dragged.
 */
const frameOf = (note: HTMLElement) =>
  note.querySelector<HTMLElement>("[data-note-frame]") as HTMLElement

const spotOf = (note: HTMLElement) => ({
  x: percentOf(frameOf(note).style.left),
  y: percentOf(frameOf(note).style.top),
})

/** Notes lifted out of the grid and positioned on the cork. */
const placed = () => [
  ...container.querySelectorAll<HTMLElement>(
    '[data-testid="whats-new-board-note"][data-placed]',
  ),
]

beforeEach(() => {
  window.localStorage.clear()

  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    ...SURFACE,
    right: SURFACE.width,
    bottom: SURFACE.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
  // jsdom implements neither, and the drag path calls both.
  HTMLElement.prototype.setPointerCapture = vi.fn()
  HTMLElement.prototype.releasePointerCapture = vi.fn()
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true)

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
  vi.restoreAllMocks()
})

describe("WhatsNewNoteBoard", () => {
  it("opens on the first board with its starter notes pinned up", () => {
    render()

    expect(
      q("whats-new-board-tab-" + praise.id)?.getAttribute("aria-selected"),
    ).toBe("true")
    expect(notes()).toHaveLength(praise.notes.length)
    for (const note of praise.notes) {
      expect(q(`whats-new-board-seed-${note.id}`)).not.toBeNull()
    }
  })

  it("keeps every starter note inside the space a starter actually has", () => {
    // The square is sized for an average-length note; longer notes step the
    // type down instead of the square growing (see TEXT_SIZES in the
    // component). Measured, not derived: with the credit line in place a
    // starter holds 68 characters of ordinary prose at the largest size, 90
    // at the middle one and 118 at the smallest (Chrome, checked at 320px
    // and 1280px). This bound keeps every starter inside the MIDDLE tier,
    // so nothing on the board is set in the fallback size.
    //
    // A character count is only ever a coarse guard, because what decides
    // the fit is how a sentence WRAPS — capacity moves in whole lines, so
    // two notes of equal length can differ. jsdom lays nothing out, so this
    // suite cannot see that; the real check is rendering every starter at a
    // 320px viewport and asserting its text does not overflow.
    expect(SEED_MAX_TEXT).toBeLessThanOrEqual(90)

    for (const board of WHATS_NEW_BOARD.boards) {
      for (const note of board.notes) {
        expect(note.text.length, note.id).toBeLessThanOrEqual(SEED_MAX_TEXT)
      }
    }
  })

  it("says where the starter notes came from", () => {
    render()

    // The starters are real messages people sent support, not copy we
    // wrote. Showing them unattributed is only honest if the section says
    // what they are, so the provenance line is part of the contract.
    expect(q("whats-new-board-provenance")?.textContent).toBe(
      WHATS_NEW_BOARD.provenance,
    )
  })

  it("credits each starter by first name, and by country when it is known", () => {
    render()

    for (const note of praise.notes) {
      const rendered = q(`whats-new-board-seed-${note.id}`)?.textContent ?? ""
      expect(rendered, note.id).toContain(note.name)
      if ("country" in note && note.country) {
        expect(rendered, note.id).toContain(`${note.name}, ${note.country}`)
      }
    }
  })

  it("carries no surname, address, or contact detail on any starter", () => {
    // These came out of a support inbox, and the upstream sanitiser redacts
    // emails and phone numbers but leaves NAMES intact. The agreed line is
    // first name plus country — so a surname is as much a leak here as an
    // email would be, and this is the last guard before it ships.
    const forbidden: Array<[RegExp, string]> = [
      [/@[a-z0-9.-]+\.[a-z]{2,}/i, "an email address"],
      [/\bredacted\b/i, "a redaction marker left in place"],
      [/\+?\d[\d ().-]{7,}\d/, "a phone number"],
      [
        /\b\d{2,6}\s+[A-Z][a-z]+\s+(St|Street|Rd|Road|Ave|Avenue)\b/,
        "a street address",
      ],
      [/\bhttps?:\/\//i, "a URL"],
    ]
    for (const board of WHATS_NEW_BOARD.boards) {
      for (const note of board.notes) {
        for (const [pattern, what] of forbidden) {
          expect(pattern.test(note.text), `${note.id} contains ${what}`).toBe(
            false,
          )
        }
        // One word: a surname would ride along in the same field.
        expect(note.name.trim().split(/\s+/), note.id).toHaveLength(1)
      }
    }
  })

  it("carries no feedback about the mobile app", () => {
    // The board is about the Watch website. App feedback arrives through
    // the app's own form and is a different product, so it must not be
    // mixed in here — these markers are what that form stamps on it.
    const appish =
      /\bapp version\b|\bos version\b|\bplay store\b|\bapp store\b|\bapk\b|\bthe app\b|\byour app\b|\bthis app\b/i
    for (const board of WHATS_NEW_BOARD.boards) {
      for (const note of board.notes) {
        expect(appish.test(note.text), `${note.id} mentions the app`).toBe(
          false,
        )
      }
    }
  })

  it("switches boards from the tabs and swaps which notes are on the cork", () => {
    render()

    click(`whats-new-board-tab-${requests.id}`)

    expect(
      q(`whats-new-board-tab-${requests.id}`)?.getAttribute("aria-selected"),
    ).toBe("true")
    expect(
      q(`whats-new-board-tab-${praise.id}`)?.getAttribute("aria-selected"),
    ).toBe("false")
    expect(q(`whats-new-board-seed-${praise.notes[0].id}`)).toBeNull()
    expect(q(`whats-new-board-seed-${requests.notes[0].id}`)).not.toBeNull()
  })

  it("moves between tabs with the arrow keys and keeps one tab stop", () => {
    render()

    const first = q<HTMLButtonElement>(`whats-new-board-tab-${praise.id}`)
    expect(first?.tabIndex).toBe(0)
    expect(
      q<HTMLButtonElement>(`whats-new-board-tab-${requests.id}`)?.tabIndex,
    ).toBe(-1)

    key(first as Element, "ArrowRight")

    expect(
      q(`whats-new-board-tab-${requests.id}`)?.getAttribute("aria-selected"),
    ).toBe("true")
    expect(
      q<HTMLButtonElement>(`whats-new-board-tab-${requests.id}`)?.tabIndex,
    ).toBe(0)
  })

  it("pins a written note to the board and remembers it", () => {
    render()
    write("Our team showed this on a projector in Nairobi.")

    const pinnedNote = mine()
    expect(pinnedNote).toHaveLength(1)
    expect(textOf(pinnedNote[0])).toContain("projector in Nairobi")
    expect(q("whats-new-board-count")?.textContent).toContain("1")
    expect(stored()[praise.id].notes[0].t).toBe(
      "Our team showed this on a projector in Nairobi.",
    )
    // The composer empties so the next note starts from a blank sheet.
    expect(q<HTMLTextAreaElement>("whats-new-board-input")?.value).toBe("")
  })

  it("pins onto the board that is open, and only that board", () => {
    render()
    click(`whats-new-board-tab-${requests.id}`)
    write("Offline downloads that survive a bad signal.")

    expect(mine()).toHaveLength(1)
    expect(stored()[requests.id].notes).toHaveLength(1)
    expect(stored()[praise.id]).toBeUndefined()

    click(`whats-new-board-tab-${praise.id}`)
    expect(mine()).toHaveLength(0)
  })

  it("writes the note on the paper the reader picked", () => {
    render()
    click(`whats-new-board-paper-${rose.id}`)
    write("Pink one.")

    expect(stored()[praise.id].notes[0].p).toBe(rose.id)
    expect(
      q(`whats-new-board-paper-${rose.id}`)?.getAttribute("aria-pressed"),
    ).toBe("true")
    expect(
      q(`whats-new-board-paper-${butter.id}`)?.getAttribute("aria-pressed"),
    ).toBe("false")
  })

  it("refuses a blank note", () => {
    render()
    write("   \n  ")

    expect(mine()).toHaveLength(0)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it("pins on Enter but keeps Shift+Enter for a line break", () => {
    render()
    type("Straight to the board.")
    const field = q<HTMLTextAreaElement>("whats-new-board-input") as Element
    key(field, "Enter", true)
    expect(mine()).toHaveLength(0)

    key(field, "Enter")
    expect(mine()).toHaveLength(1)
  })

  it("takes a note back down", () => {
    render()
    write("Wrong board, sorry.")
    const id = stored()[praise.id].notes[0].id

    click(`whats-new-board-unpin-${id}`)

    expect(mine()).toHaveLength(0)
    expect(stored()[praise.id].notes).toHaveLength(0)
    // The starter notes are not the reader's to remove.
    expect(notes()).toHaveLength(praise.notes.length)
  })

  it("clears only the open board's notes", () => {
    render()
    write("Praise note.")
    click(`whats-new-board-tab-${requests.id}`)
    write("Request note.")

    click("whats-new-board-clear")

    expect(mine()).toHaveLength(0)
    expect(stored()[requests.id].notes).toHaveLength(0)
    expect(stored()[praise.id].notes).toHaveLength(1)
  })

  it("stops accepting notes once the board is full", () => {
    render()
    for (let index = 0; index < MAX_NOTES; index += 1) write(`Note ${index}`)

    expect(mine()).toHaveLength(MAX_NOTES)

    type("One too many")
    expect(q<HTMLButtonElement>("whats-new-board-pin")?.disabled).toBe(true)
    expect(q("whats-new-board-pin")?.textContent).toContain(
      WHATS_NEW_BOARD.fullLabel,
    )

    click("whats-new-board-pin")
    expect(mine()).toHaveLength(MAX_NOTES)
  })

  /**
   * Every element shares one stubbed rect here, so a note measures its
   * centre at the middle of the cork. That is the origin every drag below
   * starts from.
   */
  const CENTRE = { x: SURFACE.width / 2, y: SURFACE.height / 2 }

  it("drags a note to where the pointer let go of it", () => {
    render()
    write("Drag me.")
    const id = stored()[praise.id].notes[0].id
    const handle = q(`whats-new-board-mine-${id}`) as Element

    // Straight off the wall: the note starts in the grid with no stored
    // position at all.
    expect(stored()[praise.id].notes[0].spot).toBeUndefined()
    expect(placed()).toHaveLength(0)

    pointer(handle, "pointerdown", CENTRE.x, CENTRE.y)
    pointer(handle, "pointermove", 800, 200)

    // Live position tracks the pointer before anything is committed.
    expect(spotOf(mine()[0])).toEqual({ x: 80, y: 40 })
    expect(stored()[praise.id].notes[0].spot).toBeUndefined()

    pointer(handle, "pointerup", 800, 200)

    expect(stored()[praise.id].notes[0].spot).toMatchObject({ x: 80, y: 40 })
    expect(placed()).toHaveLength(1)
    expect(HTMLElement.prototype.setPointerCapture).toHaveBeenCalled()
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalled()
  })

  it("leaves its cell behind when a note is lifted out", () => {
    // Lifting a note used to take its grid cell with it, so the whole wall
    // reflowed around the gap the moment you grabbed one. Asserting on
    // geometry would be vacuous here — this suite stubs one rect for every
    // element — so assert the structure that CAUSES the reflow instead: the
    // cell stays a cell, and only the frame inside it floats out.
    render()
    const seed = praise.notes[2]
    const handle = q(`whats-new-board-seed-${seed.id}`) as Element
    const cellOf = () =>
      (q(`whats-new-board-seed-${seed.id}`) as HTMLElement).closest(
        '[data-testid="whats-new-board-note"]',
      ) as HTMLElement

    expect(cellOf().className).toContain("size-[8.75rem]")
    expect(frameOf(cellOf()).className).toContain("relative")

    drag(handle, [CENTRE, { x: 800, y: 200 }])

    const cell = cellOf()
    // The cell is untouched: still a fixed square, still in flow.
    expect(cell.className).toContain("size-[8.75rem]")
    expect(cell.className).not.toContain("absolute")
    // Only the frame inside it left the grid.
    expect(frameOf(cell).className).toContain("absolute")
    // And no cell was added or removed, so nothing after it shifts up.
    expect(notes()).toHaveLength(praise.notes.length)
    expect(placed()).toHaveLength(1)
  })

  it("leaves a tapped note in the grid instead of tearing it out", () => {
    // Reading a note must not rearrange the wall around it, so a press
    // that never travels is a tap — no position, no reflow.
    render()
    write("Just looking.")
    const id = stored()[praise.id].notes[0].id
    const handle = q(`whats-new-board-mine-${id}`) as Element

    pointer(handle, "pointerdown", CENTRE.x, CENTRE.y)
    pointer(handle, "pointermove", CENTRE.x + 3, CENTRE.y + 2)
    pointer(handle, "pointerup", CENTRE.x + 3, CENTRE.y + 2)

    expect(stored()[praise.id].notes[0].spot).toBeUndefined()
    expect(placed()).toHaveLength(0)
  })

  it("keeps a dragged note on the cork", () => {
    render()
    write("Off the edge.")
    const id = stored()[praise.id].notes[0].id
    const handle = q(`whats-new-board-mine-${id}`) as Element

    pointer(handle, "pointerdown", CENTRE.x, CENTRE.y)
    pointer(handle, "pointermove", 4000, -900)
    pointer(handle, "pointerup", 4000, -900)

    expect(stored()[praise.id].notes[0].spot).toMatchObject({ x: 90, y: 10 })
  })

  it("moves a starter note too, and remembers where it was put", () => {
    render()
    const seed = praise.notes[0]
    const handle = q(`whats-new-board-seed-${seed.id}`) as Element

    pointer(handle, "pointerdown", CENTRE.x, CENTRE.y)
    pointer(handle, "pointermove", 300, 350)
    pointer(handle, "pointerup", 300, 350)

    expect(stored()[praise.id].moved[seed.id]).toMatchObject({ x: 30, y: 70 })
  })

  it("follows the pointer when the whole gesture beats the next render", () => {
    // Caught in a real browser, not here: with the drag identity in React
    // state, `pointermove` and `pointerup` read `null` from the closure of
    // the render that had not happened yet, so the note never moved.
    render()
    write("Same-task drag.")
    const id = stored()[praise.id].notes[0].id
    const handle = q(`whats-new-board-mine-${id}`) as Element

    drag(handle, [CENTRE, { x: 600, y: 250 }, { x: 750, y: 150 }])

    expect(stored()[praise.id].notes[0].spot).toMatchObject({ x: 75, y: 30 })
  })

  it("ignores a pointer gesture that never took hold of the note", () => {
    render()
    write("Never grabbed.")
    const id = stored()[praise.id].notes[0].id
    const handle = q(`whats-new-board-mine-${id}`) as Element

    // A move and a release with no `pointerdown` — a gesture that began on
    // something else and was captured elsewhere.
    pointer(handle, "pointermove", 750, 150)
    pointer(handle, "pointerup", 750, 150)

    expect(stored()[praise.id].notes[0].spot).toBeUndefined()
  })

  it("nudges a note with the arrow keys, lifting it off the wall", () => {
    render()
    write("Nudge me.")
    const id = stored()[praise.id].notes[0].id
    const handle = q(`whats-new-board-mine-${id}`) as Element

    // The first nudge has no stored position to work from, so it starts
    // from where the browser had already put the note.
    key(handle, "ArrowRight")
    expect(stored()[praise.id].notes[0].spot).toMatchObject({ x: 52, y: 50 })

    key(handle, "ArrowUp", true)
    expect(stored()[praise.id].notes[0].spot).toMatchObject({ x: 52, y: 42 })
  })

  it("takes a note down with Delete, and leaves starter notes alone", () => {
    render()
    write("Delete me.")
    const id = stored()[praise.id].notes[0].id

    key(q(`whats-new-board-mine-${id}`) as Element, "Delete")
    expect(mine()).toHaveLength(0)

    const seed = praise.notes[0]
    key(q(`whats-new-board-seed-${seed.id}`) as Element, "Delete")
    expect(q(`whats-new-board-seed-${seed.id}`)).not.toBeNull()
  })

  it("opens the feedback composer from the send button", () => {
    const listener = vi.fn()
    window.addEventListener(WATCH_FEEDBACK_OPEN_EVENT, listener)
    render()

    click("whats-new-board-send")

    expect(listener).toHaveBeenCalledTimes(1)
    window.removeEventListener(WATCH_FEEDBACK_OPEN_EVENT, listener)
  })

  it("caps how long a note can be", () => {
    render()
    write("x".repeat(MAX_TEXT + 90))

    expect(stored()[praise.id].notes[0].t).toHaveLength(MAX_TEXT)
    expect(q<HTMLTextAreaElement>("whats-new-board-input")?.maxLength).toBe(
      MAX_TEXT,
    )
  })

  it("drops anything hand-edited storage cannot be trusted to hold", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        // A board that does not exist.
        "not-a-board": { notes: [{ id: "a", t: "hi", p: butter.id }] },
        [praise.id]: {
          notes: [
            // No spot at all is legitimate: it just belongs in the grid.
            { id: "ok", t: "Kept.", p: butter.id },
            // Parked far off the cork.
            {
              id: "far",
              t: "Hauled back.",
              p: butter.id,
              spot: { x: 9000, y: -9000, r: 99 },
            },
            // Paper stock we do not print.
            { id: "bad-paper", t: "Dropped.", p: "neon" },
            // Longer than the composer allows.
            { id: "long", t: "y".repeat(MAX_TEXT + 50), p: butter.id },
            // A second note claiming an id already taken.
            { id: "ok", t: "Impostor.", p: butter.id },
            // Not text at all.
            { id: "nan", t: { evil: true }, p: butter.id },
            // Empty once trimmed.
            { id: "blank", t: "   ", p: butter.id },
            // A spot that is not an object.
            {
              id: "junk-spot",
              t: "Still fine.",
              p: butter.id,
              spot: "over there",
            },
          ],
          // A seed id from no board at all.
          moved: { "seed-that-never-was": { x: 10, y: 10, r: 0 } },
        },
      }),
    )
    render()

    const kept = mine().map(textOf)
    expect(kept).toHaveLength(4)
    expect(kept.some((text) => text.includes("Kept."))).toBe(true)
    expect(kept.some((text) => text.includes("Hauled back."))).toBe(true)
    expect(kept.some((text) => text.includes("Still fine."))).toBe(true)
    expect(kept.some((text) => text.includes("Impostor."))).toBe(false)
    expect(kept.some((text) => text.includes("Dropped."))).toBe(false)

    // Only the one with a spot is lifted out of the grid, and it is hauled
    // back onto the cork.
    expect(placed()).toHaveLength(1)
    expect(spotOf(placed()[0])).toEqual({ x: 90, y: 10 })

    const long = mine().find((note) => textOf(note).includes("y"))
    expect(long?.textContent?.trim()).toHaveLength(MAX_TEXT)

    // The unknown board and the unknown seed never reach the cork.
    expect(container.textContent).not.toContain("not-a-board")
    expect(notes()).toHaveLength(praise.notes.length + 4)
  })

  it("never mints more notes than the cap, whatever storage claims", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        [praise.id]: {
          notes: Array.from({ length: MAX_NOTES + 25 }, (_, index) => ({
            id: `s${index}`,
            t: `Smuggled ${index}`,
            p: butter.id,
            x: 50,
            y: 50,
            r: 0,
          })),
        },
      }),
    )
    render()

    expect(mine()).toHaveLength(MAX_NOTES)
  })

  it("survives storage that is not an object at all", () => {
    window.localStorage.setItem(STORAGE_KEY, "not json {{{")
    render()

    expect(notes()).toHaveLength(praise.notes.length)
    expect(mine()).toHaveLength(0)
  })
})
