"use client"

// One lesson of "Beginning With Jesus", played the way a phone already knows
// how to read: a story. Full-bleed cards, one beat each, segmented progress
// along the top, swipe or arrow to move. Ported from the read-only prototype.
//
// The content is unchanged — same lesson, same guide wording, and the same
// memory-only drafts as the page version, so a lesson started in the story
// finishes in the sheet. The deck is the shared semantic card list, so the
// position it reports is the real resume card.
//
// Moving between cards records position only. The prototype marked a third
// done when you reached its last card; that is not ported — a third is done
// only through its Finish control on the sheet. The prototype's invented
// polls, presence counts and other people's answers are not ported either.

import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Mic,
  Play,
  Sparkles,
  X,
} from "lucide-react"
import Image from "next/image"
import dynamic from "next/dynamic"
import { createPortal } from "react-dom"
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react"

import {
  LOOKING_BACK,
  LOOKING_FORWARD,
  type Lesson,
  type LessonCard as LessonDeckCard,
  type MovementId,
  type StepPrompt,
} from "@/lib/beginning-with-jesus"
import { cn } from "@/lib/utils"
import { useWatchModalActivity } from "./WatchModalActivityProvider"
import {
  LESSON_MEDIA,
  draftKey,
  questionDraftId,
  runtimeLabel,
  segmentStill,
  stepDraftId,
} from "./watch-grow-prototype-adapter"
import type { WatchGrowLessonContext } from "./WatchGrowCourse"

const MuxPlayer = dynamic(() => import("@forge/video-player/mux-player"), {
  ssr: false,
})

const BRAND_RED = "#ef3340"
const PAPER = "bg-[#efece4] text-stone-900"
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export type WatchGrowStoryProps = WatchGrowLessonContext & {
  /** Card to open on (a saved or returned position); unknown ids start at the cover. */
  initialCardId?: string | null
  /** Called after the visitor moves to another card. Never implies completion. */
  onCardChange?: (cardId: string) => void
}

/* ---------------------------------------------------------------------------
   The deck. One card is one thing to do.
--------------------------------------------------------------------------- */

type Chapter = "why" | "back" | "up" | "forward" | "end"

type Card = { id: string } & (
  | { kind: "cover"; chapter: "why" }
  | {
      kind: "step"
      chapter: "back" | "forward"
      third: MovementId
      group: string
      step: StepPrompt
    }
  | { kind: "intro"; chapter: "up" }
  | { kind: "watch"; chapter: "up" }
  | { kind: "retell"; chapter: "up" }
  | { kind: "question"; chapter: "up"; qi: number }
  | { kind: "conclusion"; chapter: "up" }
  | { kind: "truth"; chapter: "up"; i: number }
  | { kind: "end"; chapter: "end" }
)

const CHAPTER_NAME: Record<Chapter, string> = {
  why: "Why this one",
  back: "Looking Back",
  up: "Looking Up",
  forward: "Looking Forward",
  end: "Done",
}

/** The original deck, built from the shared card list so ids are the real ones. */
function buildDeck(cards: LessonDeckCard[]): Card[] {
  const prompt = (third: "back" | "forward", id: string) => {
    for (const g of third === "back" ? LOOKING_BACK : LOOKING_FORWARD)
      for (const step of g.items)
        if (stepDraftId(third, step.id) === id) return { group: g.title, step }
    return null
  }
  return cards.flatMap((c): Card[] => {
    if (c.id === "cover") return [{ id: c.id, kind: "cover", chapter: "why" }]
    if (c.id === "end") return [{ id: c.id, kind: "end", chapter: "end" }]
    if (c.movementId === "back" || c.movementId === "forward") {
      const found = prompt(c.movementId, c.id)
      return found
        ? [
            {
              id: c.id,
              kind: "step",
              chapter: c.movementId,
              third: c.movementId,
              ...found,
            },
          ]
        : []
    }
    if (c.id === "up-intro") return [{ id: c.id, kind: "intro", chapter: "up" }]
    if (c.id === "up-watch") return [{ id: c.id, kind: "watch", chapter: "up" }]
    if (c.id === "up-retell")
      return [{ id: c.id, kind: "retell", chapter: "up" }]
    if (c.id === "up-conclusion")
      return [{ id: c.id, kind: "conclusion", chapter: "up" }]
    const q = c.id.match(/^up-question-(\d+)$/)
    if (q)
      return [
        { id: c.id, kind: "question", chapter: "up", qi: Number(q[1]) - 1 },
      ]
    const t = c.id.match(/^up-truth-(\d+)$/)
    if (t)
      return [{ id: c.id, kind: "truth", chapter: "up", i: Number(t[1]) - 1 }]
    return []
  })
}

