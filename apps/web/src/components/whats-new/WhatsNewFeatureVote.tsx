"use client"

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import {
  BookOpen,
  Captions,
  ChevronLeft,
  ChevronRight,
  Languages,
  LayoutTemplate,
  ListVideo,
  MessageSquarePlus,
  MessagesSquare,
  MonitorPlay,
  Scissors,
  Search,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react"

import {
  WHATS_NEW_VOTES,
  type WhatsNewVoteIcon,
} from "@/components/whats-new/whats-new-content"
import { requestWatchFeedback } from "@/lib/watch-feedback-events"
import {
  castVote,
  fetchVoteCounts,
  mintPlacementId,
  readBallotId,
  retractVote,
  type WhatsNewVoteCounts,
  type WhatsNewVoteSticker,
} from "@/lib/whats-new-votes"

const ICONS: Record<WhatsNewVoteIcon, LucideIcon> = {
  search: Search,
  language: Languages,
  subtitles: Captions,
  passage: BookOpen,
  scene: Scissors,
  playlist: ListVideo,
  "next-step": MessagesSquare,
  account: UserRound,
  recommend: Sparkles,
  device: MonitorPlay,
  journey: LayoutTemplate,
}

const STORAGE_KEY = "watch:whats-new:feature-stickers"
const DRAG_TYPE = "text/plain"
const { budget, features, stickers } = WHATS_NEW_VOTES

/**
 * A sticker stuck somewhere on a card: kind, position (%), rotation, plus the
 * two fields that make it a VOTE rather than a local decoration.
 *
 * `p` is the placement id the server counts by, so a resend cannot double
 * count. `sent` records whether the server has it — a placement made offline,
 * or one whose request was dropped, stays `false` and is retried instead of
 * being silently lost while the page claims the vote was recorded. Legacy
 * boards stored before voting existed have neither; they are given a `p` on
 * read and counted once on the next flush.
 */
type Stuck = {
  s: string
  x: number
  y: number
  r: number
  p: string
  sent?: boolean
}
type Placed = Record<string, readonly Stuck[]>

const FEATURE_IDS: ReadonlySet<string> = new Set(
  features.map((feature) => feature.id),
)
const STICKER_IDS: ReadonlySet<string> = new Set(
  stickers.map((sticker) => sticker.id),
)

/** Keep placements inside the card, allowing a little sticker overhang. */
const EDGE = 9

function clamp(value: unknown, min: number, max: number): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? value : 50
  return Math.min(max, Math.max(min, parsed))
}

function stickerOf(id: string) {
  return stickers.find((sticker) => sticker.id === id)
}

/**
 * Drop anything this board cannot honour: unknown features, unknown
 * sticker kinds, non-arrays, and any placement past the budget. Storage is
 * user-writable, so a hand-edited value must never mint extra stickers.
 */
