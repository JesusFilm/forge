/**
 * Reading-time model for the social opening.
 *
 * The beats are DERIVED from the text, not hand-typed: a line arrives when the
 * previous one has almost been read, and a block leaves once its last line has
 * been read plus a breath. Owner's report on the hand-typed version: the second
 * half arrived before she had finished the first, the pair then sat there too
 * long, and the last question was gone before she got to the end of it.
 *
 * Rates. Subtitling practice for adults is ~17 characters per second (Netflix's
 * timed-text spec); text set over moving film on a phone reads a shade slower,
 * so this uses 15. Each line also costs ACQUIRE seconds before reading starts —
 * the eye has to land on it — and no line is ever given less than MIN_SEC.
 */

/** Characters a viewer reads per second. */
export const READ_CPS = 15
/** Time before reading starts on a newly arrived line. */
export const ACQUIRE_SEC = 0.32
/** No line is shown for less than this, however short. */
export const MIN_LINE_SEC = 1.1
/** The next line arrives when this much of the current one has been read. */
export const OVERLAP = 0.82
/** Breath after the last line of a block has been read, before it leaves. */
export const BLOCK_TAIL_SEC = 0.4
/** How long a block takes to fade out, and the gap before the next begins. */
export const BLOCK_FADE_SEC = 0.45
/** The invitation is three words and needs no reading time to speak of. */
export const WATCH_SEC = 1.3

/** Seconds a viewer needs to read `text` once it has arrived. */
export function readSec(text: string): number {
  const chars = text.trim().length
  return Math.max(MIN_LINE_SEC, ACQUIRE_SEC + chars / READ_CPS)
}

export type QuoteIntroTimeline = {
  /** When each half of the quotation arrives. */
  quoteAt: [number, number]
  /** When the quotation starts to leave. */
  quoteOutAt: number
  /** When each question arrives. */
  questionsAt: number[]
  /** When the questions start to leave. */
  questionsOutAt: number
  /** When the invitation arrives. */
  watchAt: number
  /** The card's whole length. */
  totalSec: number
}

/** Lays the opening out from the texts themselves. */
export function quoteIntroTimeline(input: {
  quoteA: string
  quoteB: string
  questions: ReadonlyArray<string>
}): QuoteIntroTimeline {
  const startAt = 0.25
  const aRead = readSec(input.quoteA)
  const bAt = startAt + aRead * OVERLAP
  const bRead = readSec(input.quoteB)
  // Both halves stay up together until the second one has been read: the first
  // is still part of the sentence, so it cannot leave early.
  const quoteOutAt = bAt + bRead + BLOCK_TAIL_SEC
  const listStart = quoteOutAt + BLOCK_FADE_SEC + 0.15
  const questionsAt: number[] = []
  let at = listStart
  input.questions.forEach((q, i) => {
    questionsAt.push(at)
    if (i < input.questions.length - 1) at += readSec(q) * OVERLAP
    else at += readSec(q)
  })
  const questionsOutAt = at + BLOCK_TAIL_SEC
  const watchAt = questionsOutAt + BLOCK_FADE_SEC + 0.15
  return {
    quoteAt: [startAt, bAt],
    quoteOutAt,
    questionsAt,
    questionsOutAt,
    watchAt,
    totalSec: watchAt + WATCH_SEC,
  }
}
