"use client"

import Link from "next/link"
import { useEffect, useId, useRef, useState, type ReactNode } from "react"

import {
  BWJ,
  LESSONS,
  LESSON_STEPS,
  MOVEMENTS,
  chapterHref,
  lessonCards,
  type Lesson,
  type LessonCard,
  type LessonId,
} from "@/lib/beginning-with-jesus"
import {
  WATCH_LEARNING_DRAFT_LABEL,
  useWatchLearningDraft,
  watchLearningDrafts,
  type WatchLearningDraftStore,
} from "./watch-learning-drafts"

export type WatchGrowLessonProgress = {
  completedStepIds: readonly string[]
  completed: boolean
}
export type WatchGrowProgressChange = {
  courseId: typeof BWJ.courseId
  contentVersion: typeof BWJ.contentVersion
  lessonId: LessonId
  progress: WatchGrowLessonProgress
}
export type WatchGrowLessonContext = {
  lesson: Lesson
  cards: LessonCard[]
  progress: WatchGrowLessonProgress
  onProgressChange: (next: WatchGrowLessonProgress) => void
  drafts: WatchLearningDraftStore
  showSheet: () => void
}
export type WatchGrowCourseProps = {
  initialLessonId?: LessonId
  /** Open the initial lesson in the story view (a resume or sign-in return). */
  initialStory?: boolean
  /** Controlled structured progress. Reflection text never enters this adapter. */
  progress?: Partial<Record<LessonId, WatchGrowLessonProgress>>
  onProgressChange?: (change: WatchGrowProgressChange) => void
  onLessonChange?: (lessonId: LessonId) => void
  drafts?: WatchLearningDraftStore
  /** U10 supplies saved/unsaved/error status and the hosted-auth save intent. */
  progressStatus?: ReactNode
  /** U10 owns the deferred story implementation; no future module is imported here. */
  renderStory?: (context: WatchGrowLessonContext) => ReactNode
}

const EMPTY_PROGRESS: WatchGrowLessonProgress = {
  completedStepIds: [],
  completed: false,
}
const ACTION =
  "min-h-11 cursor-pointer rounded-full border border-current/25 px-4 py-2 text-sm font-semibold hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-default disabled:opacity-40"

