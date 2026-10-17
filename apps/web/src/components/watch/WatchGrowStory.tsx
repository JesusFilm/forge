"use client"

import Link from "next/link"
import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
  type TouchEvent,
} from "react"

import {
  BWJ,
  MOVEMENTS,
  chapterHref,
  type Lesson,
  type LessonCard,
} from "@/lib/beginning-with-jesus"
import { cn } from "@/lib/utils"
import {
  WATCH_LEARNING_DRAFT_LABEL,
  useWatchLearningDraft,
  type WatchLearningDraftStore,
} from "./watch-learning-drafts"
import type { WatchGrowLessonContext } from "./WatchGrowCourse"

// One lesson read as a story: one card, one beat. Loaded only when a visitor
// chooses "Read as story", inside WatchGrow's existing Dialog, which already
// owns focus containment, Escape, scroll locking and shared modal activity.
//
// The deck is the same semantic card list the sheet renders, against the same
// draft store and the same structured progress callback, so a lesson started
// here finishes in the sheet. Moving between cards records position only:
// steps and the lesson complete solely through their own visible controls.

export type WatchGrowStoryProps = WatchGrowLessonContext & {
  /** Card to open on (a saved or returned position); unknown ids start at the cover. */
  initialCardId?: string | null
  /** Called after the visitor moves to another card. Never implies completion. */
  onCardChange?: (cardId: string) => void
}

const SWIPE_PX = 56
const NAV =
  "inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border border-white/30 px-4 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-35"

function chapterOf(card: LessonCard) {
  if (card.id === "cover") return "Why this lesson"
  if (card.id === "end") return "Take it with you"
  return MOVEMENTS.find((movement) => movement.id === card.movementId)!.name
}

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

