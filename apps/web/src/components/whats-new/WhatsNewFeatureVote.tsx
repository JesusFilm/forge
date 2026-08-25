"use client"

import { useId, useRef, useState, useSyncExternalStore } from "react"
import {
  BookOpen,
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

const ICONS: Record<WhatsNewVoteIcon, LucideIcon> = {
  search: Search,
  language: Languages,
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

/** A sticker stuck somewhere on a card: kind, position (%), rotation. */
type Stuck = { s: string; x: number; y: number; r: number }
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
      const { s, x, y, r } = entry as Record<string, unknown>
      if (typeof s !== "string" || !STICKER_IDS.has(s)) continue
      // Coordinates come from storage, so they are clamped rather than
      // trusted: an out-of-range value would park a sticker off-screen.
      kept.push({
        s,
        x: clamp(x, EDGE, 100 - EDGE),
        y: clamp(y, EDGE, 100 - EDGE),
        r: clamp(r, -18, 18),
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

  const spent = totalOf(placed)
  const remaining = budget - spent

  function stick(
    featureId: string,
    stickerId: string,
    at?: { x: number; y: number },
  ) {
    if (remaining <= 0 || !STICKER_IDS.has(stickerId)) return
    const existing = placed[featureId] ?? []
    const spot = at ?? scatter(existing.length)
    writePlaced({
      ...placed,
      [featureId]: [
        ...existing,
        {
          s: stickerId,
          x: clamp(spot.x, EDGE, 100 - EDGE),
          y: clamp(spot.y, EDGE, 100 - EDGE),
          r: ((existing.length * 37) % 25) - 12,
        },
      ],
    })
    setArmed(null)
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
    const next = { ...placed }
    const remainder = list.filter((_, at) => at !== index)
    if (remainder.length > 0) next[featureId] = remainder
    else delete next[featureId]
    writePlaced(next)
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
    >
      <div
        className={`${contentClass} pt-16 pb-12 sm:pt-20 sm:pb-14 lg:pt-24 lg:pb-16`}
      >
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-8">
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

          {/* Loose pile — no drawer, no frame. */}
          <div className="flex items-center gap-6">
            <div
              data-testid="whats-new-vote-pile"
              className="group/pile relative flex items-center"
            >
              {stickers.map((sticker, index) => {
                const isArmed = armed === sticker.id
                return (
                  <button
                    key={sticker.id}
                    type="button"
                    draggable={remaining > 0}
                    onDragStart={(event) => {
                      event.dataTransfer.setData(DRAG_TYPE, sticker.id)
                      // Centre the sticker on the cursor. The default drag
                      // image is offset down and right, so the sticker
                      // trails the pointer instead of sitting under it.
                      const box = event.currentTarget.getBoundingClientRect()
                      event.dataTransfer.setDragImage(
                        event.currentTarget,
                        box.width / 2,
                        box.height / 2,
                      )
                      setArmed(sticker.id)
                    }}
                    onDragEnd={() => setHovered(null)}
                    onClick={() => setArmed(isArmed ? null : sticker.id)}
                    disabled={remaining === 0}
                    aria-pressed={isArmed}
                    aria-label={sticker.label}
                    data-testid={`whats-new-vote-sticker-${sticker.id}`}
                    style={{
                      rotate: `${(index - 1) * 7}deg`,
                      // Front of the pile sits on top and biggest.
                      zIndex: stickers.length - index,
                      fontSize: `${[1, 0.86, 0.74][index] ?? 0.8}em`,
                    }}
                    className={`relative -ml-6 cursor-grab text-5xl transition-transform duration-200 select-none first:ml-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 sm:-ml-7 sm:text-6xl ${
                      isArmed
                        ? ""
                        : "watch-sticker-art hover:-translate-y-2 hover:scale-115"
                    }`}
                  >
                    {/* Held: the sticker is on the cursor, so what stays
                      behind is the hole it came out of. */}
                    <span
                      aria-hidden
                      className={
                        isArmed ? "watch-sticker-ghost block" : "block"
                      }
                    >
                      {sticker.emoji}
                    </span>
                    {isArmed ? (
                      <span
                        aria-hidden
                        data-testid={`whats-new-vote-gap-${sticker.id}`}
                        className="absolute -inset-1.5 rounded-full border-2 border-dashed border-[#131111]/35"
                      />
                    ) : null}
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
                className={`relative flex w-[78%] shrink-0 snap-start flex-col rounded-2xl border p-6 transition-colors duration-200 sm:w-[46%] lg:w-[31%] ${
                  held ? "cursor-copy" : ""
                } ${
                  isTarget
                    ? "border-[#cb333b]/60 bg-[#eceaef]"
                    : stuck.length > 0
                      ? "border-[#cb333b]/25 bg-[#f2f0f4]"
                      : "border-transparent bg-[#f5f5f7]"
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
                        className="watch-sticker-art pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-4xl"
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
                      className="watch-sticker-art watch-sticker-pop absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer text-4xl transition-transform duration-200 hover:scale-115 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111]"
                    >
                      <span aria-hidden>{sticker?.emoji}</span>
                    </button>
                  )
                })}
              </li>
            )
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
          <button
            type="button"
            data-testid="whats-new-vote-idea"
            onClick={requestWatchFeedback}
            className="inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-[#131111]/25 px-7 text-sm font-bold tracking-wider text-[#131111] uppercase transition-colors duration-200 hover:border-[#131111]/60 hover:bg-black/[0.05] focus-visible:outline-2 focus-visible:outline-[#131111] focus-visible:outline-offset-4"
          >
            <MessageSquarePlus aria-hidden className="size-4 shrink-0" />
            {WHATS_NEW_VOTES.ideaLabel}
          </button>

          {spent > 0 ? (
            <button
              type="button"
              data-testid="whats-new-vote-reset"
              onClick={() => writePlaced({})}
              className="cursor-pointer text-xs font-semibold tracking-[0.18em] text-[#131111]/60 uppercase underline decoration-black/25 underline-offset-4 transition-colors hover:text-[#131111] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#131111]"
            >
              {WHATS_NEW_VOTES.clear}
            </button>
          ) : null}
        </div>

        <p className="mt-4 max-w-xl text-xs leading-relaxed text-[#131111]/50">
          {WHATS_NEW_VOTES.localOnlyNote}
        </p>
      </div>
    </section>
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
      className="grid size-10 cursor-pointer place-items-center rounded-full bg-black/[0.06] text-[#131111] transition-colors hover:bg-black/[0.12] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#131111]"
    >
      {children}
    </button>
  )
}