/** Content-only course, mounted inside WatchGrow's shared Dialog after open intent. */
export function WatchGrowCourse({
  initialLessonId = "lesson-1",
  initialStory = false,
  progress,
  onProgressChange,
  onLessonChange,
  drafts = watchLearningDrafts,
  progressStatus,
  renderStory,
}: WatchGrowCourseProps) {
  const selectId = useId()
  const [lessonId, setLessonId] = useState(initialLessonId)
  const [story, setStory] = useState(initialStory && Boolean(renderStory))
  const storyButton = useRef<HTMLButtonElement>(null)
  // Closing the story removes the focused control; hand focus back to the
  // button that opened it. Armed only by the close action, never on mount.
  const [restoreStoryFocus, setRestoreStoryFocus] = useState(false)
  useEffect(() => {
    if (story || !restoreStoryFocus) return
    storyButton.current?.focus()
  }, [story, restoreStoryFocus])
  const [sessionProgress, setSessionProgress] = useState<
    Partial<Record<LessonId, WatchGrowLessonProgress>>
  >({})
  const lesson = LESSONS.find((item) => item.id === lessonId)!
  const current = (progress ?? sessionProgress)[lessonId] ?? EMPTY_PROGRESS
  const cards = lessonCards(lesson)

  function select(next: LessonId) {
    setLessonId(next)
    setRestoreStoryFocus(false)
    setStory(false)
    onLessonChange?.(next)
  }
  function change(next: WatchGrowLessonProgress) {
    // No navigation, input, playback event or timer calls this function.
    if (progress === undefined) {
      setSessionProgress((previous) => ({ ...previous, [lessonId]: next }))
    }
    onProgressChange?.({
      courseId: BWJ.courseId,
      contentVersion: BWJ.contentVersion,
      lessonId,
      progress: next,
    })
  }

  return (
    <div className="min-w-0" data-lesson-id={lesson.id}>
      <label htmlFor={selectId} className="block text-sm font-semibold">
        Choose a lesson
      </label>
      <select
        id={selectId}
        value={lessonId}
        onChange={(event) => select(event.target.value as LessonId)}
        className="mt-2 min-h-11 w-full min-w-0 rounded-lg border border-stone-400 bg-[#efece4] p-2 text-base text-stone-950"
      >
        {LESSONS.map((item) => (
          <option key={item.id} value={item.id}>
            {item.n}. {item.title}
          </option>
        ))}
      </select>
      <h3 className="mt-6 text-2xl leading-tight font-semibold sm:text-3xl">
        Lesson {lesson.n}: {lesson.title}
      </h3>
      <div className="mt-4 max-w-prose">
        <p className="text-sm">Start here if {lesson.why.ifYou}.</p>
        <p className="mt-2 text-2xl font-semibold">{lesson.why.promise}</p>
        <p className="mt-2 leading-relaxed">{lesson.why.payoff}</p>
        <p className="mt-2 text-xs text-stone-600">
          Watch adaptation: benefit statements and solo prompts are original
          rewrites for individual reflection.
        </p>
      </div>
      <div className="mt-5 text-sm" role="status">
        {progressStatus ?? (
          <p>
            Progress is not saved to an account. It lasts while this course is
            open.
          </p>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {renderStory && !story ? (
          <button
            ref={storyButton}
            type="button"
            className={ACTION}
            onClick={() => {
              setRestoreStoryFocus(false)
              setStory(true)
            }}
          >
            Read as story
          </button>
        ) : null}
        <button type="button" className={ACTION} onClick={() => drafts.clear()}>
          Clear reflections
        </button>
      </div>
      <p className="mt-3 text-sm">
        {WATCH_LEARNING_DRAFT_LABEL}. Reflections disappear when this tab
        reloads or closes.
      </p>
      {story && renderStory ? (
        renderStory({
          lesson,
          cards,
          progress: current,
          onProgressChange: change,
          drafts,
          showSheet: () => {
            setRestoreStoryFocus(true)
            setStory(false)
          },
        })
      ) : (
        <WatchGrowLessonSheet
          lesson={lesson}
          cards={cards}
          progress={current}
          onProgressChange={change}
          drafts={drafts}
        />
      )}
      <div
        className="mt-8 flex flex-wrap gap-3"
        role="group"
        aria-label="Lesson navigation"
      >
        <button
          type="button"
          className={ACTION}
          disabled={lesson.n === 1}
          onClick={() => select(LESSONS[lesson.n - 2]!.id)}
        >
          Previous lesson
        </button>
        <button
          type="button"
          className={ACTION}
          disabled={lesson.n === LESSONS.length}
          onClick={() => select(LESSONS[lesson.n]!.id)}
        >
          Next lesson
        </button>
      </div>
      <footer className="mt-8 border-t border-stone-400/40 pt-4 text-sm leading-relaxed">
        <p>
          {BWJ.copyright}. Lesson {lesson.n}, page {lesson.sourcePage}.
        </p>
        <p>
          Guide questions and teaching retain the guide’s wording. Solo rewrites
          are labelled Watch adaptation.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          <a
            className="underline underline-offset-4"
            href={`${BWJ.pdf}#page=${lesson.sourcePage}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Source PDF
          </a>
          <a
            className="underline underline-offset-4"
            href={BWJ.materials}
            target="_blank"
            rel="noopener noreferrer"
          >
            Course source and materials
          </a>
        </div>
      </footer>
    </div>
  )
}

/** Reusable edit view for U10. It owns no dialog, identity or durable persistence. */
export function WatchGrowLessonSheet({
  lesson,
  cards,
  progress,
  onProgressChange,
  drafts,
}: Omit<WatchGrowLessonContext, "showSheet">) {
  function toggle(id: string, checked: boolean) {
    onProgressChange({
      ...progress,
      completedStepIds: checked
        ? [...progress.completedStepIds, id]
        : progress.completedStepIds.filter((step) => step !== id),
    })
  }
  return (
    <div className="mt-8 max-w-prose space-y-8">
      {MOVEMENTS.map((movement) => (
        <section key={movement.id} aria-label={movement.name}>
          <h4 className="text-xl font-semibold">{movement.name}</h4>
          <p className="mt-1 text-sm text-stone-600">
            Watch adaptation: {movement.soloLine}
          </p>
          {movement.id === "up" ? (
            <p className="mt-3 text-sm">
              {lesson.scripture}. {LESSON_STEPS[3]!.group}
            </p>
          ) : null}
          <div className="mt-4 space-y-5">
            {cards
              .filter((card) => card.movementId === movement.id)
              .map((card) => (
                <article
                  key={card.id}
                  data-step-id={card.id}
                  className="border-l-2 border-stone-400/40 pl-4"
                >
                  <h5 className="font-semibold">{card.title}</h5>
                  <p className="mt-2 leading-relaxed">{card.body}</p>
                  {card.source === "watch-adaptation" ? (
                    <p className="mt-2 text-xs text-stone-600">
                      Watch adaptation
                      {card.id.startsWith("up-truth-") && lesson.pointsNote
                        ? `: ${lesson.pointsNote}`
                        : " for individual reflection"}
                      .
                    </p>
                  ) : null}
                  {card.guide ? (
                    <details className="mt-2 text-sm">
                      <summary className="min-h-8 cursor-pointer underline underline-offset-4">
                        Original guide prompt
                      </summary>
                      <p className="mt-2 leading-relaxed">{card.guide}</p>
                    </details>
                  ) : null}
                  {card.id === "up-watch" ? (
                    <Link
                      href={chapterHref(lesson.slug)}
                      prefetch={false}
                      className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-4"
                    >
                      Watch {lesson.segment}
                    </Link>
                  ) : null}
                  {card.reflection ? (
                    <Reflection
                      key={`${lesson.id}-${card.id}`}
                      lesson={lesson}
                      card={card}
                      drafts={drafts}
                    />
                  ) : null}
                  {card.completable ? (
                    <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        className="size-5 accent-red-700"
                        checked={progress.completedStepIds.includes(card.id)}
                        onChange={(event) =>
                          toggle(card.id, event.target.checked)
                        }
                      />
                      Mark {card.title.toLowerCase()} complete
                    </label>
                  ) : null}
                </article>
              ))}
          </div>
        </section>
      ))}
      <section
        aria-label="Finish lesson"
        className="border-t border-stone-400/40 pt-5"
      >
        {lesson.conclusionEnd ? (
          <p className="leading-relaxed">{lesson.conclusionEnd}</p>
        ) : null}
        {lesson.leaderNote ? (
          <details className="mt-3">
            <summary className="min-h-11 cursor-pointer font-semibold">
              Leader’s note from the guide
            </summary>
            <p>{lesson.leaderNote}</p>
          </details>
        ) : null}
        <p className="mt-4 text-sm">
          Moving through the lesson does not mark it complete. Choose when you
          are finished.
        </p>
        <button
          type="button"
          className={`${ACTION} mt-3`}
          onClick={() =>
            onProgressChange({ ...progress, completed: !progress.completed })
          }
        >
          {progress.completed
            ? "Mark lesson incomplete"
            : "Mark lesson complete"}
        </button>
        <p className="mt-2 text-sm" aria-live="polite">
          {progress.completed
            ? "Lesson marked complete in this view."
            : "Lesson not marked complete."}
        </p>
      </section>
    </div>
  )
}

function Reflection({
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
    <div className="mt-3">
      <label htmlFor={id} className="block text-sm font-semibold">
        Your reflection: {card.title}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={3}
        className="mt-2 w-full resize-y rounded-lg border border-stone-400 bg-white/40 p-3 text-base text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
      />
      <p className="mt-1 text-xs text-stone-600">
        {WATCH_LEARNING_DRAFT_LABEL}
      </p>
    </div>
  )
}
