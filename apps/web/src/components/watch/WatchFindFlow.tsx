"use client"

// A MasterClass-style "find my films" onboarding, run as a full-screen flow
// over the Watch page. Presentation is the original prototype's, unchanged:
// three phases (What you're after → How you watch → Films for you), one
// question per screen, multi-select checkboxes, an interstitial fact card, a
// radio question, a device card, a "working on it" beat, then a results page
// of carousels.
//
// Data adapter (the only departure from the prototype): films come from the
// live same-origin `/watch/api/film-finder` route (Admin-backed, lane, audio
// language and duration bounded), never from a frozen fixture. Answers stay in
// memory; nothing is stored. The working beat lasts exactly as long as the
// real request, and counts are what the server returned.

import { ArrowLeft, Check, Laptop, Play, Smartphone, Tv, X } from "lucide-react"
import Image from "next/image"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel"
import { buttonVariants } from "@/components/ui/button-variants"
import { CAROUSEL_END_SPACER } from "@/lib/content-width"
import {
  languageVideosIndexPath,
  languagesIndexPath,
  tryAsLocaleSlug,
} from "@/lib/routes"
import { cn } from "@/lib/utils"
import type {
  WatchFilmFinderCard,
  WatchFilmFinderDuration,
  WatchFilmFinderLaneId,
  WatchFilmFinderPage,
} from "@/lib/watch-film-finder"
import { watchPath } from "@/lib/watch-paths"

/* ------------------------------------------------------------------ lanes */

/**
 * The prototype's lane copy, keyed by the live finder's lane ids (the
 * prototype's `new` is Admin's `getting-started`; same collection). Film
 * identity, titles, runtimes and artwork come from Admin.
 */
type FindLane = { id: WatchFilmFinderLaneId; title: string; blurb: string }

const FIND_LANES: FindLane[] = [
  {
    id: "conversation",
    title: "Short films worth talking about",
    blurb: "A few minutes each, made to start a conversation.",
  },
  {
    id: "seven-days",
    title: "Seven days with Jesus",
    blurb: "One short story a day for a week.",
  },
  {
    id: "kids",
    title: "For children",
    blurb: "Told by children, for children.",
  },
  {
    id: "questions",
    title: "Big questions",
    blurb: "Written for people asking honest questions.",
  },
  {
    id: "getting-started",
    title: "Just starting out",
    blurb: "The first things worth knowing, one step at a time.",
  },
  {
    id: "women",
    title: "Stories about women",
    blurb: "A first-century family, and the women who met Jesus.",
  },
  {
    id: "animated",
    title: "Animated",
    blurb: "Drawn stories — and one dystopian series.",
  },
  {
    id: "culture",
    title: "In your own culture",
    blurb: "The story retold from an Indigenous perspective.",
  },
]

/* ---------------------------------------------------------------- questions */

/** Why they came. Each reason leans on one or more lanes. */
const REASONS: { id: string; label: string; lanes: WatchFilmFinderLaneId[] }[] =
  [
    {
      id: "who",
      label: "Understand who Jesus actually was",
      lanes: ["seven-days", "questions"],
    },
    {
      id: "questions",
      label: "Get honest answers to my questions",
      lanes: ["questions", "conversation"],
    },
    {
      id: "hard",
      label: "Find hope in a hard season",
      lanes: ["conversation", "women"],
    },
    {
      id: "kids",
      label: "Something to watch with my children",
      lanes: ["kids", "animated"],
    },
    {
      id: "new",
      label: "I've just started following Jesus",
      lanes: ["getting-started", "seven-days"],
    },
    {
      id: "share",
      label: "Something to share with a friend",
      lanes: ["conversation", "animated"],
    },
    {
      id: "group",
      label: "Something for a group or church",
      lanes: ["getting-started", "women", "seven-days"],
    },
    { id: "else", label: "Something else", lanes: [] },
  ]

/** The prototype's caps (360 s / 1500 s / none) are Admin's duration buckets. */
const TIMES: {
  id: string
  label: string
  duration: WatchFilmFinderDuration
}[] = [
  { id: "short", label: "A few minutes", duration: "SHORT" },
  { id: "medium", label: "Ten or twenty minutes", duration: "MEDIUM" },
  { id: "long", label: "As long as it takes", duration: "ANY" },
]