/* ---------------------------------------------------------------------------
   The player.
--------------------------------------------------------------------------- */

/** Drafts for this lesson, re-read on every change to the store. */
function useLessonDrafts(
  drafts: WatchGrowLessonContext["drafts"],
  lesson: Lesson,
) {
  const [, changed] = useReducer((n: number) => n + 1, 0)
  useEffect(() => drafts.subscribe(changed), [drafts])
  return {
    valueOf: (stepId: string) => drafts.get(draftKey(lesson, stepId)),
    setNote: (stepId: string, value: string) =>
      drafts.set(draftKey(lesson, stepId), value),
  }
}

export function WatchGrowStory({
  lesson,
  cards,
  drafts,
  session,
  showSheet,
  finish,
  initialCardId,
  onCardChange,
}: WatchGrowStoryProps) {
  const deck = useMemo(() => buildDeck(cards), [cards])
  const [at, setAt] = useState(() =>
    Math.max(
      0,
      deck.findIndex((c) => c.id === initialCardId),
    ),
  )
  const card = deck[at]!
  const touch = useRef<{ x: number; y: number } | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const { valueOf, setNote } = useLessonDrafts(drafts, lesson)
  const onClose = showSheet
  // The page player pauses while the story covers it, and resumes after.
  useWatchModalActivity(true)

  const latest = useRef({ at, deck, onCardChange })
  useEffect(() => {
    latest.current = { at, deck, onCardChange }
  })
  const go = useCallback((delta: number) => {
    const { at: current, deck: d, onCardChange: changed } = latest.current
    const target = Math.min(d.length - 1, Math.max(0, current + delta))
    if (target === current) return
    latest.current = { ...latest.current, at: target }
    setAt(target)
    changed?.(d[target]!.id)
  }, [])
  const restart = () => go(-latest.current.at)

  // Keyboard users land inside the story, not behind it. Everything else on
  // the page is made inert while it is open, so neither Tab nor a screen
  // reader can reach the controls it covers; the previous state is restored
  // on close.
  useEffect(() => {
    const root = rootRef.current
    const covered: Element[] = []
    for (const el of Array.from(document.body.children)) {
      if (el === root || el.hasAttribute("inert")) continue
      el.setAttribute("inert", "")
      covered.push(el)
    }
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      for (const el of covered) el.removeAttribute("inert")
    }
  }, [])

  /* Tab wraps within the story. The embedded player keeps its own controls in
     shadow DOM; it is one stop here and moves focus inside itself as usual. */
  const containTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !rootRef.current) return
    const stops = Array.from(
      rootRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), mux-player, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.checkVisibility?.() ?? true)
    const first = stops[0]
    const last = stops.at(-1)
    if (!first || !last) return
    const active = document.activeElement
    const inside = active instanceof Node && rootRef.current.contains(active)
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault()
      first.focus()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose()
      const el = document.activeElement
      const typing =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
      if (typing) return
      if (e.key === "ArrowRight") go(1)
      if (e.key === "ArrowLeft") go(-1)
    }
    window.addEventListener("keydown", onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = prev
    }
  }, [go, onClose])

  const isLast = at === deck.length - 1

  /* Portalled to the body on purpose. The block this opens from sits in its
     own stacking context, so a z-index here — however large — still paints
     under the site's fixed header. Only leaving the subtree fixes that. */
  if (typeof document === "undefined") return null

  return createPortal(
    <div
      ref={rootRef}
      onKeyDown={containTab}
      data-testid="watch-grow-story"
      data-card={at}
      data-card-id={card.id}
      data-card-kind={card.kind}
      role="dialog"
      aria-modal="true"
      aria-label={`Lesson ${lesson.n} as a story`}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onTouchStart={(e) => {
        const t = e.touches[0]
        touch.current = t ? { x: t.clientX, y: t.clientY } : null
      }}
      onTouchEnd={(e) => {
        const start = touch.current
        touch.current = null
        const t = e.changedTouches[0]
        if (!start || !t) return
        const dx = t.clientX - start.x
        const dy = t.clientY - start.y
        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy)) return
        go(dx < 0 ? 1 : -1)
      }}
    >
      {/* desktop chevrons — on a phone this is a swipe */}
      <button
        type="button"
        aria-label="Previous"
        onClick={() => go(-1)}
        disabled={at === 0}
        className="absolute left-3 z-20 hidden size-11 cursor-pointer place-items-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-white/60 hover:text-white disabled:opacity-20 lg:grid"
      >
        <ChevronLeft aria-hidden className="size-5" />
      </button>
      <button
        type="button"
        aria-label="Next"
        onClick={() => go(1)}
        disabled={isLast}
        className="absolute right-3 z-20 hidden size-11 cursor-pointer place-items-center rounded-full border border-white/20 text-white/70 transition-colors hover:border-white/60 hover:text-white disabled:opacity-20 lg:grid"
      >
        <ChevronRight aria-hidden className="size-5" />
      </button>

      <div className="relative flex h-full w-full flex-col overflow-hidden bg-stone-950 text-white sm:h-[min(92vh,860px)] sm:w-[min(94vw,436px)] sm:rounded-[28px] sm:shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]">
        <StoryBars deck={deck} at={at} />

        <div className="relative z-10 flex shrink-0 items-center justify-between px-4 pt-2 pb-1">
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-white/85">
              {CHAPTER_NAME[card.chapter]}
            </p>
            <p className="truncate text-[11px] text-white/45">
              Lesson {lesson.n} · {lesson.title}
            </p>
          </div>
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            aria-label="Close the story"
            data-testid="watch-grow-story-close"
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div
          key={at}
          className="relative min-h-0 flex-1 animate-[storyIn_320ms_ease-out]"
        >
          <CardBody
            card={card}
            lesson={lesson}
            session={session}
            setNote={setNote}
            valueOf={valueOf}
            onAdvance={() => go(1)}
            onRestart={restart}
            onFinish={finish}
          />
        </div>

        {card.kind !== "end" ? (
          <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 px-4 pt-1 pb-4">
            <p className="min-w-0 text-[11.5px] text-white/35">
              {at + 1} of {deck.length} · swipe or use ← →
            </p>
            <button
              type="button"
              onClick={() => go(1)}
              data-testid="watch-grow-story-next"
              className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full px-5 py-2.5 text-[14px] font-bold text-white transition-transform hover:scale-[1.03]"
              style={{ backgroundColor: BRAND_RED }}
            >
              Next
              <ArrowRight aria-hidden className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      <style>{`@keyframes storyIn{from{opacity:0;transform:translateY(10px) scale(0.99)}to{opacity:1;transform:none}}`}</style>
    </div>,
    document.body,
  )
}

