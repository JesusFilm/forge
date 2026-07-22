import { wrapText } from "./video-assembler"
import type { Devotional } from "./types"

/**
 * Segment-driven model for a synced devotional video (Option A).
 *
 * Each segment is exactly ONE card: `lines` is what's shown, `spokenText` is
 * what the narrator reads. The video pipeline synthesizes one audio snippet per
 * segment and times each card to its own snippet — so the picture can never
 * drift from the voice (sync is guaranteed, not estimated).
 *
 * Splitting happens only at sentence/paragraph boundaries (natural pause
 * points), so independently-synthesized snippets still sound continuous, and
 * the same Azure voice keeps a consistent timbre across all of them.
 */

const REFLECTION_CHARS_PER_CARD = 320

export type DevotionalSegmentKind =
  | "hook"
  | "scripture"
  | "reflection"
  | "questions"

export type DevotionalSegment = {
  kind: DevotionalSegmentKind
  /** Pre-wrapped display lines for the card. */
  lines: string[]
  /** Text the narrator speaks for this card (drives the snippet's duration). */
  spokenText: string
}

/** Split prose into card-sized chunks at sentence boundaries. */
function chunkReflection(
  text: string,
  perCard = REFLECTION_CHARS_PER_CARD,
): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let cur = ""
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > perCard) {
      chunks.push(cur)
      cur = s
    } else {
      cur = cur ? `${cur} ${s}` : s
    }
  }
  if (cur) chunks.push(cur)
  return chunks.length ? chunks : [text]
}

export function buildDevotionalSegments(
  devotional: Devotional,
): DevotionalSegment[] {
  const segments: DevotionalSegment[] = []

  segments.push({
    kind: "hook",
    lines: wrapText(devotional.hook.title, 22),
    spokenText: `${devotional.hook.title}. ${devotional.hook.summary}`.trim(),
  })

  segments.push({
    kind: "scripture",
    lines: [
      ...wrapText(`"${devotional.scripture.text}"`, 30),
      "",
      `— ${devotional.scripture.reference}`,
    ],
    spokenText: `${devotional.scripture.reference}. ${devotional.scripture.text}`,
  })

  for (const chunk of chunkReflection(devotional.reflection)) {
    segments.push({
      kind: "reflection",
      lines: wrapText(chunk, 34),
      spokenText: chunk,
    })
  }

  if (devotional.questions.length) {
    segments.push({
      kind: "questions",
      lines: devotional.questions.flatMap((q) => [
        ...wrapText(`• ${q}`, 32),
        "",
      ]),
      // Narrated for the video so the closing card stays in sync (the audio-only
      // narration still omits questions — see voiceover.buildNarrationText).
      spokenText: `Take a moment to reflect. ${devotional.questions.join(" ")}`,
    })
  }

  return segments
}

export const _internal = { chunkReflection }