const DEVICES = [
  {
    id: "phone",
    Icon: Smartphone,
    title: "Phone",
    body: "Watch and share anywhere, even offline",
  },
  {
    id: "laptop",
    Icon: Laptop,
    title: "Laptop",
    body: "The whole library in your browser",
  },
  {
    id: "tv",
    Icon: Tv,
    title: "TV",
    body: "Cast it, or use the TV app at home",
  },
]

type StepId =
  | "reasons"
  | "lanes"
  | "fact"
  | "time"
  | "devices"
  | "working"
  | "results"

const ORDER: StepId[] = [
  "reasons",
  "lanes",
  "fact",
  "time",
  "devices",
  "working",
  "results",
]

const PHASE_OF: Record<StepId, 0 | 1 | 2> = {
  reasons: 0,
  lanes: 0,
  fact: 0,
  time: 1,
  devices: 1,
  working: 1,
  results: 2,
}

const PHASES = ["What you're after", "How you watch", "Films for you"]

/** Steps from which the live result request is made. */
const FETCH_STEPS = new Set<StepId>([
  "fact",
  "time",
  "devices",
  "working",
  "results",
])

/* ------------------------------------------------------------ data adapter */

/**
 * Pages walked per request round. The first round runs on its own; later
 * rounds run only when the visitor asks for more, so a filter set never
 * fetches unattended past 4 × 24 cards and the route's per-client limit holds.
 */
const MAX_PAGES = 4

type ResultState = {
  key: string
  status: "loading" | "ready" | "error"
  cards: WatchFilmFinderCard[]
  /** Cursor for the matches not loaded yet; null when the walk is complete. */
  next: string | null
  more: "idle" | "loading" | "error"
}

class FinderRequestError extends Error {
  constructor() {
    super("Film finder request failed")
    this.name = "FinderRequestError"
  }
}

/** One bounded round of pages from `after`; returns the cards and next cursor. */
async function walkPages(
  key: string,
  after: string | null,
  signal: AbortSignal,
): Promise<{ cards: WatchFilmFinderCard[]; next: string | null }> {
  const cards: WatchFilmFinderCard[] = []
  let cursor = after
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams(key)
    if (cursor) params.set("after", cursor)
    const response = await fetch(`${watchPath("/api/film-finder")}?${params}`, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    })
    if (!response.ok) throw new FinderRequestError()
    const body: WatchFilmFinderPage = await response.json()
    cards.push(...body.cards)
    if (!body.hasNextPage || !body.endCursor) return { cards, next: null }
    cursor = body.endCursor
  }
  return { cards, next: cursor }
}

/** Cards shared across lanes appear once (Admin's contract, re-checked here). */
function merge(
  previous: WatchFilmFinderCard[],
  added: WatchFilmFinderCard[],
): WatchFilmFinderCard[] {
  const cards = new Map(previous.map((card) => [card.videoId, card]))
  for (const card of added)
    if (!cards.has(card.videoId)) cards.set(card.videoId, card)
  return [...cards.values()]
}

/**
 * Loads one filter set: a first bounded round, then further rounds only on
 * request. A newer key aborts the older request, and its late answer is fenced
 * by key even if the transport ignores abort.
 */
