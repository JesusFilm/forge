/**
 * U1: sentence-timing derivation for the Language Centerpiece hop planner (KTD-3/KTD-4).
 *
 * Pure: parsed VTT cues in (already tag-stripped + SMPTE-normalized by parseVtt),
 * sentence-end boundary candidates + dialogue spans out. No I/O, no clock — the seam
 * (sentenceTimingSource.ts) fetches; the planner (hopSchedule.ts) consumes.
 */

import type { VttCue } from "../parseVtt"

/**
 * A sentence that completes at a real pause. `cueEnd` is where speech stopped;
 * `switchTime` biases ~1s later so a drifted dub finishes speaking (R2), capped at the
 * next cue's start when the gap is tighter than the pad; `gap` is the following silence
 * (Infinity at track end).
 */
export type SentenceBoundary = {
  cueEnd: number
  switchTime: number
  gap: number
}

/** A contiguous spoken stretch — the merged union of cue intervals (KTD-4 density input). */
export type DialogueSpan = {
  start: number
  end: number
}

export type SentenceTiming = {
  boundaries: SentenceBoundary[]
  dialogueSpans: DialogueSpan[]
}

/**
 * Minimum inter-cue silence that reads as a sentence pause. Below it, cues butt against
 * each other in rapid dialogue (Birth of Jesus' 00:56–01:01 exchange runs ~0.07–0.15s
 * gaps) and a cut would land mid-exchange even though the cue ends with a period.
 */
export const MIN_SENTENCE_PAUSE_SECONDS = 0.5

/** R2's late bias: switch ~1s past the sentence end so a drifted dub finishes speaking. */
export const SENTENCE_PAD_SECONDS = 1

// Terminal punctuation that closes a sentence in the Latin reference track (KTD-3).
const TERMINAL_PUNCTUATION = new Set([".", "!", "?", "…"])

// Closing wrappers allowed to trail the terminal mark — straight/curly quotes, guillemet,
// brackets, and whitespace — so `."`, `?"`, `…"` still read as sentence ends.
const TRAILING_WRAPPERS = /[\s"'“”‘’»)\]}]+$/

function endsSentence(text: string): boolean {
  const stripped = text.replace(TRAILING_WRAPPERS, "")
  return TERMINAL_PUNCTUATION.has(stripped.slice(-1))
}

function mergeDialogueSpans(sortedCues: readonly VttCue[]): DialogueSpan[] {
  const spans: DialogueSpan[] = []
  for (const cue of sortedCues) {
    const last = spans[spans.length - 1]
    // Touching or overlapping cues fuse into one spoken stretch, so density scoring
    // never double-counts an overlap.
    if (last && cue.start <= last.end) {
      if (cue.end > last.end) last.end = cue.end
    } else {
      spans.push({ start: cue.start, end: cue.end })
    }
  }
  return spans
}

/**
 * Latin-only terminal punctuation + a minimum-pause gate: a cue is a boundary only when
 * it ends a sentence AND the following silence (or track end) clears the pause floor.
 */
export function deriveSentenceTiming(cues: readonly VttCue[]): SentenceTiming {
  const sorted = [...cues].sort((a, b) => a.start - b.start)
  const boundaries: SentenceBoundary[] = []

  for (let i = 0; i < sorted.length; i++) {
    const cue = sorted[i]
    if (!endsSentence(cue.text)) continue

    const next = sorted[i + 1]
    if (!next) {
      // Track end substitutes for the pause (KTD-3): the last sentence completes into
      // no further speech, so the pad is uncapped.
      boundaries.push({
        cueEnd: cue.end,
        switchTime: cue.end + SENTENCE_PAD_SECONDS,
        gap: Infinity,
      })
      continue
    }

    // Overlapping/touching cues (gap <= 0) are never pauses; MIN_PAUSE > 0 already
    // excludes them, so the single `< MIN_PAUSE` gate is the whole rule.
    const gap = next.start - cue.end
    if (gap < MIN_SENTENCE_PAUSE_SECONDS) continue

    boundaries.push({
      cueEnd: cue.end,
      // Cap the pad at the next cue's start so a switch never eats into the next
      // sentence when the pause is shorter than the pad.
      switchTime: Math.min(cue.end + SENTENCE_PAD_SECONDS, next.start),
      gap,
    })
  }

  return { boundaries, dialogueSpans: mergeDialogueSpans(sorted) }
}
