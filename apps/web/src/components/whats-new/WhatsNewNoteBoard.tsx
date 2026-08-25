"use client"

import {
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { PenLine, Send, X } from "lucide-react"

import {
  WHATS_NEW_BOARD,
  type WhatsNewBoardId,
  type WhatsNewPaperId,
} from "@/components/whats-new/whats-new-content"
import { requestWatchFeedback } from "@/lib/watch-feedback-events"

const STORAGE_KEY = "watch:whats-new:board-notes"

const { boards, papers } = WHATS_NEW_BOARD

/** How much of the board's edge stays clear, as a percentage. */
const EDGE = 10
const MAX_NOTES = 12
const MAX_TEXT = 100
/** Arrow-key nudge, and the coarser Shift-arrow step. */
const NUDGE = 2
const NUDGE_FAST = 8
/**
 * How far the pointer travels before a press counts as a drag rather than
 * a tap. Without it, touching a note to read it would tear it out of the
 * grid and rearrange the board around it.
 */
const LIFT_THRESHOLD_PX = 6

/**
 * Paper stock. Held here rather than in the content module because these
 * are surface tokens, not copy — the module owns the human-readable label
 * for each id, this owns what the paper looks like.
 */
const PAPERS: Record<
  WhatsNewPaperId,
  { face: string; shade: string; ink: string }
> = {
  butter: { face: "#fde68a", shade: "#eecb63", ink: "#443709" },
  rose: { face: "#fbcfe8", shade: "#ecb0d3", ink: "#4c1d38" },
  sky: { face: "#bfdbfe", shade: "#a1c2ee", ink: "#152f5c" },
  mint: { face: "#bbf7d0", shade: "#98e3b3", ink: "#0f3d23" },
  peach: { face: "#fed7aa", shade: "#f2bc85", ink: "#4c2a0d" },
}

const PAPER_IDS: ReadonlySet<string> = new Set(papers.map((paper) => paper.id))
const BOARD_IDS: ReadonlySet<string> = new Set(boards.map((board) => board.id))

/** Where a note was dragged to: position (%) and rotation. */
type Spot = { x: number; y: number; r: number }
/**
 * A note the reader wrote. `spot` is absent until it has been dragged —
 * an un-dragged note sits in the board's grid, which is what lets a wall
 * of forty notes stay legible from a phone to a desktop without the
 * component knowing how wide the cork is.
 */
type Mine = {
  id: string
  t: string
  p: WhatsNewPaperId
  spot?: Spot
}
type BoardState = { notes: Mine[]; moved: Record<string, Spot> }
type Stored = Partial<Record<WhatsNewBoardId, BoardState>>

const EMPTY_BOARD: BoardState = Object.freeze({
  notes: Object.freeze([]) as unknown as Mine[],
  moved: Object.freeze({}),
})

function clamp(value: unknown, min: number, max: number, fallback = 50) {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, parsed))
}

const clampXY = (value: unknown) => clamp(value, EDGE, 100 - EDGE)
const clampR = (value: unknown) => clamp(value, -14, 14, 0)

/** A stored spot, or undefined when the note belongs in the grid. */
function readSpot(value: unknown): Spot | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { x, y, r } = value as Record<string, unknown>
  if (x == null && y == null) return undefined
  return { x: clampXY(x), y: clampXY(y), r: clampR(r) }
}

function seedIdsFor(boardId: string): ReadonlySet<string> {
  const board = boards.find((entry) => entry.id === boardId)
  return new Set(board?.notes.map((note) => note.id) ?? [])
}

/**
 * Drop anything the board cannot honour. Storage is user-writable, so a
 * hand-edited value must never mint a longer note than the composer
 * allows, park a note off the cork, or move a seed that does not exist.
 */
