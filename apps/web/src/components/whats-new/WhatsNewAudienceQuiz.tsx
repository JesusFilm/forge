"use client"

import { useId, useState, type FormEvent } from "react"
import { Sparkles } from "lucide-react"

import { WHATS_NEW_QUIZ } from "@/components/whats-new/whats-new-content"

const { actualPercent } = WHATS_NEW_QUIZ

function verdict(guess: number): string {
  if (guess > actualPercent * 2) {
    return WHATS_NEW_QUIZ.overGuess.replace(
      "{factor}",
      String(Math.round(guess / actualPercent)),
    )
  }
  if (guess < actualPercent) return WHATS_NEW_QUIZ.underGuess
  return WHATS_NEW_QUIZ.closeGuess
}

/**
 * Guess-the-number opener for the audiences section.
 *
 * The reveal is the whole point, so it is deliberately a two-step: the
 * reader commits to a number before seeing the answer. Submitting is a
 * real form submit, so Enter works from the slider without a keydown
 * handler, and the result is announced through `role="status"` rather
 * than only being visible.
 */
export function WhatsNewAudienceQuiz({
  /**
   * Outer spacing, supplied by the caller. The quiz used to close the
   * audiences section on its own and owned its top margin; it now sits in
   * the right-hand column of the estimate stage, where a top margin would
   * knock it out of line with the card beside it.
   */
  className = "mt-12 lg:mt-16",
}: {
  className?: string
} = {}) {
  const sliderId = useId()
  const [guess, setGuess] = useState(30)
  const [submitted, setSubmitted] = useState<number | null>(null)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitted(guess)
  }

  return (
    /* No box: no frame, no fill, no padding of its own.

       It used to be a bordered, gradient-filled, blurred card, which made
       sense while it was a full-width band closing the section. Beside the
       audience card it read as a second card competing with the one the
       question is about — two boxes of equal weight, only one of which is
       the subject. Bare, the question reads as the page asking it. */
    <div data-testid="whats-new-quiz" className={className}>
      <p className="text-[0.6875rem] font-semibold tracking-[0.28em] text-red-100/70 uppercase">
        {WHATS_NEW_QUIZ.eyebrow}
      </p>

      <form onSubmit={handleSubmit} className="mt-5">
        <label
          htmlFor={sliderId}
          className="block max-w-2xl text-xl leading-snug font-semibold tracking-[-0.01em] text-balance text-white sm:text-2xl lg:text-3xl"
        >
          {WHATS_NEW_QUIZ.question}
        </label>
        <p className="mt-3 text-sm text-white/60">{WHATS_NEW_QUIZ.helper}</p>

        <div className="mt-8 flex max-w-2xl items-center gap-5">
          <input
            id={sliderId}
            data-testid="whats-new-quiz-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={guess}
            onChange={(event) => setGuess(Number(event.target.value))}
            aria-label={WHATS_NEW_QUIZ.sliderLabel}
            aria-valuetext={`${guess}%`}
            className="watch-quiz-slider min-w-0 flex-1"
          />
          <output
            htmlFor={sliderId}
            data-testid="whats-new-quiz-value"
            className="w-[4.5ch] shrink-0 text-right text-2xl font-semibold text-white tabular-nums sm:text-3xl"
          >
            {guess}%
          </output>
        </div>

        {submitted === null ? (
          <button
            type="submit"
            data-testid="whats-new-quiz-submit"
            className="mt-8 inline-flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-bold tracking-wider text-black uppercase transition-colors duration-200 hover:bg-brand-red hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            <Sparkles aria-hidden className="size-4" />
            {WHATS_NEW_QUIZ.submit}
          </button>
        ) : null}
      </form>

      {submitted !== null ? (
        <div
          role="status"
          data-testid="whats-new-quiz-reveal"
          className="mt-10 border-t border-white/12 pt-8"
        >
          <div className="grid gap-5 sm:max-w-2xl">
            <Bar
              label={`${WHATS_NEW_QUIZ.guessLabel} — ${submitted}%`}
              percent={submitted}
              tone="guess"
            />
            <Bar
              label={`${WHATS_NEW_QUIZ.actualLabel} — ${actualPercent}%`}
              percent={actualPercent}
              tone="actual"
              delay
            />
          </div>

          <p
            data-testid="whats-new-quiz-verdict"
            className="mt-6 text-sm font-semibold tracking-wide text-red-100/80"
          >
            {verdict(submitted)}
          </p>

          <h3 className="mt-8 text-3xl font-semibold tracking-[-0.02em] text-white sm:text-4xl">
            {WHATS_NEW_QUIZ.revealHeading}
          </h3>
          <p className="mt-4 max-w-3xl text-base leading-8 text-white/80 sm:text-lg">
            {WHATS_NEW_QUIZ.revealBody}
          </p>
          <p className="mt-4 max-w-3xl text-base leading-8 text-white/80 sm:text-lg">
            {WHATS_NEW_QUIZ.revealPartners}
          </p>

          <button
            type="button"
            data-testid="whats-new-quiz-reset"
            onClick={() => setSubmitted(null)}
            className="mt-7 cursor-pointer text-xs font-semibold tracking-[0.18em] text-white/60 uppercase underline decoration-white/25 underline-offset-4 transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            {WHATS_NEW_QUIZ.dismiss}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Bar({
  label,
  percent,
  tone,
  delay,
}: {
  label: string
  percent: number
  tone: "guess" | "actual"
  delay?: boolean
}) {
  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.18em] text-white/65 uppercase tabular-nums">
        {label}
      </p>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/8">
        <div
          data-testid={`whats-new-quiz-bar-${tone}`}
          // Width is the value; the fill is animated with scaleX so the
          // reveal runs on the compositor and needs no mount-frame trick.
          style={{ width: `${Math.max(percent, 1)}%` }}
          className={`watch-quiz-bar h-full rounded-full ${
            delay ? "watch-quiz-bar-late" : ""
          } ${
            tone === "actual"
              ? "bg-gradient-to-r from-red-300 to-brand-red"
              : "bg-white/35"
          }`}
        />
      </div>
    </div>
  )
}