function useFinderResults(key: string, enabled: boolean, retry: number) {
  const [result, setResult] = useState<ResultState>({
    key: "",
    status: "loading",
    cards: [],
    next: null,
    more: "idle",
  })
  const [more, setMore] = useState<{
    key: string
    after: string
    n: number
  } | null>(null)
  // One generation per visit: any change of filters, retry, or leaving and
  // re-entering the fetching steps starts a new one, and drops any pending
  // "Show more" intent. A new id reads as loading until its own answer lands,
  // so nothing from another filter, attempt or visit is shown or resumed —
  // returning to earlier filters runs only a fresh first round, and loading
  // past it again takes a new click.
  const token = `${retry}|${enabled}|${key}`
  const [visit, setVisit] = useState({ token, n: 0 })
  let generation = visit.n
  if (visit.token !== token) {
    generation = visit.n + 1
    setVisit({ token, n: generation })
    setMore(null)
  }
  const id = `${generation}|${token}`

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void walkPages(key, null, controller.signal).then(
      ({ cards, next }) => {
        if (controller.signal.aborted) return
        setResult({
          key: id,
          status: "ready",
          cards: merge([], cards),
          next,
          more: "idle",
        })
      },
      () => {
        if (controller.signal.aborted) return
        setResult({
          key: id,
          status: "error",
          cards: [],
          next: null,
          more: "idle",
        })
      },
    )
    return () => controller.abort()
  }, [key, id, enabled])

  // Runs only while the visitor's own "Show more" is pending for this key, so
  // returning to an earlier filter never resumes an old cursor by itself.
  const pending = result.key === id && result.more === "loading"
  useEffect(() => {
    if (!pending || !more || more.key !== id) return
    const controller = new AbortController()
    void walkPages(key, more.after, controller.signal).then(
      ({ cards, next }) => {
        if (controller.signal.aborted) return
        setResult((current) =>
          current.key === id && current.next === more.after
            ? {
                ...current,
                cards: merge(current.cards, cards),
                next,
                more: "idle",
              }
            : current,
        )
      },
      () => {
        if (controller.signal.aborted) return
        // Keeps the loaded cards and the same cursor, so "Try again" resumes
        // exactly here.
        setResult((current) =>
          current.key === id ? { ...current, more: "error" } : current,
        )
      },
    )
    return () => controller.abort()
  }, [key, id, more, pending])

  const view: ResultState =
    result.key === id
      ? result
      : { key: id, status: "loading", cards: [], next: null, more: "idle" }

  const loadMore = () => {
    if (view.status !== "ready" || !view.next || view.more === "loading") return
    const after = view.next
    setResult((current) =>
      current.key === id ? { ...current, more: "loading" } : current,
    )
    setMore((current) => ({ key: id, after, n: (current?.n ?? 0) + 1 }))
  }

  return { ...view, loadMore }
}