export function WatchGrowStory({
  lesson,
  cards,
  progress,
  onProgressChange,
  drafts,
  showSheet,
  initialCardId,
  onCardChange,
}: WatchGrowStoryProps) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      cards.findIndex((card) => card.id === initialCardId),
    ),
  )
  const root = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusHeading = useRef(true)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const latest = useRef({ index, cards, onCardChange })
  useEffect(() => {
    latest.current = { index, cards, onCardChange }
  })
  const card = cards[index]!
  const last = cards.length - 1

  function go(next: number, { fromKeyboard = false } = {}) {
    const {
      index: current,
      cards: deck,
      onCardChange: changed,
    } = latest.current
    const target = Math.min(deck.length - 1, Math.max(0, next))
    if (target === current) return
    // A button that becomes disabled would drop focus to the page; keyboard
    // moves land on the new card's heading so screen readers announce it.
    focusHeading.current =
      fromKeyboard || target === 0 || target === deck.length - 1
    latest.current = { ...latest.current, index: target }
    setIndex(target)
    changed?.(deck[target]!.id)
  }

  useEffect(() => {
    if (!focusHeading.current) return
    focusHeading.current = false
    heading.current?.focus({ preventScroll: true })
    const story = root.current
    const viewport = story?.closest<HTMLElement>(
      '[data-slot="dialog-viewport"]',
    )
    if (story && viewport) {
      // scrollIntoView also moves the document behind this fixed dialog.
      // Only the dialog's scrolling viewport owns the story position.
      viewport.scrollTop +=
        story.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    }
  }, [index])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey) return
      if (event.metaKey || isTyping(event.target)) return
      const story = root.current
      const scope = story?.closest('[role="dialog"]') ?? story
      if (!scope || !(event.target instanceof Node)) return
      if (!scope.contains(event.target)) return
      const { index: current, cards: deck } = latest.current
      const step =
        event.key === "ArrowRight"
          ? current + 1
          : event.key === "ArrowLeft"
            ? current - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? deck.length - 1
                : null
      if (step === null) return
      event.preventDefault()
      go(step, { fromKeyboard: true })
    }
    // Base UI contains dialog key events before they reach window bubbling.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // `go` reads everything it needs from `latest`.
  }, [])

  function onTouchStart(event: TouchEvent) {
    const point = event.touches[0]
    touch.current =
      point && !isTyping(event.target)
        ? { x: point.clientX, y: point.clientY }
        : null
  }
  function onTouchEnd(event: TouchEvent) {
    const start = touch.current
    touch.current = null
    const point = event.changedTouches[0]
    if (!start || !point) return
    const dx = point.clientX - start.x
    const dy = point.clientY - start.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return
    go(index + (dx < 0 ? 1 : -1))
  }

  function toggle(id: string, checked: boolean) {
    onProgressChange({
      ...progress,
      completedStepIds: checked
        ? [...progress.completedStepIds, id]
        : progress.completedStepIds.filter((step) => step !== id),
    })
  }

  return (
    <section
      ref={root}
      data-testid="watch-grow-story"
      data-card-id={card.id}
      data-card-index={index}
      aria-roledescription="story"
      aria-label={`Lesson ${lesson.n} as a story`}
      className="mt-6 min-w-0 scroll-mt-4 overflow-hidden rounded-2xl bg-stone-950 text-white"
    >
      <div aria-hidden className="flex gap-[3px] px-4 pt-4">
        {cards.map((item, position) => (
          <span
            key={item.id}
            className={cn(
              "h-[3px] min-w-0 flex-1 rounded-full",
              position <= index ? "bg-white" : "bg-white/25",
              position > 0 &&
                chapterOf(cards[position - 1]!) !== chapterOf(item)
                ? "ml-1.5"
                : "",
            )}
          />
        ))}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 px-4 pt-3">
        <p className="min-w-0 truncate text-xs font-semibold text-white/80">
          {chapterOf(card)} · Lesson {lesson.n}
        </p>
        <button
          type="button"
          onClick={showSheet}
          className="min-h-11 shrink-0 cursor-pointer rounded-full px-3 text-sm font-semibold text-white/85 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-white"
        >
          Back to lesson sheet
        </button>
      </div>
      <div
        key={card.id}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="min-h-80 min-w-0 px-5 pt-4 pb-6 break-words duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 sm:px-8"
      >
        <CardBody
          card={card}
          lesson={lesson}
          headingRef={heading}
          drafts={drafts}
          checked={progress.completedStepIds.includes(card.id)}
          onToggle={(checked) => toggle(card.id, checked)}
          completed={progress.completed}
          onComplete={() =>
            onProgressChange({ ...progress, completed: !progress.completed })
          }
          onBegin={() => go(1)}
        />
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
        <p className="text-xs text-white/70" aria-live="polite">
          Card {index + 1} of {cards.length}
          <span className="hidden sm:inline"> · use ← → keys</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className={NAV}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className={cn(NAV, "border-transparent bg-[#c41230]")}
            disabled={index === last}
            onClick={() => go(index + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </section>
  )
}

export default WatchGrowStory

function CardBody({
  card,
  lesson,
  headingRef,
  drafts,
  checked,
  onToggle,
  completed,
  onComplete,
  onBegin,
}: {
  card: LessonCard
  lesson: Lesson
  headingRef: RefObject<HTMLHeadingElement | null>
  drafts: WatchLearningDraftStore
  checked: boolean
  onToggle: (checked: boolean) => void
  completed: boolean
  onComplete: () => void
  onBegin: () => void
}) {
  const title = (
    <h4
      ref={headingRef}
      tabIndex={-1}
      className="text-2xl leading-tight font-semibold outline-none sm:text-3xl"
    >
      {card.title}
    </h4>
  )

  if (card.id === "cover") {
    return (
      <div className="max-w-prose">
        <p className="text-sm text-white/75">
          Lesson {lesson.n}: {lesson.title}
        </p>
        <p className="mt-4 text-sm">Start here if {lesson.why.ifYou}.</p>
        <div className="mt-2">{title}</div>
        <p className="mt-3 leading-relaxed text-white/90">{card.body}</p>
        <p className="mt-3 text-xs text-white/60">
          Watch adaptation: benefit statements and solo prompts are original
          rewrites for individual reflection.
        </p>
        <button
          type="button"
          onClick={onBegin}
          className="mt-6 min-h-11 cursor-pointer rounded-full bg-white px-5 text-sm font-semibold text-stone-950 hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          Begin with Looking Back
        </button>
      </div>
    )
  }

  if (card.id === "end") {
    return (
      <div className="max-w-prose">
        {title}
        <p className="mt-3 leading-relaxed whitespace-pre-line text-white/90">
          {card.body}
        </p>
        <p className="mt-5 text-sm text-white/75">
          Reaching the last card does not complete the lesson. Choose when you
          are finished.
        </p>
        <button
          type="button"
          onClick={onComplete}
          className="mt-3 min-h-11 cursor-pointer rounded-full bg-white px-5 text-sm font-semibold text-stone-950 hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          {completed ? "Mark lesson incomplete" : "Mark lesson complete"}
        </button>
        <p className="mt-2 text-sm" aria-live="polite">
          {completed
            ? "Lesson marked complete."
            : "Lesson not marked complete."}
        </p>
        <p className="mt-6 text-xs text-white/60">
          {BWJ.copyright}. Lesson {lesson.n}, page {lesson.sourcePage}.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-prose">
      {title}
      {card.movementId === "up" && card.id === "up-intro" ? (
        <p className="mt-2 text-sm text-white/70">{lesson.scripture}</p>
      ) : null}
      <p className="mt-3 leading-relaxed whitespace-pre-line text-white/90">
        {card.body}
      </p>
      {card.source === "watch-adaptation" ? (
        <p className="mt-2 text-xs text-white/60">
          Watch adaptation
          {card.id.startsWith("up-truth-") && lesson.pointsNote
            ? `: ${lesson.pointsNote}`
            : " for individual reflection"}
          .
        </p>
      ) : null}
      {card.guide ? (
        <details className="mt-3 text-sm">
          <summary className="min-h-8 cursor-pointer underline underline-offset-4">
            Original guide prompt
          </summary>
          <p className="mt-2 leading-relaxed text-white/85">{card.guide}</p>
        </details>
      ) : null}
      {card.id === "up-watch" ? (
        <Link
          href={chapterHref(lesson.slug)}
          prefetch={false}
          className="mt-4 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
        >
          Watch {lesson.segment}
        </Link>
      ) : null}
      {card.reflection ? (
        <StoryReflection lesson={lesson} card={card} drafts={drafts} />
      ) : null}
      {card.completable ? (
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5 accent-red-600"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
          />
          Mark {card.title.toLowerCase()} complete
        </label>
      ) : null}
    </div>
  )
}

function StoryReflection({
  lesson,
  card,
  drafts,
}: {
  lesson: Lesson
  card: LessonCard
  drafts: WatchLearningDraftStore
}) {
  const id = useId()
  const [value, setValue] = useWatchLearningDraft(
    {
      courseId: BWJ.courseId,
      contentVersion: BWJ.contentVersion,
      lessonId: lesson.id,
      stepId: card.id,
    },
    drafts,
  )
  return (
    <div className="mt-4">
      <label htmlFor={id} className="block text-sm font-semibold">
        Your reflection: {card.title}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        className="mt-2 w-full resize-y rounded-lg border border-white/25 bg-white/10 p-3 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      />
      <p className="mt-1 text-xs text-white/60">
        {WATCH_LEARNING_DRAFT_LABEL}. Not sent to your account.
      </p>
    </div>
  )
}
