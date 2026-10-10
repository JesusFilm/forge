// SYNC: ported from apps/tv/src/lib/showcaseMode/sentenceTiming.ts, plus mobile
// additions (KTD5): terminators for more scripts, invisible direction marks,
// sentence starts, long pauses, and the cue cap. No Intl.Segmenter: Hermes lacks it.

import type { VttCue } from "../parseVtt"

/**
 * A sentence end. `switchTime` is ~1 s later so a drifted dub finishes speaking,
 * capped at the next cue's start. `gap` is the silence after it (Infinity at track end).
 */
export type SentenceBoundary = {
  cueEnd: number
  switchTime: number
  gap: number
}

/** A contiguous spoken stretch: the merged union of cue intervals. */
export type DialogueSpan = {
  start: number
  end: number
}

export type SentenceTiming = {
  boundaries: SentenceBoundary[]
  dialogueSpans: DialogueSpan[]
}

/** Below this silence, cues butt against each other in rapid dialogue. */
export const MIN_SENTENCE_PAUSE_SECONDS = 0.5

/** The late bias past a sentence end, so a drifted dub finishes speaking. */
export const SENTENCE_PAD_SECONDS = 1

/**
 * R27's long pause. It must hold the pad plus a 0.25 s player tick; on real
 * tracks, silences from 1.5 s follow a sentence end 85–90% of the time.
 */
export const LONG_PAUSE_SECONDS = 1.5

/** KTD5: a longer track fails the timing check, so no work scales past it. */
export const MAX_TIMING_CUES = 8000

// Latin, CJK, Devanagari, Arabic and Urdu, Myanmar, Ethiopic, and Armenian.
const TERMINAL_PUNCTUATION = new Set([
  ".",
  "!",
  "?",
  "…",
  "。",
  "！",
  "？",
  "।",
  "॥",
  "؟",
  "۔",
  "။",
  "።",
  "։",
])

// Closing quotes and brackets may trail the terminal mark: `."` still ends one.
// Real Arabic tracks also wrap the period in invisible direction marks.
const TRAILING_WRAPPERS =
  /[\s"'“”‘’«»)\]}」』）》〉】〕\u200b-\u200f\u061c\u202a-\u202e\u2066-\u2069]+$/

export function endsSentence(text: string): boolean {
  const stripped = text.replace(TRAILING_WRAPPERS, "")
  return TERMINAL_PUNCTUATION.has(stripped.slice(-1))
}

function mergeDialogueSpans(sortedCues: readonly VttCue[]): DialogueSpan[] {
  const spans: DialogueSpan[] = []
  for (const cue of sortedCues) {
    const last = spans[spans.length - 1]
    // Touching or overlapping cues fuse, so density never counts an overlap twice.
    if (last && cue.start <= last.end) {
      if (cue.end > last.end) last.end = cue.end
    } else {
      spans.push({ start: cue.start, end: cue.end })
    }
  }
  return spans
}

/** TV's pause-gated boundaries: a sentence end that a real silence follows. */
export function deriveSentenceTiming(cues: readonly VttCue[]): SentenceTiming {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  const boundaries: SentenceBoundary[] = []

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i]
    if (!endsSentence(cue.text)) continue

    const next = sorted[i + 1]
    if (!next) {
      // The track end stands in for the pause, so the pad is uncapped.
      boundaries.push({
        cueEnd: cue.end,
        switchTime: cue.end + SENTENCE_PAD_SECONDS,
        gap: Infinity,
      })
      continue
    }

    const gap = next.start - cue.end
    if (gap < MIN_SENTENCE_PAUSE_SECONDS) continue

    boundaries.push({
      cueEnd: cue.end,
      // The switch never eats into the next sentence.
      switchTime: Math.min(cue.end + SENTENCE_PAD_SECONDS, next.start),
      gap,
    })
  }

  return { boundaries, dialogueSpans: mergeDialogueSpans(sorted) }
}

/** A cue after a sentence end that starts clear of earlier speech (R26). */
export type SentenceStart = {
  time: number
  /** The first cue, or a cue after at least 0.5 s of silence. */
  preferred: boolean
}

/** A sentence end that no other speech overlaps (R27). */
export type SentenceEnd = SentenceBoundary & { longPause: boolean }

export type ClipTiming = {
  cueCount: number
  /** Every cue whose text ends a sentence, for the 20% track check. */
  sentenceEndCount: number
  lastCueEnd: number
  /** In time order. */
  starts: SentenceStart[]
  /** In time order: `cueEnd` and `switchTime` never decrease. */
  ends: SentenceEnd[]
}

/** The R26–R27 inputs of one track, or null over the cue cap. */
export function deriveClipTiming(cues: readonly VttCue[]): ClipTiming | null {
  if (cues.length > MAX_TIMING_CUES) return null
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  const starts: SentenceStart[] = []
  const ends: SentenceEnd[] = []
  let sentenceEndCount = 0
  // The latest end of all earlier speech. The track start counts as a sentence end.
  let spokenUntil = -Infinity
  let afterSentenceEnd = true

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i]
    const silenceBefore = cue.start - spokenUntil
    if (afterSentenceEnd && silenceBefore >= 0) {
      starts.push({
        time: cue.start,
        preferred: silenceBefore >= MIN_SENTENCE_PAUSE_SECONDS,
      })
    }

    const endsHere = endsSentence(cue.text)
    if (endsHere) sentenceEndCount++
    const next = sorted[i + 1]
    const gap = next ? next.start - cue.end : Infinity
    // A clip must not end while an earlier line still runs or the next line has begun.
    if (endsHere && gap >= 0 && cue.end >= spokenUntil) {
      const padded = cue.end + SENTENCE_PAD_SECONDS
      ends.push({
        cueEnd: cue.end,
        switchTime: next ? Math.min(padded, next.start) : padded,
        gap,
        longPause: gap >= LONG_PAUSE_SECONDS,
      })
    }

    afterSentenceEnd = endsHere
    if (cue.end > spokenUntil) spokenUntil = cue.end
  }

  return {
    cueCount: sorted.length,
    sentenceEndCount,
    lastCueEnd: sorted.length > 0 ? spokenUntil : 0,
    starts,
    ends,
  }
}
