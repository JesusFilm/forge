import type { MusicMood } from "./elevenlabs-music"
import { JESUS_FILM_CHAPTERS } from "./jesus-film-catalog"

/**
 * Clip → Bible-passage table for the video-first pipeline.
 *
 * Each JESUS-film chapter is mapped to the Gospel passage it depicts. The
 * pipeline picks an unused chapter, then this table gives the passage that
 * anchors the scripture AND routes the reflection (see reflection-corpus.ts).
 *
 * IMPORTANT: the JESUS film (1979) follows the Gospel of LUKE, so passages are
 * Luke-primary → reflections come from Matthew Henry's Luke commentary. (Ryle's
 * Matthew volume is for future Matthew-based films, e.g. LUMO.)
 *
 * This is a STARTER subset for the end-to-end slice. Expand to all 61 chapters
 * after review — every entry's passage should be checked for accuracy.
 */

export type ChapterPassage = {
  /** JESUS-film chapter index (1..61), keyed to JESUS_FILM_CHAPTERS. */
  index: number
  /** Canonical passage in osis form (matches reflection-corpus routing). */
  osisRef: string
  /** Human reference, e.g. "Luke 8:22-25". */
  reference: string
  /** Suggested music mood; the writer may override per devotional. */
  mood: MusicMood
  /** Theme keywords — used to theme-match a Spurgeon devotional (which is keyed
   *  to its own verses, not this passage). See reflection-corpus selectReflection. */
  themes: string[]
  /** Curated clip window (s) pointing at the scene's MEANINGFUL moment — the
   *  render trims to this instead of a blind head-slice. Omit → whole clip. */
  clipStartSec?: number
  clipLengthSec?: number
}

export const JESUS_FILM_PASSAGES: ChapterPassage[] = [
  {
    index: 5,
    osisRef: "Luke.4.1-Luke.4.13",
    reference: "Luke 4:1-13",
    mood: "hope",
    themes: ["temptation", "trust", "faith", "obedience", "victory"],
    clipStartSec: 52,
    clipLengthSec: 46,
  }, // The Devil Tempts Jesus. Opens on Jesus "It is written, man shall not live by bread alone" (53.3s), through the kingdoms offer, ends on "him only shall you serve" (~98s). (whisper-verified)
  {
    index: 14,
    osisRef: "Luke.7.36-Luke.7.50",
    reference: "Luke 7:36-50",
    mood: "hope",
    themes: ["forgiveness", "grace", "love", "mercy", "repentance"],
    clipStartSec: 91.5,
    clipLengthSec: 40,
  }, // Sinful Woman Forgiven. Opens on "You see this woman" (~92.4s), ends on "Your sins are forgiven you" (~131s). (whisper-verified)
  {
    index: 19,
    osisRef: "Luke.8.22-Luke.8.25",
    reference: "Luke 8:22-25",
    mood: "peace",
    themes: ["storm", "fear", "peace", "trust", "faith"],
    clipStartSec: 52,
    clipLengthSec: 56,
  }, // Jesus Calms the Storm — storm/panic → disciples' cry → rebuke → calm → "where is your faith?"
  {
    index: 21,
    osisRef: "Luke.9.10-Luke.9.17",
    reference: "Luke 9:10-17",
    mood: "peace",
    themes: ["provision", "compassion", "thanksgiving", "trust", "need"],
    clipStartSec: 94,
    clipLengthSec: 40,
  }, // Jesus Feeds 5,000. Opens on the blessing "Blessed are you O Lord... who brings forth bread from the earth" (95.2s), then the crowd is fed. (whisper-verified; was starting in a ~19s dead-air gap)
  {
    index: 31,
    osisRef: "Luke.10.25-Luke.10.37",
    reference: "Luke 10:25-37",
    mood: "hope",
    themes: ["mercy", "love", "compassion", "kindness", "neighbour"],
    clipStartSec: 36,
    clipLengthSec: 41,
  }, // Good Samaritan. Opens on "a priest came that way" (35.4s), Samaritan cares for the man, ends after "whatever else you spend on him" (~77s, was cut mid-sentence). (whisper-verified)
  {
    index: 33,
    osisRef: "Luke.19.1-Luke.19.10",
    reference: "Luke 19:1-10",
    mood: "hope",
    themes: ["grace", "repentance", "salvation", "seeking", "mercy"],
    clipStartSec: 44,
    clipLengthSec: 48,
  }, // Jesus and Zaccheus. Opens on "He wanted to see Jesus so much that he climbed a tree" (44s), ends after the pledge "pay back four times as much" (~92s). (whisper-verified; was starting mid-sentence)
  {
    index: 55,
    osisRef: "Luke.23.44-Luke.23.49",
    reference: "Luke 23:44-49",
    mood: "lament",
    themes: ["cross", "sacrifice", "redemption", "sorrow", "forgiveness"],
    clipStartSec: 44,
    clipLengthSec: 50,
  }, // Death of Jesus — final words → upward gaze → he bows his head and dies
  {
    index: 59,
    osisRef: "Luke.24.36-Luke.24.49",
    reference: "Luke 24:36-49",
    mood: "awe",
    themes: ["resurrection", "hope", "joy", "peace", "victory"],
    clipStartSec: 30,
    clipLengthSec: 36,
  }, // Resurrected Jesus Appears. Opens on "Peace be with you" (~30s), shows his hands "it is I myself", ends on "these are the very things I spoke to you about" (~66s). (whisper-verified; was starting after "peace be with you" and cutting the commission mid-sentence)
]

const BY_INDEX = new Map(JESUS_FILM_PASSAGES.map((p) => [p.index, p]))

export function passageForChapter(index: number): ChapterPassage | null {
  return BY_INDEX.get(index) ?? null
}

export type ChapterWithPassage = ChapterPassage & {
  id: string
  title: string
}

/** Join a passage entry with its catalog chapter (title + Arclight id). */
export function chapterWithPassage(index: number): ChapterWithPassage | null {
  const passage = BY_INDEX.get(index)
  const chapter = JESUS_FILM_CHAPTERS[index - 1]
  if (!passage || !chapter || chapter.index !== index) return null
  return { ...passage, id: chapter.id, title: chapter.title }
}

/** The chapters that currently have a passage mapping (the pipeline's pool). */
export function mappedChapterIndices(): number[] {
  return JESUS_FILM_PASSAGES.map((p) => p.index)
}