function sanitise(raw: unknown): Placed {
  if (typeof raw !== "object" || raw === null) return {}
  const placed: Placed = {}
  let total = 0
  for (const [featureId, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    if (!FEATURE_IDS.has(featureId) || !Array.isArray(value)) continue
    const kept: Stuck[] = []
    for (const entry of value) {
      if (total >= budget) break
      if (typeof entry !== "object" || entry === null) continue
      const { s, x, y, r, p, sent } = entry as Record<string, unknown>
      if (typeof s !== "string" || !STICKER_IDS.has(s)) continue
      // Coordinates come from storage, so they are clamped rather than
      // trusted: an out-of-range value would park a sticker off-screen.
      kept.push({
        s,
        x: clamp(x, EDGE, 100 - EDGE),
        y: clamp(y, EDGE, 100 - EDGE),
        r: clamp(r, -18, 18),
        // A board written before voting existed has no placement id. Mint one
        // and leave it unsent so the sticker the reader can already see gets
        // counted on the next flush.
        p:
          typeof p === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(p)
            ? p
            : mintPlacementId(),
        sent: sent === true && typeof p === "string",
      })
      total += 1
    }
    if (kept.length > 0) placed[featureId] = kept
  }
  return placed
}

function totalOf(placed: Placed): number {
  return Object.values(placed).reduce((sum, list) => sum + list.length, 0)
}

/**
 * "12 votes" / "1 vote" / "No votes yet". Zero reads as a sentence rather than
 * a number: a row of "0 votes" on a fresh board looks broken.
 */
function voteCountLabel(votes: number): string {
  if (votes <= 0) return WHATS_NEW_VOTES.noVotesLabel
  return `${votes} ${votes === 1 ? WHATS_NEW_VOTES.voteLabel : WHATS_NEW_VOTES.votesLabel}`
}

/**
 * Where a sticker lands when there is no pointer — a keyboard press, or a
 * tap that reports no coordinates. Deterministic per slot so repeated
 * placements scatter instead of stacking on the same pixel.
 */
function scatter(index: number): { x: number; y: number } {
  const spots = [
    { x: 74, y: 26 },
    { x: 28, y: 64 },
    { x: 62, y: 78 },
  ]
  return spots[index % spots.length]
}

/**
 * localStorage as an external store rather than an effect that calls
 * setState on mount. `getServerSnapshot` returns a frozen empty board so
 * server and hydrating client agree; `getSnapshot` caches the raw string
 * so its reference stays stable, which React requires.
 */
const EMPTY: Placed = Object.freeze({})
const listeners = new Set<() => void>()
let cachedRaw: string | null = null
let cachedPlaced: Placed = EMPTY

function readPlaced(): Placed {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== cachedRaw) {
      cachedRaw = raw
      cachedPlaced = raw ? sanitise(JSON.parse(raw)) : EMPTY
    }
  } catch {
    cachedRaw = null
    cachedPlaced = EMPTY
  }
  return cachedPlaced
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

/**
 * Mark one placement as recorded, re-reading the board first: a flush runs
 * across awaits, and the reader may have peeled or placed something meanwhile.
 * Writing back a closed-over copy would resurrect a peeled sticker.
 */
function markSent(featureId: string, placementId: string): void {
  const board = readPlaced()
  const list = board[featureId]
  if (list == null) return
  let changed = false
  const next = list.map((entry) => {
    if (entry.p !== placementId || entry.sent === true) return entry
    changed = true
    return { ...entry, sent: true }
  })
  if (!changed) return
  writePlaced({ ...board, [featureId]: next })
}

function writePlaced(next: Placed): void {
  cachedPlaced = next
  try {
    cachedRaw = JSON.stringify(next)
    window.localStorage.setItem(STORAGE_KEY, cachedRaw)
  } catch {
    cachedRaw = null
  }
  for (const listener of listeners) listener()
}