function sanitise(raw: unknown): Stored {
  if (typeof raw !== "object" || raw === null) return {}
  const next: Stored = {}

  for (const [boardId, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!BOARD_IDS.has(boardId)) continue
    if (typeof value !== "object" || value === null) continue

    const { notes, moved } = value as Record<string, unknown>
    const keptNotes: Mine[] = []

    if (Array.isArray(notes)) {
      for (const entry of notes) {
        if (keptNotes.length >= MAX_NOTES) break
        if (typeof entry !== "object" || entry === null) continue
        const { id, t, p, spot } = entry as Record<string, unknown>
        if (typeof id !== "string" || id === "") continue
        if (typeof t !== "string") continue
        const text = t.trim().slice(0, MAX_TEXT)
        if (text === "") continue
        if (typeof p !== "string" || !PAPER_IDS.has(p)) continue
        // Ids address notes for removal and drag; a duplicate would make
        // one note un-addressable.
        if (keptNotes.some((kept) => kept.id === id)) continue
        keptNotes.push({
          id,
          t: text,
          p: p as WhatsNewPaperId,
          ...(readSpot(spot) ? { spot: readSpot(spot) } : {}),
        })
      }
    }

    const seeds = seedIdsFor(boardId)
    const keptMoved: Record<string, Spot> = {}
    if (typeof moved === "object" && moved !== null) {
      for (const [seedId, value] of Object.entries(
        moved as Record<string, unknown>,
      )) {
        if (!seeds.has(seedId)) continue
        const spot = readSpot(value)
        if (spot) keptMoved[seedId] = spot
      }
    }

    if (keptNotes.length > 0 || Object.keys(keptMoved).length > 0) {
      next[boardId as WhatsNewBoardId] = { notes: keptNotes, moved: keptMoved }
    }
  }

  return next
}

/**
 * localStorage as an external store rather than an effect that calls
 * setState on mount — same shape as the sticker board further down the
 * page. `getServerSnapshot` returns a frozen empty board so server and
 * hydrating client agree, and `getSnapshot` caches the raw string so its
 * reference stays stable, which React requires.
 */
const EMPTY: Stored = Object.freeze({})
const listeners = new Set<() => void>()
let cachedRaw: string | null = null
let cachedStored: Stored = EMPTY

function readStored(): Stored {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedStored = raw ? sanitise(JSON.parse(raw)) : EMPTY
    }
  } catch {
    cachedRaw = null
    cachedStored = EMPTY
  }
  return cachedStored
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

function writeStored(next: Stored): void {
  cachedStored = next
  try {
    cachedRaw = JSON.stringify(next)
    window.localStorage.setItem(STORAGE_KEY, cachedRaw)
  } catch {
    cachedRaw = null
  }
  for (const listener of listeners) listener()
}

let minted = 0
function mintId(): string {
  minted += 1
  return `n${Date.now().toString(36)}${minted.toString(36)}`
}

/**
 * How big the writing on a note is, chosen from the length of the text.
 *
 * The square is sized for an average-length note, so the longer ones step
 * the type down rather than the square growing — a wall of one-size notes
 * is the point. These numbers are MEASURED, not derived: on an 8.75rem
 * square with 0.625rem padding and the credit line in place, a note holds
 * 68 characters of ordinary prose at 0.8125rem, 90 at 0.75rem and 118 at
 * 0.6875rem (Chrome, checked at both 320px and 1280px, 2026-08-25).
 *
 * Each threshold sits a few characters under its measurement because what
 * actually decides the fit is how a sentence WRAPS, not its raw length —
 * capacity moves in whole lines, so two notes of equal length can differ.
 * Re-measure on any change to the square, padding, font, or credit line;
 * the browser check over every starter is the real guard.
 */
const TEXT_SIZES: ReadonlyArray<{ upTo: number; className: string }> = [
  { upTo: 65, className: "text-[0.8125rem]" },
  { upTo: 86, className: "text-[0.75rem]" },
  { upTo: Number.POSITIVE_INFINITY, className: "text-[0.6875rem]" },
]