export default WatchGrowStory

/** One hairline per card, grouped so you can see the chapters in it. */
function StoryBars({ deck, at }: { deck: Card[]; at: number }) {
  return (
    <div className="relative z-10 flex shrink-0 items-center gap-[3px] px-4 pt-3">
      {deck.map((c, i) => (
        <span
          key={i}
          className={cn(
            "h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-white/20",
            i > 0 && deck[i - 1].chapter !== c.chapter ? "ml-2" : "",
          )}
        >
          <span
            className="block h-full rounded-full bg-white transition-[width] duration-300"
            style={{ width: i <= at ? "100%" : "0%" }}
          />
        </span>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------------------
   Card bodies.
--------------------------------------------------------------------------- */

function CardBody({
  card,
  lesson,
  session,
  setNote,
  valueOf,
  onAdvance,
  onRestart,
  onFinish,
}: {
  card: Card
  lesson: Lesson
  session: WatchGrowLessonContext["session"]
  setNote: (key: string, value: string) => void
  valueOf: (key: string) => string
  onAdvance: () => void
  onRestart: () => void
  onFinish: () => void
}) {
  if (card.kind === "cover")
    return <CoverCard lesson={lesson} onAdvance={onAdvance} />

  if (card.kind === "step")
    return (
      <StepCard
        card={card}
        lesson={lesson}
        valueOf={valueOf}
        setNote={setNote}
        onAdvance={onAdvance}
      />
    )

  if (card.kind === "intro") return <IntroCard lesson={lesson} />

  if (card.kind === "watch")
    return (
      <WatchCard
        lesson={lesson}
        watched={session.watched}
        onWatched={session.countViewing}
      />
    )

  if (card.kind === "retell")
    return (
      <RetellCard
        lesson={lesson}
        retold={session.retold}
        onRetold={session.markRetold}
      />
    )

  if (card.kind === "question")
    return (
      <QuestionCard
        lesson={lesson}
        qi={card.qi}
        value={valueOf(questionDraftId(card.qi))}
        setNote={setNote}
      />
    )

  if (card.kind === "conclusion") return <ConclusionCard lesson={lesson} />
  if (card.kind === "truth") return <TruthCard lesson={lesson} i={card.i} />

  return (
    <EndCard
      lesson={lesson}
      valueOf={valueOf}
      onRestart={onRestart}
      onFinish={onFinish}
    />
  )
}

/** The frame every card sits in: full-bleed art, scrim, scrollable content. */
function Frame({
  art,
  tone = "dark",
  children,
}: {
  art?: string
  tone?: "dark" | "paper" | "red"
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden",
        tone === "paper" ? PAPER : tone === "red" ? "text-white" : "text-white",
      )}
      style={tone === "red" ? { backgroundColor: BRAND_RED } : undefined}
    >
      {art ? (
        <>
          <Image
            src={art}
            alt=""
            fill
            sizes="440px"
            className="object-cover opacity-35"
          />
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-stone-950/70 via-stone-950/85 to-stone-950"
          />
        </>
      ) : null}
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
        {children}
      </div>
    </div>
  )
}

function Eyebrow({
  children,
  tone = "dark",
}: {
  children: ReactNode
  tone?: "dark" | "paper" | "red"
}) {
  return (
    <p
      className={cn(
        "text-[11px] font-bold tracking-[0.18em] uppercase",
        tone === "paper"
          ? "text-stone-900/40"
          : tone === "red"
            ? "text-white/70"
            : "text-white/45",
      )}
    >
      {children}
    </p>
  )
}

function CoverCard({
  lesson,
  onAdvance,
}: {
  lesson: Lesson
  onAdvance: () => void
}) {
  return (
    <Frame art={segmentStill(LESSON_MEDIA[lesson.id].playbackId)}>
      <div className="flex min-h-full flex-col justify-end pb-2">
        <p
          className="text-[11px] font-bold tracking-[0.18em] uppercase"
          style={{ color: BRAND_RED }}
        >
          Lesson {lesson.n} of 9
        </p>
        <h2 className="mt-2 text-[28px] leading-[1.08] font-bold text-balance">
          {lesson.why.promise}
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-white/70">
          {lesson.why.payoff}
        </p>
        <p className="mt-4 rounded-xl bg-white/10 px-3.5 py-2.5 text-[13.5px] leading-snug text-white/75">
          Start here if{" "}
          <span className="font-semibold text-white">{lesson.why.ifYou}</span>.
        </p>
        <p className="mt-4 text-[12.5px] text-white/45">
          {lesson.title} · &ldquo;{lesson.segment}&rdquo; · {lesson.scripture}
        </p>
        <button
          type="button"
          onClick={onAdvance}
          data-testid="watch-grow-story-begin"
          className="mt-5 inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-3.5 text-[15px] font-bold text-white transition-transform hover:scale-[1.02]"
          style={{ backgroundColor: BRAND_RED }}
        >
          <Play aria-hidden className="size-4 fill-current" />
          Begin
        </button>
      </div>
    </Frame>
  )
}

/* --- the interactive steps ------------------------------------------------ */

function StepCard({
  card,
  lesson,
  valueOf,
  setNote,
  onAdvance,
}: {
  card: Extract<Card, { kind: "step" }>
  lesson: Lesson
  valueOf: (key: string) => string
  setNote: (key: string, value: string) => void
  onAdvance: () => void
}) {
  const key = stepDraftId(card.third, card.step.id)
  const ui = card.step.ui
  const value = valueOf(key)
  const write = (v: string) => setNote(key, v)

  return (
    <Frame art={segmentStill(LESSON_MEDIA[lesson.id].playbackId)}>
      <div className="flex min-h-full flex-col">
        <Eyebrow>{card.group}</Eyebrow>
        <h2 className="mt-2.5 text-[25px] leading-[1.14] font-bold text-balance">
          {card.step.solo}
        </h2>

        <div className="mt-6 min-w-0">
          {ui.kind === "choice" ? (
            <Poll
              options={ui.options}
              then={ui.then}
              value={value}
              onChange={write}
            />
          ) : null}
          {ui.kind === "people" ? (
            <People
              placeholder={ui.placeholder}
              value={value}
              onChange={write}
            />
          ) : null}
          {ui.kind === "write" ? (
            <Sticker
              placeholder={ui.placeholder}
              value={value}
              onChange={write}
            />
          ) : null}
          {ui.kind === "commit" ? (
            <Commit
              placeholder={ui.placeholder}
              value={value}
              onChange={write}
            />
          ) : null}
          {ui.kind === "still" ? (
            <Still
              seconds={ui.seconds}
              verb={ui.verb}
              done={value === "done"}
              onDone={() => {
                write("done")
                onAdvance()
              }}
            />
          ) : null}
          {ui.kind === "recall" ? (
            <Recall
              names={valueOf(stepDraftId("back", "carrying"))}
              done={value === "done"}
              onDone={() => write("done")}
            />
          ) : null}
        </div>
      </div>
    </Frame>
  )
}

/**
 * A story poll. The prototype then revealed how "everyone else" answered;
 * those shares were invented, so the choice stands on its own here.
 */
function Poll({
  options,
  then,
  value,
  onChange,
}: {
  options: string[]
  then?: string
  value: string
  onChange: (v: string) => void
}) {
  const [picked, ...rest] = value.split("\n")
  const more = rest.join("\n")
  const answered = options.includes(picked ?? "")

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-2">
        {options.map((o) => {
          const mine = o === picked
          return (
            <button
              key={o}
              type="button"
              aria-pressed={mine}
              data-testid="watch-grow-story-poll-option"
              onClick={() => onChange(more ? `${o}\n${more}` : o)}
              className={cn(
                "relative min-w-0 cursor-pointer overflow-hidden rounded-2xl border px-4 py-3 text-left text-[15px] font-semibold transition-colors",
                mine
                  ? "border-white bg-white/[0.14] text-white"
                  : "border-white/20 text-white/85 hover:border-white/50",
              )}
            >
              <span className="relative flex min-w-0 items-center justify-between gap-3">
                <span className="min-w-0 truncate">{o}</span>
                {mine ? (
                  <span className="shrink-0 text-[13px] font-bold tabular-nums text-white/60">
                    <Check
                      aria-hidden
                      className="mr-1 inline size-3.5"
                      style={{ color: BRAND_RED }}
                    />
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {answered && then ? (
        <div className="mt-4">
          <Sticker
            placeholder={then}
            value={more}
            onChange={(v) => onChange(v ? `${picked}\n${v}` : (picked ?? ""))}
          />
        </div>
      ) : null}
    </div>
  )
}

/** The white rounded box a story asks a question in. */
function Sticker({
  placeholder,
  value,
  onChange,
  rows = 4,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  rows?: number
}) {
  return (
    <label className="block min-w-0 rounded-2xl bg-white p-3.5 text-stone-900 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.8)]">
      <span className="sr-only">{placeholder}</span>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-testid="watch-grow-story-write"
        className="block w-full resize-none bg-transparent text-[15px] leading-relaxed placeholder:text-stone-900/35 focus:outline-none"
      />
    </label>
  )
}

function People({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  const [draft, setDraft] = useState("")
  const names = value
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)

  const add = () => {
    const n = draft.trim()
    if (!n) return
    onChange([...names, n].join(", "))
    setDraft("")
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 gap-2">
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          data-testid="watch-grow-story-person"
          className="min-w-0 flex-1 rounded-2xl bg-white px-4 py-3 text-[15px] text-stone-900 placeholder:text-stone-900/35 focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 cursor-pointer rounded-2xl bg-white/15 px-4 text-[14px] font-bold transition-colors hover:bg-white/25"
        >
          Add
        </button>
      </div>
      {names.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {names.map((n, i) => (
            <button
              key={`${n}-${i}`}
              type="button"
              onClick={() =>
                onChange(names.filter((_, j) => j !== i).join(", "))
              }
              className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/25 px-3.5 py-1.5 text-[14px] font-semibold hover:border-white/60"
            >
              {n}
              <X aria-hidden className="size-3.5 opacity-50" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Commit({
  placeholder,
  value,
  onChange,
}: {
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  const [text, day] = value.split("|")
  return (
    <div className="min-w-0">
      <Sticker
        rows={3}
        placeholder={placeholder}
        value={text ?? ""}
        onChange={(v) => onChange(day ? `${v}|${day}` : v)}
      />
      <p className="mt-4 text-[12.5px] font-semibold text-white/50">
        By which day?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {DAYS.map((d) => (
          <button
            key={d}
            type="button"
            data-testid="watch-grow-story-day"
            onClick={() => onChange(`${text ?? ""}|${d === day ? "" : d}`)}
            className={cn(
              "cursor-pointer rounded-full border px-3.5 py-1.5 text-[13.5px] font-bold transition-colors",
              d === day
                ? "border-white bg-white text-stone-900"
                : "border-white/20 text-white/70 hover:border-white/55",
            )}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A countdown you actually sit through. It moves the story on by itself. */
function Still({
  seconds,
  verb,
  done,
  onDone,
}: {
  seconds: number
  verb: string
  done: boolean
  onDone: () => void
}) {
  const [left, setLeft] = useState<number | null>(null)
  /* Held in a ref so a new `onDone` identity each render does not restart the
     countdown — the tick effect must depend on `left` and nothing else. */
  const finish = useRef(onDone)
  useEffect(() => {
    finish.current = onDone
  })

  useEffect(() => {
    if (left === null) return
    const t = window.setTimeout(() => {
      if (left <= 1) {
        finish.current()
        setLeft(null)
      } else setLeft(left - 1)
    }, 1000)
    return () => window.clearTimeout(t)
  }, [left])

  const running = left !== null
  const pct = running ? ((seconds - left) / seconds) * 100 : done ? 100 : 0

  return (
    <div className="flex min-w-0 flex-col items-center py-4">
      <button
        type="button"
        onClick={() => setLeft(running ? null : seconds)}
        data-testid="watch-grow-story-still"
        className="relative grid size-44 cursor-pointer place-items-center rounded-full"
        style={{
          background: `conic-gradient(${BRAND_RED} ${pct}%, rgba(255,255,255,0.14) 0)`,
        }}
      >
        <span className="grid size-[10.25rem] place-items-center rounded-full bg-stone-950 text-center">
          <span>
            <span className="block text-[34px] leading-none font-bold tabular-nums">
              {running
                ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
                : done
                  ? "Done"
                  : verb}
            </span>
            <span className="mt-1.5 block text-[12.5px] text-white/45">
              {running ? "Tap to stop" : done ? "Tap to sit again" : "Tap"}
            </span>
          </span>
        </span>
      </button>
      {done && !running ? (
        <p className="mt-4 inline-flex items-center gap-2 text-[13px] font-semibold text-white/70">
          <Check aria-hidden className="size-4" style={{ color: BRAND_RED }} />
          You stayed with it.
        </p>
      ) : null}
    </div>
  )
}

function Recall({
  names,
  done,
  onDone,
}: {
  names: string
  done: boolean
  onDone: () => void
}) {
  const list = names
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)

  if (list.length === 0)
    return (
      <p className="rounded-2xl bg-white/[0.07] px-4 py-5 text-[14.5px] leading-relaxed text-white/60">
        You did not name anyone at the start of this lesson. Go back to Looking
        Back and put one name in — this card brings it here to be prayed for.
      </p>
    )

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap gap-2">
        {list.map((n) => (
          <span
            key={n}
            data-testid="watch-grow-story-recall-name"
            className="rounded-full border border-white/25 px-4 py-2 text-[15px] font-semibold"
          >
            {n}
          </span>
        ))}
      </div>
      <p className="mt-4 text-[13.5px] leading-relaxed text-white/55">
        You carried {list.length === 1 ? "this name" : "these names"} into the
        lesson. Take a minute for {list.length === 1 ? "them" : "each of them"}{" "}
        now.
      </p>
      <Still
        seconds={30}
        verb={`Pray for ${list[0]}`}
        done={done}
        onDone={onDone}
      />
    </div>
  )
}

/* --- Looking Up ----------------------------------------------------------- */

function WatchCard({
  lesson,
  watched,
  onWatched,
}: {
  lesson: Lesson
  watched: number
  onWatched: () => void
}) {
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-black">
      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <MuxPlayer
          playbackId={LESSON_MEDIA[lesson.id].playbackId}
          streamType="on-demand"
          accentColor={BRAND_RED}
          thumbnailTime={2}
          onEnded={onWatched}
          style={{ width: "100%", aspectRatio: "16 / 9" }}
        />
      </div>
      <div className="shrink-0 px-5 py-4">
        <Eyebrow>Looking Up · the guide&rsquo;s step one</Eyebrow>
        <h2 className="mt-2 text-[21px] leading-tight font-bold text-balance">
          &ldquo;{lesson.segment}&rdquo;
        </h2>
        <p className="mt-2 text-[13.5px] text-white/55">
          {lesson.scripture} · {runtimeLabel(LESSON_MEDIA[lesson.id].seconds)} ·
          watch it twice — once to see it, once to notice it.
        </p>
        <div className="mt-3 flex items-center gap-2">
          {[0, 1].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                watched > i ? "" : "bg-white/15",
              )}
              style={watched > i ? { backgroundColor: BRAND_RED } : undefined}
            />
          ))}
          <button
            type="button"
            onClick={onWatched}
            data-testid="watch-grow-story-watched"
            className="shrink-0 cursor-pointer rounded-full border border-white/25 px-3.5 py-1.5 text-[12.5px] font-bold text-white/80 hover:border-white/60"
          >
            {watched >= 2 ? "Watched twice" : "Mark watched"}
          </button>
        </div>
      </div>
    </div>
  )
}

function RetellCard({
  lesson,
  retold,
  onRetold,
}: {
  lesson: Lesson
  retold: boolean
  onRetold: () => void
}) {
  return (
    <Frame art={segmentStill(LESSON_MEDIA[lesson.id].playbackId)}>
      <div className="flex min-h-full flex-col">
        <Eyebrow>Looking Up · the guide&rsquo;s step two</Eyebrow>
        <h2 className="mt-2.5 text-[25px] leading-[1.14] font-bold text-balance">
          Now tell it back, out loud.
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-white/65">
          Nobody is listening. Saying a story in your own words is how it stops
          being something you watched and starts being something you know.
        </p>
        <div className="mt-2">
          <Still seconds={60} verb="Tell it" done={retold} onDone={onRetold} />
        </div>
        <p className="mt-1 flex items-center justify-center gap-2 text-[12.5px] text-white/40">
          <Mic aria-hidden className="size-3.5" />
          Out loud, to the room you are in.
        </p>
      </div>
    </Frame>
  )
}

/** A discussion question, answered in your own words. */
function QuestionCard({
  lesson,
  qi,
  value,
  setNote,
}: {
  lesson: Lesson
  qi: number
  value: string
  setNote: (key: string, value: string) => void
}) {
  return (
    <Frame tone="paper">
      <div className="flex min-h-full flex-col">
        <Eyebrow tone="paper">
          Question {qi + 1} of {lesson.questions.length}
        </Eyebrow>
        <h2 className="mt-2.5 text-[23px] leading-[1.16] font-bold text-balance">
          {lesson.questions[qi]}
        </h2>

        <label className="mt-5 block min-w-0 rounded-2xl border border-stone-900/15 bg-white p-3.5">
          <span className="sr-only">Your answer</span>
          <textarea
            rows={5}
            value={value}
            placeholder="What do you actually think?"
            onChange={(e) => setNote(questionDraftId(qi), e.target.value)}
            data-testid="watch-grow-story-answer"
            className="block w-full resize-none bg-transparent text-[15px] leading-relaxed placeholder:text-stone-900/35 focus:outline-none"
          />
        </label>
        <p className="mt-3 text-[11.5px] leading-relaxed text-stone-900/35">
          Kept in this tab only. Nothing you type is sent anywhere.
        </p>
      </div>
    </Frame>
  )
}

/** The guide's own Introduction — what this segment is, before you watch it. */
function IntroCard({ lesson }: { lesson: Lesson }) {
  return (
    <Frame art={segmentStill(LESSON_MEDIA[lesson.id].playbackId)}>
      <div className="flex min-h-full flex-col justify-center">
        <Eyebrow>Before you watch</Eyebrow>
        <h2 className="mt-2.5 text-[23px] leading-[1.14] font-bold text-balance">
          &ldquo;{lesson.segment}&rdquo;
        </h2>
        <p className="mt-4 text-[15.5px] leading-relaxed text-white/80">
          {lesson.intro}
        </p>
        <p className="mt-5 text-[12.5px] text-white/40">
          {lesson.scripture} · {runtimeLabel(LESSON_MEDIA[lesson.id].seconds)} ·
          the guide&rsquo;s own introduction
        </p>
      </div>
    </Frame>
  )
}

function ConclusionCard({ lesson }: { lesson: Lesson }) {
  return (
    <Frame tone="paper">
      <div className="flex min-h-full flex-col">
        <Eyebrow tone="paper">So then</Eyebrow>
        <p className="mt-3 text-[18px] leading-[1.42] font-semibold text-balance">
          {lesson.conclusion}
        </p>
        {lesson.pointsTitle ? (
          <p
            className="mt-5 text-[13px] font-bold tracking-[0.14em] uppercase"
            style={{ color: BRAND_RED }}
          >
            {lesson.pointsTitle} — one at a time
          </p>
        ) : null}
        <p className="mt-2 text-[13px] text-stone-900/45">
          The guide&rsquo;s own words, from {lesson.scripture}.
        </p>
      </div>
    </Frame>
  )
}

function TruthCard({ lesson, i }: { lesson: Lesson; i: number }) {
  const points = lesson.points ?? []
  return (
    <Frame tone="red">
      <div className="flex min-h-full flex-col justify-center">
        <p className="text-[64px] leading-none font-bold text-white/25 tabular-nums">
          {i + 1}
        </p>
        <p className="mt-3 text-[23px] leading-[1.24] font-bold text-balance">
          {points[i]}
        </p>
        <p className="mt-5 text-[12.5px] text-white/60">
          {lesson.pointsTitle ?? "From the conclusion"} · {i + 1} of{" "}
          {points.length}
        </p>
        {i === points.length - 1 && lesson.conclusionEnd ? (
          <p className="mt-5 border-t border-white/25 pt-4 text-[14px] leading-relaxed text-white/85">
            {lesson.conclusionEnd}
          </p>
        ) : null}
      </div>
    </Frame>
  )
}

/* --- the last card -------------------------------------------------------- */

function EndCard({
  lesson,
  valueOf,
  onRestart,
  onFinish,
}: {
  lesson: Lesson
  valueOf: (stepId: string) => string
  onRestart: () => void
  onFinish: () => void
}) {
  const note = (id: string) => valueOf(id).trim()
  const mood = note(stepDraftId("back", "how")).split("\n")[0]
  const carrying = note(stepDraftId("back", "carrying"))
  const [commit, day] = note(stepDraftId("forward", "differently")).split("|")
  const answered = lesson.questions.filter((_, qi) =>
    note(questionDraftId(qi)),
  ).length

  const rows = [
    mood ? { label: "You came in", value: mood } : null,
    carrying ? { label: "You carried", value: carrying } : null,
    answered
      ? {
          label: "You answered",
          value: `${answered} of ${lesson.questions.length} questions in your own words`,
        }
      : null,
    commit
      ? {
          label: "You said you would",
          value: day ? `${commit} — by ${day}` : commit,
        }
      : null,
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <Frame art={segmentStill(LESSON_MEDIA[lesson.id].playbackId)}>
      <div className="flex min-h-full flex-col justify-center">
        <Sparkles aria-hidden className="size-7" style={{ color: BRAND_RED }} />
        <h2 className="mt-3 text-[27px] leading-[1.1] font-bold text-balance">
          That is lesson {lesson.n}.
        </h2>
        <p className="mt-3 text-[14.5px] leading-relaxed text-white/65">
          {rows.length > 0
            ? "In your own words, this is what you just did:"
            : "You went through it without writing anything down. That is allowed — but the recap at the end is built only from your own words, so it will be empty."}
        </p>

        {rows.length > 0 ? (
          <dl
            data-testid="watch-grow-story-end-rows"
            className="mt-4 flex flex-col gap-3"
          >
            {rows.map((r) => (
              <div
                key={r.label}
                className="min-w-0 rounded-2xl bg-white/[0.08] px-4 py-3"
              >
                <dt className="text-[11px] font-bold tracking-[0.16em] text-white/40 uppercase">
                  {r.label}
                </dt>
                <dd className="mt-1 text-[15px] leading-snug font-semibold">
                  {r.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onFinish}
            data-testid="watch-grow-story-finish"
            className="inline-flex cursor-pointer items-center gap-2 rounded-full px-5 py-3 text-[14.5px] font-bold text-white transition-transform hover:scale-[1.02]"
            style={{ backgroundColor: BRAND_RED }}
          >
            Back to the lesson
            <ArrowRight aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            onClick={onRestart}
            className="cursor-pointer rounded-full border border-white/25 px-5 py-3 text-[14.5px] font-bold text-white/80 hover:border-white/60"
          >
            Play it again
          </button>
        </div>
      </div>
    </Frame>
  )
}