export function WhatsNewFeatureVote({
  contentClass,
}: {
  contentClass: string
}) {
  const headingId = useId()
  const scroller = useRef<HTMLUListElement>(null)
  const placed = useSyncExternalStore(subscribe, readPlaced, () => EMPTY)
  // Which sticker the reader has picked up. Drag-and-drop does not exist
  // on touch, so the same interaction has to work as pick-then-tap.
  const [armed, setArmed] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  /**
   * Focus hand-off across the pile. A held sticker unmounts, so a keyboard
   * reader who arms one would otherwise be left with focus on nothing:
   * `takeFocus` moves it to the put-it-back button as that button mounts,
   * and `refocus` sends it back to the sticker when it returns to the pile.
   * Refs, not state — neither is rendered, and a re-render for either would
   * be a re-render for nothing.
   */
  const takeFocus = useRef(false)
  const refocus = useRef<string | null>(null)
  /**
   * The sticker currently under a native drag, tracked apart from `armed`.
   *
   * Two fields, and both matter. `id` has to be set in the SAME update as
   * `armed`, because unmounting the source node of an in-flight HTML5 drag
   * cancels the drag in Chrome and `armed` alone would unmount it in that
   * first render — which is how drag-and-drop got lost. `hidden` then pulls
   * it out of the pile's flow a frame later, once the browser has taken its
   * drag-image snapshot; hiding it during `dragstart` snapshots nothing and
   * the reader drags an invisible sticker.
   */
  const [drag, setDrag] = useState<{ id: string; hidden: boolean } | null>(null)
  const dragRef = useRef<string | null>(null)
  /**
   * Server-side totals. `null` until the first read lands, which is why the
   * cards say nothing rather than "0 votes" on a slow network — this page is
   * statically cached, so counts cannot be rendered on the server.
   */
  const [counts, setCounts] = useState<WhatsNewVoteCounts>(null)

  const spent = totalOf(placed)
  const remaining = budget - spent

  /**
   * Send every placement the server does not have yet, oldest first, and mark
   * each one sent as it lands. Runs on mount and after each placement, so a
   * vote made offline is retried rather than lost — the page tells the reader
   * their vote was recorded, and this is what makes that true.
   */
  const flush = useCallback(async () => {
    const board = readPlaced()
    const pending = Object.entries(board).flatMap(([featureId, list]) =>
      list
        .filter((entry) => entry.sent !== true)
        .map((entry) => ({
          featureId,
          entry,
        })),
    )
    if (pending.length === 0) return

    const ballotId = readBallotId()
    for (const { featureId, entry } of pending) {
      try {
        const outcome = await castVote({
          ballotId,
          placementId: entry.p,
          featureId,
          sticker: entry.s as WhatsNewVoteSticker,
        })
        setCounts(outcome.counts)
        // Settled either way — accepted, or refused because the budget is
        // spent. Marking a refusal settled is the point: retrying it would
        // re-send the same doomed request on every page load forever.
        markSent(featureId, entry.p)
      } catch {
        // Transport failure. Leave it unsent so the next placement, or the
        // next page load, tries again.
        return
      }
    }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const initial = await fetchVoteCounts()
        if (live) setCounts(initial)
      } catch {
        // A failed read leaves the cards countless rather than wrong.
      }
      if (live) await flush()
    })()
    return () => {
      live = false
    }
  }, [flush])

  function stick(
    featureId: string,
    stickerId: string,
    at?: { x: number; y: number },
  ) {
    if (remaining <= 0 || !STICKER_IDS.has(stickerId)) return
    const existing = placed[featureId] ?? []
    const spot = at ?? scatter(existing.length)
    const placementId = mintPlacementId()
    writePlaced({
      ...placed,
      [featureId]: [
        ...existing,
        {
          s: stickerId,
          x: clamp(spot.x, EDGE, 100 - EDGE),
          y: clamp(spot.y, EDGE, 100 - EDGE),
          r: ((existing.length * 37) % 25) - 12,
          p: placementId,
          sent: false,
        },
      ],
    })
    setArmed(null)
    endDrag()
    // Optimistic: the sticker is on the card, so the count moves with it. The
    // flush below replaces this with the server's own number.
    setCounts((current) =>
      current == null
        ? current
        : { ...current, [featureId]: (current[featureId] ?? 0) + 1 },
    )
    void flush()
  }

  /** Forget the in-flight drag, whether it landed on a card or nowhere. */
  function endDrag() {
    dragRef.current = null
    setDrag(null)
    setHovered(null)
  }

  /** Pointer position as a percentage of the card it landed on. */
  function pointFor(
    event: { clientX: number; clientY: number },
    element: HTMLElement,
  ): { x: number; y: number } | undefined {
    const box = element.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) return undefined
    if (event.clientX === 0 && event.clientY === 0) return undefined
    return {
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    }
  }

  function peel(featureId: string, index: number) {
    const list = placed[featureId] ?? []
    const peeled = list[index]
    const next = { ...placed }
    const remainder = list.filter((_, at) => at !== index)
    if (remainder.length > 0) next[featureId] = remainder
    else delete next[featureId]
    writePlaced(next)

    setCounts((current) =>
      current == null
        ? current
        : {
            ...current,
            [featureId]: Math.max(0, (current[featureId] ?? 0) - 1),
          },
    )
    // Only a vote the server actually has needs taking back.
    if (peeled?.sent !== true) return
    void retractVote({ ballotId: readBallotId(), placementId: peeled.p })
      .then((outcome) => setCounts(outcome.counts))
      .catch(() => {
        // The count self-corrects on the next load; the sticker is already off
        // the card, which is the part the reader asked for.
      })
  }

  /** "Take my stickers back" — the whole ballot, in one call. */
  function clearBoard() {
    writePlaced({})
    void retractVote({ ballotId: readBallotId() })
      .then((outcome) => setCounts(outcome.counts))
      .catch(() => {})
  }

  /** Return the held sticker to the pile, and the focus with it. */
  function putBack() {
    if (armed) refocus.current = armed
    setArmed(null)
    endDrag()
  }

  function nudge(direction: 1 | -1) {
    const list = scroller.current
    if (!list) return
    const card = list.querySelector("li")
    const step = card ? card.getBoundingClientRect().width + 24 : 320
    list.scrollBy({ left: step * direction, behavior: "smooth" })
  }

  return (
    <section
      id="vote"
      aria-labelledby={headingId}
      data-testid="whats-new-vote"
      /* Light band. This and the FAQ under it form one white shelf at the
         foot of the page, so the two blocks that ask something of the
         reader sit together instead of being split by a dark section. */
      className="watch-sticker-surface-light relative bg-white text-[#131111] scroll-mt-24 md:scroll-mt-32"
      onKeyDown={(event) => {
        // Escape is the expected way out of holding something, and here it is
        // also the only one that does not require finding the button.
        if (event.key === "Escape" && armed) {
          event.stopPropagation()
          putBack()
        }
      }}
    >
      <div
        className={`${contentClass} pt-16 pb-12 sm:pt-20 sm:pb-14 lg:pt-24 lg:pb-16`}
      >
        {/* Centred against the heading block, not pinned to its first line:
            the button reads as belonging to the whole ask rather than
            floating beside the eyebrow. */}
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-6">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.3em] text-[#131111]/55 uppercase sm:text-sm">
              {WHATS_NEW_VOTES.eyebrow}
            </p>
            <h2
              id={headingId}
              className="mt-4 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-[#131111] sm:text-4xl lg:text-5xl"
            >
              {WHATS_NEW_VOTES.heading}
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-[#131111]/70">
              {WHATS_NEW_VOTES.body}
            </p>
          </div>

          {/* Beside the heading: the reader who does not see their feature in
              the row should be told so before they scroll it.

              The button is the ONLY thing in this corner. The heading column
              is capped at 42rem and the button is 346px wide, which together
              just fit the content rail from ~1200px up — adding the carousel
              arrows back here costs another 100px and the whole row wraps,
              dropping the button under the copy on a 1211px window. The
              arrows live with the pile below instead. */}
          <IdeaButton />
        </div>
        {/* Bleeds past the content rail to the window edge on the right, so
          the row reads as continuing rather than ending. The negative
          margin mirrors the rail padding AND the max-width gutter. */}
        <ul
          ref={scroller}
          tabIndex={0}
          role="group"
          aria-label={WHATS_NEW_VOTES.carouselLabel}
          data-testid="whats-new-vote-carousel"
          className="mt-10 -mr-5 flex snap-x snap-mandatory gap-6 overflow-x-auto pr-5 pb-2 [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111] md:-mr-16 md:pr-16 xl:-mr-[max(6rem,calc((100vw-1920px)/2+6rem))] xl:pr-24 [&::-webkit-scrollbar]:hidden"
        >
          {features.map((feature) => {
            const Icon = ICONS[feature.icon]
            const stuck = placed[feature.id] ?? []
            const isTarget = hovered === feature.id
            const held = armed ? stickerOf(armed) : undefined

            return (
              <li
                key={feature.id}
                data-testid="whats-new-vote-card"
                data-stuck={stuck.length > 0 ? "" : undefined}
                {...(held
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-label": `${WHATS_NEW_VOTES.placeLabel} ${held.label} ${WHATS_NEW_VOTES.onLabel} ${feature.title}`,
                      onClick: (event: React.MouseEvent<HTMLLIElement>) =>
                        stick(
                          feature.id,
                          held.id,
                          pointFor(event, event.currentTarget),
                        ),
                      onKeyDown: (
                        event: React.KeyboardEvent<HTMLLIElement>,
                      ) => {
                        if (event.key !== "Enter" && event.key !== " ") return
                        event.preventDefault()
                        stick(feature.id, held.id)
                      },
                    }
                  : {})}
                onDragOver={(event) => {
                  if (remaining <= 0) return
                  event.preventDefault()
                  setHovered(feature.id)
                }}
                onDragLeave={() => setHovered(null)}
                onDrop={(event) => {
                  event.preventDefault()
                  setHovered(null)
                  stick(
                    feature.id,
                    event.dataTransfer.getData(DRAG_TYPE),
                    pointFor(event, event.currentTarget),
                  )
                }}
                /* Warm greys, matched to the FAQ band's hue: every grey on
                   this shelf sits on the same warm axis, and a neutral (or
                   blue-leaning) fill reads as a different material next to
                   it. Each step keeps the OKLab lightness of the cool grey
                   it replaced, so idle / has-stickers / drop-target still
                   separate by exactly as much as before. */
                className={`relative flex w-[78%] shrink-0 snap-start flex-col rounded-2xl border p-6 transition-colors duration-200 sm:w-[46%] lg:w-[31%] ${
                  held ? "cursor-copy" : ""
                } ${
                  isTarget
                    ? "border-[#cb333b]/60 bg-[#edebe7]"
                    : stuck.length > 0
                      ? "border-[#cb333b]/25 bg-[#f3f1ed]"
                      : "border-transparent bg-[#f7f5f1]"
                }`}
              >
                <Icon
                  aria-hidden
                  className="size-7 text-[#131111] opacity-60"
                />
                <h3 className="mt-5 text-lg font-semibold text-[#131111]">
                  {feature.title}
                </h3>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-[#131111]/65">
                  {feature.body}
                </p>

                {/* Everyone's votes, not just this browser's. Absent until the
                    first read lands: the page is statically cached, so there is
                    no server-rendered number to show and "0 votes" would be a
                    guess rather than a count. */}
                <p
                  data-testid="whats-new-vote-count"
                  data-feature={feature.id}
                  className="relative mt-5 text-xs font-semibold tracking-[0.18em] text-[#131111]/50 uppercase tabular-nums"
                >
                  {counts == null
                    ? "\u00A0"
                    : voteCountLabel(counts[feature.id] ?? 0)}
                </p>

                {/* Stuck anywhere on the card. While a sticker is held these
                  are inert spans, so the card can be the drop target
                  without nesting a button inside a button. */}
                {stuck.map((entry, index) => {
                  const sticker = stickerOf(entry.s)
                  const position = {
                    left: `${entry.x}%`,
                    top: `${entry.y}%`,
                    rotate: `${entry.r}deg`,
                  }

                  if (held) {
                    return (
                      <span
                        key={`${entry.s}-${index}`}
                        aria-hidden
                        style={position}
                        className="watch-sticker-art pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[length:var(--watch-sticker-stuck)]"
                      >
                        {sticker?.emoji}
                      </span>
                    )
                  }

                  return (
                    <button
                      key={`${entry.s}-${index}`}
                      type="button"
                      onClick={() => peel(feature.id, index)}
                      data-testid={`whats-new-vote-peel-${feature.id}-${index}`}
                      aria-label={`${WHATS_NEW_VOTES.removeLabel} ${sticker?.label} ${WHATS_NEW_VOTES.fromLabel} ${feature.title}`}
                      style={position}
                      className="watch-sticker-art watch-sticker-pop absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer text-[length:var(--watch-sticker-stuck)] transition-transform duration-200 hover:scale-115 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111]"
                    >
                      <span aria-hidden>{sticker?.emoji}</span>
                    </button>
                  )
                })}
              </li>
            )
          })}
        </ul>

        {/* The pile sits under the row it feeds, at the size these things are
            meant to be handled at. They are the only draggable objects on the
            page; beside the heading at 3rem they read as decoration next to
            the type rather than as something to pick up. */}
        <div className="mt-10 flex flex-wrap items-center gap-x-10 gap-y-6 sm:mt-12">
          <div
            data-testid="whats-new-vote-pile"
            /* Pick-up size lives HERE, not on the buttons: each sticker sets
               its own `fontSize` in `em` inline to step the pile front-to-
               back, and an inline style beats a `text-*` class on the same
               element — so a size class on the button resolves to nothing and
               the pile inherits 1rem. That is exactly what it used to do.

               Derived from the stuck size rather than set independently, so
               the pile stays a fixed step above the finished sticker however
               that is tuned. */
            className="group/pile relative flex items-center text-[length:calc(var(--watch-sticker-stuck)*var(--watch-sticker-pile-scale))]"
          >
            {stickers.map((sticker, index) => {
              // Mounted through the whole gesture; hidden only after the
              // snapshot frame.
              const isDragSource = drag?.id === sticker.id
              const isDragHidden = isDragSource && drag.hidden
              // A held sticker is ON THE CURSOR, so it is gone from the pile
              // — no ghost, no dashed slot — and the ones behind it close the
              // gap. Nothing is left to click a second time, which is why
              // arming hands focus to the put-it-back button beside the pile.
              //
              // A sticker being DRAGGED is the exception: its node is the
              // drag's source and removing it cancels the gesture, so it
              // stays mounted and is pulled out of the pile's flow instead.
              if (armed === sticker.id && !isDragSource) return null

              return (
                <button
                  key={sticker.id}
                  type="button"
                  ref={(node) => {
                    if (node && refocus.current === sticker.id) {
                      refocus.current = null
                      node.focus()
                    }
                  }}
                  draggable={remaining > 0}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(DRAG_TYPE, sticker.id)
                    // Centre the sticker on the cursor. The default drag
                    // image is offset down and right, so the sticker trails
                    // the pointer instead of sitting under it.
                    const box = event.currentTarget.getBoundingClientRect()
                    event.dataTransfer.setDragImage(
                      event.currentTarget,
                      box.width / 2,
                      box.height / 2,
                    )
                    setArmed(sticker.id)
                    // Batched with `setArmed` above, so the first render
                    // after this event still has the node: that is what the
                    // drag needs. Only the HIDING waits for the next frame,
                    // by which time Chrome has its drag-image snapshot.
                    dragRef.current = sticker.id
                    setDrag({ id: sticker.id, hidden: false })
                    requestAnimationFrame(() => {
                      if (dragRef.current === sticker.id) {
                        setDrag({ id: sticker.id, hidden: true })
                      }
                    })
                  }}
                  onDragEnd={endDrag}
                  onClick={() => {
                    // Only a click/keypress hands focus on; a drag must not
                    // move focus out from under the pointer mid-gesture.
                    takeFocus.current = true
                    setArmed(sticker.id)
                  }}
                  disabled={remaining === 0}
                  aria-label={sticker.label}
                  data-testid={`whats-new-vote-sticker-${sticker.id}`}
                  style={{
                    rotate: `${(index - 1) * 7}deg`,
                    // Front of the pile sits on top and biggest.
                    zIndex: stickers.length - index,
                    // Shallow on purpose: at the old 0.86/0.74 the back of
                    // the pile came out SMALLER than a stuck sticker, which
                    // reads as already spent rather than as further away.
                    fontSize: `${[1, 0.95, 0.9][index] ?? 0.9}em`,
                  }}
                  className={`watch-sticker-art cursor-grab leading-none transition-transform duration-200 select-none first:ml-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 ${
                    isDragHidden
                      ? "pointer-events-none absolute opacity-0"
                      : "relative -ml-4 hover:-translate-y-2 hover:scale-110 sm:-ml-5"
                  }`}
                >
                  <span aria-hidden className="block">
                    {sticker.emoji}
                  </span>
                </button>
              )
            })}

            <span
              aria-hidden
              data-testid="whats-new-vote-pile-hint"
              className="pointer-events-none absolute top-full left-0 mt-2 rounded-full bg-[#131111] px-3 py-1 text-[0.6875rem] font-semibold tracking-wide whitespace-nowrap text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover/pile:opacity-100 group-focus-within/pile:opacity-100"
            >
              {armed ? WHATS_NEW_VOTES.armedHint : WHATS_NEW_VOTES.pileHint}
            </span>
          </div>

          <p
            aria-live="polite"
            data-testid="whats-new-vote-remaining"
            className="text-sm text-[#131111]/60"
          >
            <span className="text-2xl font-semibold text-[#131111] tabular-nums">
              {remaining}
            </span>{" "}
            <span className="tracking-wide uppercase">
              {WHATS_NEW_VOTES.remainingLabel}
            </span>
          </p>

          {armed ? (
            <button
              type="button"
              ref={(node) => {
                if (node && takeFocus.current) {
                  takeFocus.current = false
                  node.focus()
                }
              }}
              data-testid="whats-new-vote-put-back"
              onClick={() => putBack()}
              className="inline-flex h-10 cursor-pointer items-center rounded-full border border-[#131111]/25 px-5 text-xs font-semibold tracking-[0.18em] text-[#131111] uppercase transition-colors hover:border-[#131111]/60 hover:bg-[#f4f2ee] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111]"
            >
              {WHATS_NEW_VOTES.putBack}
            </button>
          ) : null}

          {/* One right-aligned group, so the two stay side by side whether or
              not there is anything to take back. `ml-auto` on each separately
              would let the second one absorb the free space and drift away
              from the first. */}
          <div className="ml-auto flex items-center gap-6">
            {spent > 0 ? (
              <button
                type="button"
                data-testid="whats-new-vote-reset"
                onClick={clearBoard}
                className="cursor-pointer text-xs font-semibold tracking-[0.18em] text-[#131111]/60 uppercase underline decoration-[#131111]/25 underline-offset-4 transition-colors hover:text-[#131111] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111]"
              >
                {WHATS_NEW_VOTES.clear}
              </button>
            ) : null}

            <div className="hidden gap-2 sm:flex">
              <NudgeButton
                label={WHATS_NEW_VOTES.previous}
                onClick={() => nudge(-1)}
              >
                <ChevronLeft aria-hidden className="size-5" />
              </NudgeButton>
              <NudgeButton
                label={WHATS_NEW_VOTES.next}
                onClick={() => nudge(1)}
              >
                <ChevronRight aria-hidden className="size-5" />
              </NudgeButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Top-right of the header, beside the heading: a reader whose feature is not
 * in the row should learn that before scrolling the whole carousel looking
 * for it.
 */
function IdeaButton() {
  return (
    <button
      type="button"
      data-testid="whats-new-vote-idea"
      onClick={requestWatchFeedback}
      className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#131111]/25 px-7 text-sm font-bold tracking-wider text-[#131111] uppercase transition-colors duration-200 hover:border-[#131111]/60 hover:bg-[#f4f2ee] focus-visible:outline-2 focus-visible:outline-[#131111] focus-visible:outline-offset-4"
    >
      <MessageSquarePlus aria-hidden className="size-4 shrink-0" />
      {WHATS_NEW_VOTES.ideaLabel}
    </button>
  )
}

function NudgeButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-10 cursor-pointer place-items-center rounded-full bg-[#f2f0ec] text-[#131111] transition-colors hover:bg-[#e2e0dc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131111]"
    >
      {children}
    </button>
  )
}