function formatRuntime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = String(seconds % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/* ------------------------------------------------------------------- flow */

export type WatchFindFlowProps = {
  /** The page's audio language: results are films playable in it. */
  languageSlug: string
  locale: string
  onClose: () => void
}

export function WatchFindFlow({ languageSlug, onClose }: WatchFindFlowProps) {
  const [step, setStep] = useState<StepId>("reasons")
  const [reasons, setReasons] = useState<string[]>([])
  const [lanes, setLanes] = useState<WatchFilmFinderLaneId[]>([])
  const [time, setTime] = useState<string>("medium")
  const [retry, setRetry] = useState(0)
  const dialogRef = useRef<HTMLDivElement>(null)

  const index = ORDER.indexOf(step)

  // Lanes suggested by the reasons, used to pre-tick the second question.
  const suggested = useMemo(() => {
    const ids = new Set<WatchFilmFinderLaneId>()
    for (const r of REASONS)
      if (reasons.includes(r.id)) r.lanes.forEach((l) => ids.add(l))
    return [...ids]
  }, [reasons])

  const go = (next: StepId) => {
    setStep(next)
    // The overlay is the scroller; the page behind it stays where it was.
    dialogRef.current?.scrollTo?.({ top: 0 })
  }

  const advance = () => {
    const next = ORDER[index + 1]
    if (!next) return
    if (next === "lanes" && lanes.length === 0 && suggested.length > 0) {
      setLanes(suggested)
    }
    go(next)
  }

  const chosenLanes = lanes.length
    ? FIND_LANES.filter((l) => lanes.includes(l.id))
    : FIND_LANES

  const duration =
    TIMES.find((t) => t.id === time)?.duration ?? ("ANY" as const)
  const params = new URLSearchParams({
    languageSlug,
    duration,
    first: "24",
  })
  chosenLanes.forEach((lane) => params.append("laneIds", lane.id))
  const key = params.toString()

  const result = useFinderResults(key, FETCH_STEPS.has(step), retry)

  // The prototype's "working on it" beat (1.6 s), held until the real
  // request has answered so the results page never shows a guess.
  const [beatDoneFor, setBeatDoneFor] = useState<string | null>(null)
  useEffect(() => {
    if (step !== "working") return
    const t = window.setTimeout(() => setBeatDoneFor(key), 1600)
    return () => window.clearTimeout(t)
  }, [step, key])
  const shownStep: StepId =
    step === "working" && beatDoneFor === key && result.status !== "loading"
      ? "results"
      : step

  // Escape closes, like any full-screen overlay; Tab stays inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key !== "Tab" || !dialogRef.current) return
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const phase = PHASE_OF[shownStep]

  const results = useMemo(
    () =>
      chosenLanes
        .map((lane) => ({
          ...lane,
          films: result.cards.filter((card) => card.laneId === lane.id),
        }))
        .filter((lane) => lane.films.length > 0),
    [chosenLanes, result.cards],
  )

  const resultCount = results.reduce((n, l) => n + l.films.length, 0)
  const language = tryAsLocaleSlug(languageSlug)

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      data-testid="watch-find-flow"
      data-step={shownStep}
      className="fixed inset-0 z-[80] overflow-y-auto overscroll-contain bg-stone-950 text-white outline-none"
      role="dialog"
      lang="en"
      dir="ltr"
      aria-modal="true"
      aria-label="Find films for you"
    >
      {/* header + phase bar */}
      <header className="sticky top-0 z-10 flex min-w-0 items-center gap-4 border-b border-white/10 bg-stone-950/95 px-5 py-3 backdrop-blur-sm md:px-8">
        <p className="shrink-0 text-[13px] font-bold tracking-[0.16em] text-white/80 uppercase">
          Jesus Film
        </p>
        <div className="flex min-w-0 flex-1 justify-center gap-3 md:gap-6">
          {PHASES.map((label, i) => (
            <div key={label} className="min-w-0 max-w-[10rem] flex-1">
              <span
                className={cn(
                  "block h-1 rounded-full transition-colors duration-300",
                  i < phase
                    ? "bg-emerald-400"
                    : i === phase
                      ? "bg-brand-red"
                      : "bg-white/15",
                )}
              />
              <span
                className={cn(
                  "mt-1.5 block truncate text-center text-[11px] md:text-[12px]",
                  i === phase ? "font-semibold text-white" : "text-white/40",
                )}
              >
                {label}
              </span>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-white hover:text-white"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="mx-auto w-full max-w-3xl px-5 pt-10 pb-24 md:px-8 md:pt-16">
        {step === "reasons" ? (
          <Question
            title="Let's begin — what brings you here?"
            hint="Pick as many as you like."
          >
            <CheckList
              options={REASONS.map((r) => ({ id: r.id, label: r.label }))}
              selected={reasons}
              onToggle={(id) =>
                setReasons((v) =>
                  v.includes(id) ? v.filter((x) => x !== id) : [...v, id],
                )
              }
            />
          </Question>
        ) : null}

        {step === "lanes" ? (
          <Question
            title="Which of these interest you?"
            hint={
              suggested.length
                ? "We ticked a few based on your answer — change anything."
                : "Pick as many as you like."
            }
          >
            <CheckList
              options={FIND_LANES.map((l) => ({ id: l.id, label: l.title }))}
              selected={lanes}
              onToggle={(id) =>
                setLanes((v) =>
                  v.includes(id as WatchFilmFinderLaneId)
                    ? v.filter((x) => x !== id)
                    : [...v, id as WatchFilmFinderLaneId],
                )
              }
            />
          </Question>
        ) : null}

        {step === "fact" ? <FactCard films={result.cards} /> : null}

        {step === "time" ? (
          <Question title="How much time do you have right now?">
            <RadioList
              options={TIMES.map((t) => ({ id: t.id, label: t.label }))}
              selected={time}
              onSelect={setTime}
            />
          </Question>
        ) : null}

        {step === "devices" ? <DeviceCard /> : null}

        {shownStep === "working" ? (
          <div
            data-testid="watch-find-working"
            role="status"
            className="flex min-h-[50vh] flex-col items-center justify-center gap-6 text-center"
          >
            <span className="block h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-brand-red" />
            <p className="text-2xl font-semibold">Finding your films…</p>
          </div>
        ) : null}

        {shownStep === "results" ? (
          <Results
            lanes={results}
            count={resultCount}
            interests={chosenLanes.length}
            status={result.status}
            hasMore={result.next !== null}
            more={result.more}
            onLoadMore={result.loadMore}
            catalogHref={
              language
                ? languageVideosIndexPath(language)
                : languagesIndexPath()
            }
            onRetry={() => setRetry((n) => n + 1)}
            onRestart={() => {
              setReasons([])
              setLanes([])
              setTime("medium")
              go("reasons")
            }}
          />
        ) : null}
      </div>

      {/* footer controls — absent on the beat and the results */}
      {shownStep !== "working" && shownStep !== "results" ? (
        <div className="sticky bottom-0 border-t border-white/10 bg-stone-950/95 px-5 py-4 backdrop-blur-sm md:px-8">
          <div className="mx-auto flex w-full max-w-3xl min-w-0 items-center justify-center gap-3">
            {index > 0 ? (
              <button
                type="button"
                onClick={() => go(ORDER[index - 1])}
                aria-label="Back"
                className="grid size-12 shrink-0 cursor-pointer place-items-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-white hover:text-white"
              >
                <ArrowLeft aria-hidden className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              data-testid="watch-find-next"
              onClick={advance}
              className={cn(
                buttonVariants({ variant: "pill" }),
                "h-12 min-w-0 flex-1 md:max-w-sm",
              )}
            >
              Next
            </button>
          </div>
          {step === "reasons" || step === "lanes" ? (
            <button
              type="button"
              onClick={advance}
              className="mx-auto mt-3 block cursor-pointer text-[13px] text-white/45 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
            >
              Skip
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function Question({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-center text-2xl leading-tight font-semibold text-balance md:text-3xl">
        {title}
      </h2>
      {hint ? (
        <p className="mt-2 text-center text-[14px] text-white/55">{hint}</p>
      ) : null}
      <div className="mt-8 min-w-0">{children}</div>
    </div>
  )
}

function CheckList({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; label: string; meta?: string }[]
  selected: string[]
  onToggle: (id: string) => void
}) {
  return (
    <ul className="grid min-w-0 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10">
      {options.map((o) => {
        const on = selected.includes(o.id)
        return (
          <li key={o.id} className="min-w-0">
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(o.id)}
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-center gap-4 px-5 py-4 text-left transition-colors focus-visible:outline-none",
                on ? "bg-white/[0.14]" : "bg-stone-950 hover:bg-white/[0.06]",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded border transition-colors",
                  on ? "border-white bg-white" : "border-white/35",
                )}
              >
                {on ? (
                  <Check aria-hidden className="size-3.5 text-stone-900" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 text-[15px] leading-snug md:text-base">
                {o.label}
              </span>
              {o.meta ? (
                <span className="shrink-0 text-[12px] tabular-nums text-white/40">
                  {o.meta}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function RadioList({
  options,
  selected,
  onSelect,
}: {
  options: { id: string; label: string }[]
  selected: string
  onSelect: (id: string) => void
}) {
  return (
    <ul
      role="radiogroup"
      aria-label="How much time"
      className="grid min-w-0 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10"
    >
      {options.map((o) => {
        const on = selected === o.id
        return (
          <li key={o.id} className="min-w-0">
            <button
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onSelect(o.id)}
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-center gap-4 px-5 py-4 text-left transition-colors focus-visible:outline-none",
                on ? "bg-white/[0.14]" : "bg-stone-950 hover:bg-white/[0.06]",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                  on ? "border-white" : "border-white/35",
                )}
              >
                {on ? (
                  <span className="block size-2.5 rounded-full bg-white" />
                ) : null}
              </span>
              <span className="min-w-0 text-[15px] md:text-base">
                {o.label}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * The reference's "did you know?" beat — ours carries the language fact. The
 * stills are the first live results with artwork; slots stay empty until the
 * request answers.
 */
function FactCard({ films }: { films: WatchFilmFinderCard[] }) {
  const stills = films.filter((f) => f.imageUrl).slice(0, 3)
  return (
    <div data-testid="watch-find-fact" className="min-w-0 text-center">
      <span className="inline-block rounded-full bg-white px-4 py-1.5 text-[11px] font-bold tracking-[0.14em] text-stone-900 uppercase">
        Did you know?
      </span>
      <h2 className="mx-auto mt-6 max-w-[26ch] text-2xl leading-tight font-semibold text-balance md:text-3xl">
        <em>JESUS</em> is in 2,269 languages — the most translated film ever
        made.
      </h2>
      <div className="mt-8 grid min-w-0 grid-cols-3 gap-1 overflow-hidden rounded-2xl">
        {[0, 1, 2].map((slot) => {
          const f = stills[slot]
          return (
            <span
              key={f?.videoId ?? `slot-${slot}`}
              className="relative block aspect-[3/4] min-w-0"
            >
              {f?.imageUrl ? (
                <Image
                  src={f.imageUrl}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 33vw, 240px"
                  className="object-cover"
                />
              ) : null}
            </span>
          )
        })}
      </div>
      <p className="mt-6 text-[14px] text-white/55">
        Free to watch, free to download, free to show. No account needed.
      </p>
    </div>
  )
}

function DeviceCard() {
  return (
    <div data-testid="watch-find-devices" className="min-w-0 text-center">
      <h2 className="text-2xl leading-tight font-semibold text-balance md:text-3xl">
        Watch anywhere, on <span className="text-brand-red">any device</span>
      </h2>
      <div className="mt-8 grid min-w-0 gap-3 sm:grid-cols-3">
        {DEVICES.map((d) => (
          <div
            key={d.id}
            className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.05] p-6"
          >
            <d.Icon
              aria-hidden
              className="mx-auto size-8 text-white/80"
              strokeWidth={1.5}
            />
            <p className="mt-4 text-[15px] font-semibold">{d.title}</p>
            <p className="mt-1.5 text-[13px] leading-snug text-white/55">
              {d.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

type ResultLane = FindLane & { films: WatchFilmFinderCard[] }

function Results({
  lanes,
  count,
  interests,
  status,
  hasMore,
  more,
  onLoadMore,
  catalogHref,
  onRetry,
  onRestart,
}: {
  lanes: ResultLane[]
  count: number
  interests: number
  status: ResultState["status"]
  hasMore: boolean
  more: ResultState["more"]
  onLoadMore: () => void
  catalogHref:
    | ReturnType<typeof languagesIndexPath>
    | ReturnType<typeof languageVideosIndexPath>
  onRetry: () => void
  onRestart: () => void
}) {
  return (
    <div data-testid="watch-find-results" className="min-w-0">
      <div className="flex min-w-0 items-center gap-4">
        <span className="grid size-16 shrink-0 place-items-center rounded-full border-2 border-emerald-400 text-xl font-bold tabular-nums">
          {status === "ready" ? count : "–"}
        </span>
        <div className="min-w-0">
          <h2 className="text-2xl leading-tight font-semibold md:text-3xl">
            Films for you
          </h2>
          <p className="mt-1 text-[14px] text-white/55">
            from {interests} {interests === 1 ? "interest" : "interests"}
          </p>
        </div>
      </div>

      {/* The prototype's "Save my list" box is omitted: there is no saved-list
          backend, so it would be a dead button and an untrue claim. */}
      <div className="mt-6 grid min-w-0 gap-4 rounded-2xl border border-white/10 bg-white/[0.05] p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <ul className="grid min-w-0 gap-2">
          {[
            "Every film free to watch — no account, no card",
            "Download and show them anywhere, even offline",
          ].map((line) => (
            <li key={line} className="flex min-w-0 items-start gap-2.5">
              <Check
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-emerald-400"
              />
              <span className="min-w-0 text-[14px] leading-snug text-white/80">
                {line}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {status === "error" ? (
        <div role="alert" className="mt-10 min-w-0">
          <p className="text-[14px] text-white/55">
            Films are temporarily unavailable. Please try again.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className={cn(buttonVariants({ variant: "pill" }), "mt-4 h-12")}
          >
            Try again
          </button>
        </div>
      ) : null}

      {status === "ready" && count === 0 ? (
        <div className="mt-10 min-w-0">
          <p className="text-[14px] text-white/55">
            No films match this language and time in these interests yet.
          </p>
          <Link
            href={catalogHref}
            prefetch={false}
            data-testid="watch-finder-catalog"
            className="mt-3 inline-block text-[13px] text-white/45 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
          >
            Browse every film in this language
          </Link>
        </div>
      ) : null}

      {lanes.map((lane) => (
        <section key={lane.id} className="mt-10 min-w-0">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-xl font-semibold">{lane.title}</h3>
            <p className="text-[13px] text-white/45">
              {lane.films.length} films · {lane.blurb}
            </p>
          </div>

          <div className="mt-4 -mx-5 w-[calc(100%+2.5rem)] min-w-0 md:mx-0 md:w-full">
            <Carousel
              aria-label={lane.title}
              opts={{
                dragFree: true,
                containScroll: "trimSnaps",
                align: "start",
              }}
              className="w-full"
            >
              <CarouselContent
                data-testid={`watch-find-rail-${lane.id}`}
                className="-ml-3 pl-5 md:pl-0"
              >
                {lane.films.map((film) => (
                  <CarouselItem key={film.videoId} className="basis-auto pl-3">
                    <FilmCard film={film} />
                  </CarouselItem>
                ))}
                <CarouselItem
                  className="basis-auto pl-0"
                  aria-hidden
                  tabIndex={-1}
                >
                  <div className={CAROUSEL_END_SPACER} />
                </CarouselItem>
              </CarouselContent>
              <CarouselPrevious label={`Previous ${lane.title}`} />
              <CarouselNext label={`More ${lane.title}`} />
            </Carousel>
          </div>
        </section>
      ))}

      {/* The first round is bounded; the rest of the matches stay one
          explicit step away rather than being silently dropped. */}
      {status === "ready" && hasMore ? (
        <div data-testid="watch-find-more" className="mt-10 min-w-0">
          <p className="text-[13px] text-white/45">
            {count} films shown — more match your answers.
          </p>
          {more === "error" ? (
            <p role="alert" className="mt-2 text-[14px] text-white/55">
              More films are temporarily unavailable. Please try again.
            </p>
          ) : null}
          <button
            type="button"
            onClick={onLoadMore}
            disabled={more === "loading"}
            aria-busy={more === "loading"}
            className={cn(buttonVariants({ variant: "pill" }), "mt-4 h-12")}
          >
            {more === "loading"
              ? "Loading more films…"
              : more === "error"
                ? "Try again"
                : "Show more films"}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={onRestart}
        className="mt-10 cursor-pointer text-[13px] text-white/45 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white/80"
      >
        Start the questions again
      </button>
    </div>
  )
}

function FilmCard({ film }: { film: WatchFilmFinderCard }) {
  return (
    <Link
      href={film.href}
      prefetch={false}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="watch-find-film"
      className="group relative block w-[11rem] shrink-0 overflow-hidden rounded-xl border border-white/10 transition-[transform,border-color] duration-200 hover:-translate-y-1 hover:border-white focus-visible:border-white focus-visible:outline-none sm:w-[13rem]"
    >
      <span className="relative block aspect-[2/3] w-full bg-stone-900">
        {film.imageUrl ? (
          <Image
            src={film.imageUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 45vw, 208px"
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
        />
        <span className="absolute inset-x-0 bottom-0 block p-3">
          <span
            lang=""
            dir="auto"
            className="block text-[14px] leading-tight font-semibold"
          >
            {film.title}
          </span>
          {film.durationSeconds !== null ? (
            <span className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] tabular-nums text-white/70">
              <Play aria-hidden className="size-3" />
              {formatRuntime(film.durationSeconds)}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}