function textSizeFor(text: string): string {
  const tier = TEXT_SIZES.find((entry) => text.length <= entry.upTo)
  return (tier ?? TEXT_SIZES[TEXT_SIZES.length - 1]).className
}

/**
 * The tilt a note sits at while it is still in the grid. Deterministic per
 * slot so the wall looks hand-pinned rather than typeset, and so server
 * and client agree on it.
 */
function leanOf(index: number): number {
  return (((index * 37) % 9) - 4) * 0.9
}

/** A note as rendered: seeds and reader notes share one shape here. */
type Pinned = {
  key: string
  seedId?: string
  noteId?: string
  text: string
  /** "Beth" or "Jemima, Philippines"; empty for the reader's own notes. */
  credit: string
  paper: WhatsNewPaperId
  /** Present once dragged; absent means it belongs in the grid. */
  spot?: Spot
  index: number
  mine: boolean
}

export function WhatsNewNoteBoard({ contentClass }: { contentClass: string }) {
  const headingId = useId()
  const tabPrefix = useId()
  const stored = useSyncExternalStore(subscribe, readStored, () => EMPTY)

  const [activeId, setActiveId] = useState<WhatsNewBoardId>(boards[0].id)
  const [draft, setDraft] = useState("")
  const [paper, setPaper] = useState<WhatsNewPaperId>(papers[0].id)
  // Live position while a note is under the pointer. Kept out of storage
  // so a drag does not write to localStorage on every frame.
  const [drag, setDrag] = useState<{
    key: string
    x: number
    y: number
  } | null>(null)
  /**
   * The note under the pointer: where inside it the reader took hold, the
   * spot it started from, and whether the pointer has travelled far enough
   * to count as a drag.
   *
   * A ref, not state, and this is load-bearing: `pointerdown` and the first
   * `pointermove` can land in the same task, before React has re-rendered,
   * so a state-held identity leaves the move and release handlers reading
   * `null` from a stale closure and the note never moves.
   */
  const held = useRef<{
    key: string
    grabX: number
    grabY: number
    from: Spot
    startClientX: number
    startClientY: number
    lifted: boolean
  } | null>(null)
  const surface = useRef<HTMLDivElement>(null)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  const board = boards.find((entry) => entry.id === activeId) ?? boards[0]
  const state = stored[board.id] ?? EMPTY_BOARD
  const full = state.notes.length >= MAX_NOTES

  const pinned: Pinned[] = [
    ...board.notes.map(
      (note, index): Pinned => ({
        key: `seed:${note.id}`,
        seedId: note.id,
        text: note.text,
        credit:
          "country" in note && note.country
            ? `${note.name}, ${note.country}`
            : note.name,
        paper: note.p,
        spot: state.moved[note.id],
        index,
        mine: false,
      }),
    ),
    ...state.notes.map(
      (note, index): Pinned => ({
        key: `mine:${note.id}`,
        noteId: note.id,
        text: note.t,
        credit: "",
        paper: note.p,
        spot: note.spot,
        index: board.notes.length + index,
        mine: true,
      }),
    ),
  ]

  function patch(next: Partial<BoardState>): void {
    writeStored({
      ...stored,
      [board.id]: { notes: state.notes, moved: state.moved, ...next },
    })
  }

  function pin(): void {
    const text = draft.trim().slice(0, MAX_TEXT)
    if (text === "" || full) return
    // No spot: a new note joins the wall in the grid, and only leaves it
    // if the reader drags it somewhere.
    patch({ notes: [...state.notes, { id: mintId(), t: text, p: paper }] })
    setDraft("")
  }

  function unpin(noteId: string): void {
    patch({ notes: state.notes.filter((note) => note.id !== noteId) })
  }

  /** Commit a spot for either kind of note. */
  function move(entry: Pinned, spot: Spot): void {
    const next = {
      x: clampXY(spot.x),
      y: clampXY(spot.y),
      r: clampR(spot.r),
    }
    if (entry.noteId != null) {
      patch({
        notes: state.notes.map((note) =>
          note.id === entry.noteId ? { ...note, spot: next } : note,
        ),
      })
      return
    }
    if (entry.seedId != null) {
      patch({ moved: { ...state.moved, [entry.seedId]: next } })
    }
  }

  /** Pointer position as a percentage of the cork it is over. */
  function pointAt(event: {
    clientX: number
    clientY: number
  }): { x: number; y: number } | null {
    const element = surface.current
    if (!element) return null
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return null
    return {
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    }
  }

  /**
   * Where a note currently sits, as a percentage of the cork. Measured
   * from the DOM rather than read from state, because a note still in the
   * grid has no stored position — the browser decided where it went.
   */
  function centreOf(element: HTMLElement): { x: number; y: number } | null {
    const cork = surface.current
    if (!cork) return null
    const corkBox = cork.getBoundingClientRect()
    if (corkBox.width === 0 || corkBox.height === 0) return null
    const box = element.getBoundingClientRect()
    return {
      x: ((box.left + box.width / 2 - corkBox.left) / corkBox.width) * 100,
      y: ((box.top + box.height / 2 - corkBox.top) / corkBox.height) * 100,
    }
  }

  function startDrag(
    entry: Pinned,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (event.pointerType === "mouse" && event.button !== 0) return
    const point = pointAt(event)
    const centre = centreOf(event.currentTarget)
    if (!point || !centre) return
    held.current = {
      key: entry.key,
      // Where inside the note the reader took hold, so it does not jump to
      // centre itself under the pointer on the first move.
      grabX: point.x - centre.x,
      grabY: point.y - centre.y,
      from: {
        x: centre.x,
        y: centre.y,
        r: entry.spot?.r ?? leanOf(entry.index),
      },
      startClientX: event.clientX,
      startClientY: event.clientY,
      lifted: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  /** Where the note should sit for a pointer at `event`, or null. */
  function dragTo(
    entry: Pinned,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): { x: number; y: number } | null {
    const grab = held.current
    if (grab?.key !== entry.key) return null
    const point = pointAt(event)
    if (!point) return null
    return {
      x: clampXY(point.x - grab.grabX),
      y: clampXY(point.y - grab.grabY),
    }
  }

  function onDragMove(
    entry: Pinned,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const grab = held.current
    if (grab?.key !== entry.key) return
    if (!grab.lifted) {
      const travelled = Math.hypot(
        event.clientX - grab.startClientX,
        event.clientY - grab.startClientY,
      )
      if (travelled < LIFT_THRESHOLD_PX) return
      grab.lifted = true
    }
    const spot = dragTo(entry, event)
    if (!spot) return
    setDrag({ key: entry.key, ...spot })
  }

  function endDrag(
    entry: Pinned,
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const grab = held.current
    if (grab?.key !== entry.key) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    // Resolve the landing spot BEFORE releasing the ref: `dragTo` reads
    // `held.current`, so clearing it first makes every drop fall back to
    // where the note started.
    //
    // Read the release position rather than trusting the last move: a
    // coarse pointer can travel and lift with no `pointermove` in between,
    // and dropping that would snap the note back under the reader's finger.
    //
    // A press that never travelled is a tap: leave the note where it is,
    // in the grid, rather than tearing it out and reflowing the wall.
    const landing = grab.lifted
      ? (dragTo(entry, event) ??
        (drag?.key === entry.key ? { x: drag.x, y: drag.y } : grab.from))
      : undefined
    held.current = null
    setDrag(null)
    if (landing) move(entry, { ...landing, r: grab.from.r })
  }

  function onNoteKeyDown(
    entry: Pinned,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ): void {
    const step = event.shiftKey ? NUDGE_FAST : NUDGE
    const shift: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const delta = shift[event.key]
    if (delta) {
      event.preventDefault()
      // A note still in the grid has no coordinates yet, so the first
      // nudge lifts it off the wall from wherever the browser put it.
      const from = entry.spot ??
        centreOf(event.currentTarget) ?? { x: 50, y: 50 }
      move(entry, {
        x: from.x + delta[0],
        y: from.y + delta[1],
        r: entry.spot?.r ?? leanOf(entry.index),
      })
      return
    }
    if (
      entry.mine &&
      entry.noteId != null &&
      (event.key === "Delete" || event.key === "Backspace")
    ) {
      event.preventDefault()
      unpin(entry.noteId)
    }
  }

  /** Roving tab focus — the pattern the ARIA tabs practice expects. */
  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const order = boards.map((entry) => entry.id)
    const at = order.indexOf(board.id)
    const to =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (at + 1) % order.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (at - 1 + order.length) % order.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? order.length - 1
              : -1
    if (to < 0) return
    event.preventDefault()
    setActiveId(order[to])
    const next = tabRefs.current.get(order[to])
    next?.focus()
    // The track scrolls on a narrow screen, and focus alone does not always
    // bring the pill into view — arrowing to the last tab would select one
    // the reader cannot see. `nearest` on both axes so this never yanks the
    // page vertically when the tab is already on screen.
    next?.scrollIntoView({ inline: "nearest", block: "nearest" })
  }

  const paperStyle = (id: WhatsNewPaperId): CSSProperties =>
    ({
      "--paper": PAPERS[id].face,
      "--paper-shade": PAPERS[id].shade,
      "--paper-ink": PAPERS[id].ink,
    }) as CSSProperties

  return (
    <section
      id="board"
      aria-labelledby={headingId}
      data-testid="whats-new-board"
      className="watch-corkroom relative border-t border-black/10"
    >
      <div
        className={`${contentClass} pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-24 lg:pb-24`}
      >
        <div className="max-w-2xl">
          <p className="text-xs font-semibold tracking-[0.3em] text-[#3c2415]/60 uppercase sm:text-sm">
            {WHATS_NEW_BOARD.eyebrow}
          </p>
          <h2
            id={headingId}
            className="mt-4 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-[#2c1a0e] sm:text-4xl lg:text-5xl"
          >
            {WHATS_NEW_BOARD.heading}
          </h2>
          <p className="mt-4 text-base leading-7 text-[#3c2415]/75">
            {WHATS_NEW_BOARD.body}
          </p>
          {/* Where the notes already on the cork came from. These are real
              messages, so saying so is part of showing them. */}
          <p
            data-testid="whats-new-board-provenance"
            className="mt-3 text-sm leading-6 text-[#3c2415]/60"
          >
            {WHATS_NEW_BOARD.provenance}
          </p>
        </div>

        {/* File tabs, sitting on the top edge of the cork. */}
        <div
          role="tablist"
          aria-label={WHATS_NEW_BOARD.boardsLabel}
          data-testid="whats-new-board-tabs"
          /* A segmented pill: one soft track holding three pills, the
             current one filled. `w-max` keeps the track hugging its pills
             rather than stretching the full width, and the row scrolls
             instead of wrapping so the pill never breaks into two rows. */
          className="mt-10 flex w-max max-w-full items-center gap-1 overflow-x-auto rounded-full bg-[#2c1a0e]/[0.08] p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {boards.map((entry) => {
            const selected = entry.id === board.id
            return (
              <button
                key={entry.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(entry.id, node)
                  else tabRefs.current.delete(entry.id)
                }}
                type="button"
                role="tab"
                id={`${tabPrefix}-tab-${entry.id}`}
                aria-selected={selected}
                aria-controls={`${tabPrefix}-panel-${entry.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(entry.id)}
                onKeyDown={onTabKeyDown}
                data-testid={`whats-new-board-tab-${entry.id}`}
                className={`cursor-pointer rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c1a0e] sm:px-5 sm:py-2.5 sm:text-base ${
                  selected
                    ? "bg-[#2c1a0e] text-white"
                    : "text-[#2c1a0e]/70 hover:text-[#2c1a0e]"
                }`}
              >
                {entry.tab}
              </button>
            )
          })}
        </div>

        <div
          role="tabpanel"
          id={`${tabPrefix}-panel-${board.id}`}
          aria-labelledby={`${tabPrefix}-tab-${board.id}`}
          data-testid="whats-new-board-panel"
          className="relative mt-4 rounded-2xl border border-[#2c1a0e]/10 bg-white p-3 shadow-[0_18px_40px_-28px_rgba(44,26,14,0.45)] sm:p-4"
        >
          <div
            ref={surface}
            data-testid="whats-new-board-surface"
            /* A floor, not a fixed height: the cork keeps a board's worth of
               presence on a wide screen where fifteen notes only fill two
               rows, and still grows when a narrow screen stacks them or the
               reader pins more. A hard height would need an inner scroll
               region, which traps the page scroll on a phone. */
            className="relative min-h-[35rem] w-full rounded-xl pt-11 pb-4"
          >
            <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-xs font-semibold tracking-[0.28em] text-[#2c1a0e]/35 uppercase">
              {board.title}
            </p>

            {pinned.length === 0 ? (
              <p
                data-testid="whats-new-board-empty"
                className="py-16 text-center text-sm text-[#2c1a0e]/45"
              >
                {WHATS_NEW_BOARD.emptyLabel}
              </p>
            ) : null}

            {/* Un-dragged notes flow here, so a wall of forty stays legible
                from a phone to a desktop without this component ever
                measuring the cork. A dragged note is taken out of the flow
                and positioned absolutely over the same box. */}
            <ul /* Capped and centred: left to fill an ultra-wide cork the fifteen
                notes spread to ten columns and two rows, leaving half the
                board bare under the min-height. Holding the wall to about
                six columns keeps it dense at any width. Dragged notes are
                positioned against the whole cork, not this box, so the
                full board is still fair game. */
              className="mx-auto grid max-w-[62rem] grid-cols-[repeat(auto-fill,minmax(8.75rem,1fr))] justify-items-center gap-x-3 gap-y-5 sm:gap-x-4 sm:gap-y-6"
            >
              {pinned.map((entry) => {
                const live = drag?.key === entry.key ? drag : null
                const spot = live ?? entry.spot
                const lean = entry.spot?.r ?? leanOf(entry.index)

                return (
                  /* The cell keeps its square whether or not the note is
                     still sitting in it. Lifting a note used to take its
                     grid cell with it, so the whole wall reflowed around
                     the gap the moment you grabbed one; now the note
                     floats out of a placeholder that holds its place. The
                     `li` is deliberately UNPOSITIONED so the floating
                     frame inside it resolves against the board, not the
                     cell. */
                  <li
                    key={entry.key}
                    data-testid="whats-new-board-note"
                    data-mine={entry.mine ? "" : undefined}
                    data-placed={spot ? "" : undefined}
                    className="size-[8.75rem]"
                  >
                    <div
                      data-note-frame
                      style={
                        spot
                          ? ({
                              // Percentages alone put half a note past the
                              // board on a narrow screen. Clamping in CSS
                              // against the note's own half-size — exact,
                              // because the note is a fixed square — keeps
                              // every note on the board at every viewport
                              // without measuring anything, and bounds a
                              // drag at the edge.
                              //
                              // The margin is a little LARGER than the
                              // square's half: a note tilted by up to 14deg
                              // presents a corner ~21% further out than its
                              // flat edge. The board's own padding absorbs
                              // the rest, which is why the surface does not
                              // clip its overflow.
                              left: `clamp(var(--note-half), ${spot.x}%, calc(100% - var(--note-half)))`,
                              top: `clamp(var(--note-half), ${spot.y}%, calc(100% - var(--note-half)))`,
                              zIndex: live ? 30 : entry.mine ? 20 : 10,
                            } as CSSProperties)
                          : undefined
                      }
                      className={
                        spot
                          ? "absolute -translate-x-1/2 -translate-y-1/2 [--note-half:5rem]"
                          : "relative"
                      }
                    >
                      <button
                        type="button"
                        onPointerDown={(event) => startDrag(entry, event)}
                        onPointerMove={(event) => onDragMove(entry, event)}
                        onPointerUp={(event) => endDrag(entry, event)}
                        onPointerCancel={(event) => endDrag(entry, event)}
                        onKeyDown={(event) => onNoteKeyDown(entry, event)}
                        aria-label={`${WHATS_NEW_BOARD.moveLabel}: ${entry.text}${
                          entry.credit ? `, from ${entry.credit}` : ""
                        } — ${WHATS_NEW_BOARD.moveHint}`}
                        data-testid={
                          entry.noteId
                            ? `whats-new-board-mine-${entry.noteId}`
                            : `whats-new-board-seed-${entry.seedId}`
                        }
                        style={{
                          ...paperStyle(entry.paper),
                          rotate: live ? "0deg" : `${lean}deg`,
                        }}
                        /* A real square, not a box that grows with its text:
                         it is what a sticky note looks like, and it is what
                         makes the clamp above exact on both axes. */
                        className={`watch-note flex size-[8.75rem] cursor-grab touch-none flex-col p-2.5 text-left select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2c1a0e] active:cursor-grabbing ${
                          live
                            ? "scale-[1.06] shadow-[0_22px_34px_-14px_rgba(20,10,4,0.8)]"
                            : "watch-note-pop transition-transform duration-150 hover:-translate-y-1 hover:scale-[1.03]"
                        }`}
                      >
                        <span
                          data-note-text
                          className={`watch-note-ink min-h-0 flex-1 overflow-hidden leading-[1.3] break-words hyphens-auto ${textSizeFor(entry.text)}`}
                        >
                          {entry.text}
                        </span>
                        {entry.credit ? (
                          <span
                            aria-hidden
                            className="watch-note-ink mt-1 shrink-0 truncate text-[0.5625rem] opacity-70"
                          >
                            — {entry.credit}
                          </span>
                        ) : null}
                      </button>

                      {entry.mine && entry.noteId != null ? (
                        <button
                          type="button"
                          onClick={() => unpin(entry.noteId as string)}
                          aria-label={`${WHATS_NEW_BOARD.unpinLabel}: ${entry.text}`}
                          data-testid={`whats-new-board-unpin-${entry.noteId}`}
                          className="absolute -top-2 -right-2 grid size-6 cursor-pointer place-items-center rounded-full bg-[#2c1a0e] text-[#f6e7cd] opacity-0 shadow-md transition-opacity duration-150 hover:bg-[#4a2c16] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c1a0e] [li:focus-within_&]:opacity-100 [li:hover_&]:opacity-100"
                        >
                          <X aria-hidden className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* The pen and the pin box. */}
        <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
          <form
            data-testid="whats-new-board-composer"
            onSubmit={(event) => {
              event.preventDefault()
              pin()
            }}
            className="flex shrink-0 flex-col items-start gap-4 sm:flex-row sm:items-end"
          >
            <div className="w-full sm:w-auto">
              <label
                htmlFor={`${tabPrefix}-draft`}
                className="flex items-center gap-2 text-xs font-semibold tracking-[0.22em] text-[#3c2415]/70 uppercase"
              >
                <PenLine aria-hidden className="size-3.5" />
                {WHATS_NEW_BOARD.writeLabel}
              </label>
              <div
                style={paperStyle(paper)}
                /* The pad is the same square as the paper it becomes, so
                   what the reader writes is what they see land. */
                className="watch-note mt-3 flex size-[13rem] rotate-[-1.2deg] flex-col p-3.5"
              >
                <textarea
                  id={`${tabPrefix}-draft`}
                  value={draft}
                  maxLength={MAX_TEXT}
                  disabled={full}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter pins, so the board can be filled without
                    // reaching for the mouse. Shift-Enter still breaks a line.
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      pin()
                    }
                  }}
                  placeholder={board.prompt}
                  data-testid="whats-new-board-input"
                  className="watch-note-ink min-h-0 w-full flex-1 resize-none border-0 bg-transparent text-[0.875rem] leading-[1.3] outline-none placeholder:text-current placeholder:opacity-45 disabled:cursor-not-allowed"
                />
                <p
                  aria-hidden
                  className="watch-note-ink mt-1 shrink-0 text-right text-[0.625rem] tabular-nums opacity-55"
                >
                  {draft.length}/{MAX_TEXT}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <fieldset className="border-0 p-0">
                <legend className="text-xs font-semibold tracking-[0.22em] text-[#3c2415]/70 uppercase">
                  {WHATS_NEW_BOARD.paperLabel}
                </legend>
                <div className="mt-2.5 flex gap-2">
                  {papers.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => setPaper(entry.id)}
                      aria-pressed={paper === entry.id}
                      aria-label={entry.label}
                      data-testid={`whats-new-board-paper-${entry.id}`}
                      style={{ background: PAPERS[entry.id].face }}
                      className={`size-7 cursor-pointer rounded-sm shadow-[0_2px_5px_rgba(44,26,14,0.35)] transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2c1a0e] ${
                        paper === entry.id
                          ? "-translate-y-1 ring-2 ring-[#2c1a0e] ring-offset-2 ring-offset-[#f1efec]"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </fieldset>

              <button
                type="submit"
                disabled={draft.trim() === "" || full}
                data-testid="whats-new-board-pin"
                className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#2c1a0e] px-7 text-sm font-bold tracking-wider text-[#f6e7cd] uppercase transition-colors duration-200 hover:bg-[#46280f] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2c1a0e] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {full ? WHATS_NEW_BOARD.fullLabel : WHATS_NEW_BOARD.pinLabel}
              </button>
            </div>
          </form>

          <div className="flex flex-1 flex-col items-start gap-4 lg:items-end lg:text-right">
            <p
              aria-live="polite"
              data-testid="whats-new-board-count"
              className="text-sm text-[#3c2415]/65"
            >
              <span className="text-2xl font-semibold text-[#2c1a0e] tabular-nums">
                {state.notes.length}
              </span>{" "}
              <span className="tracking-wide uppercase">
                {WHATS_NEW_BOARD.countLabel}
              </span>
            </p>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:justify-end">
              <button
                type="button"
                onClick={requestWatchFeedback}
                data-testid="whats-new-board-send"
                className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#2c1a0e]/30 px-7 text-sm font-bold tracking-wider text-[#2c1a0e] uppercase transition-colors duration-200 hover:border-[#2c1a0e]/70 hover:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2c1a0e]"
              >
                <Send aria-hidden className="size-4 shrink-0" />
                {WHATS_NEW_BOARD.sendLabel}
              </button>

              {state.notes.length > 0 ? (
                <button
                  type="button"
                  onClick={() => patch({ notes: [] })}
                  data-testid="whats-new-board-clear"
                  className="cursor-pointer text-xs font-semibold tracking-[0.18em] text-[#3c2415]/60 uppercase underline decoration-[#2c1a0e]/25 underline-offset-4 transition-colors hover:text-[#2c1a0e] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#2c1a0e]"
                >
                  {WHATS_NEW_BOARD.clearLabel}
                </button>
              ) : null}
            </div>

            <p className="max-w-md text-xs leading-relaxed text-[#3c2415]/55">
              {WHATS_NEW_BOARD.localOnlyNote}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
