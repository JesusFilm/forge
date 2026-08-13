import { z } from "zod"

import type { MusicMood } from "./elevenlabs-music"
import type { DevotionalVoiceName } from "./elevenlabs-voiceover"
import type { DevotionalLlm } from "./llm"
import { hookStyleForSequence, writeDevotionalCopy } from "./devotional-copy"
import { selectScriptureForPassage } from "./passage-scripture"
import {
  matchReflection,
  selectReflection,
  shortlistSpurgeonByTheme,
  type ReflectionCorpora,
  type ReflectionFlavor,
} from "./reflection-corpus"
import {
  chapterWithPassage,
  type ChapterPassage,
  type ChapterWithPassage,
} from "./jesus-film-passages"
import type { JesusFilmChapter } from "./jesus-film-catalog"
import { modernizeReflection } from "./reflection-modernizer"
import { pickReflectionHighlights } from "./reflection-highlighter"
import { splitReflection } from "./reflection-split"
import { pickBestSpurgeon } from "./spurgeon-ranker"
import { rotateVoice } from "./voice-rotation"
import type { Devotional, ScriptureRef } from "./types"

/**
 * Video-FIRST devotional generation core (content only — no audio render/publish).
 *
 * Pipeline: clip (a JESUS-film chapter with a mapped passage) → scripture from
 * that passage → reflection (rotate commentary/Spurgeon by sequence, then
 * light-touch modernize) → short copy (title + one practical question + short
 * prayer). Also carries the rotated narration voice and the scene's music mood
 * so the downstream produce/render step knows what to use.
 *
 * Pure orchestration with injectable seams (each defaults to the real service),
 * mirroring `runDailyDevotional`. Throws on a hard failure; the Mastra wrapper
 * maps that to a typed workflow result.
 */

/**
 * Remove em/en dashes from generated copy (owner rule: they read as AI). Each
 * dash becomes a comma so the sentence's pause is preserved, then the spacing
 * and doubled punctuation are tidied. Applied to titles/reflection/conclusion/
 * question/prayer — never to scripture (exact verse text).
 */
export function stripDashes(text: string): string {
  return text
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,(\s*[.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim()
}

export type GeneratedDevotional = {
  date: string
  clip: { index: number; id: string; title: string }
  passage: {
    reference: string
    osisRef: string
    clipStartSec?: number
    clipLengthSec?: number
  }
  /** Short cover/hook line. */
  title: string
  scripture: ScriptureRef
  reflection: {
    text: string
    /** Original source, e.g. "Matthew Henry, Commentary on the Whole Bible". */
    source: string
    /** "Adapted from <source>" — light modernization applied, not a verbatim quote. */
    attribution: string
    /** Which rotation flavor produced it. */
    flavor: ReflectionFlavor
    /** The raw excerpt handed to the modernizer, kept for provenance so a
     *  fidelity critic (or a human) can compare `text` against what the author
     *  actually wrote. Optional: older cached devos predate this field, and a
     *  localized/translated copy doesn't re-derive it. */
    sourceExcerpt?: string
  }
  /** One phrase to accent per reflection chunk (verbatim substring, or ""),
   *  aligned with splitReflection(reflection.text). */
  reflectionHighlights: string[]
  /** Short closing takeaway line (shown on the conclusion card). */
  conclusion: string
  question: string
  prayer: string
  /** Music mood for the bed (produce step generates it). */
  mood: MusicMood
  /** Narration voice (rotates D→E→C by sequence). */
  voice: DevotionalVoiceName
  sequence: number
}

/** Zod schema mirroring GeneratedDevotional, for crossing Mastra step boundaries. */
export const GeneratedDevotionalSchema = z.object({
  date: z.string(),
  clip: z.object({ index: z.number(), id: z.string(), title: z.string() }),
  passage: z.object({
    reference: z.string(),
    osisRef: z.string(),
    clipStartSec: z.number().nonnegative().optional(),
    clipLengthSec: z.number().positive().optional(),
  }),
  title: z.string(),
  scripture: z.object({
    reference: z.string(),
    text: z.string(),
    translation: z.string().nullable(),
    needsCanonicalSource: z.boolean(),
  }),
  reflection: z.object({
    text: z.string(),
    source: z.string(),
    attribution: z.string(),
    flavor: z.enum(["commentary", "spurgeon"]),
    sourceExcerpt: z.string().optional(),
  }),
  reflectionHighlights: z.array(z.string()),
  conclusion: z.string(),
  question: z.string(),
  prayer: z.string(),
  mood: z.enum(["peace", "hope", "lament", "awe"]),
  voice: z.string().min(1),
  sequence: z.number(),
}) satisfies z.ZodType<GeneratedDevotional>

export type GenerateDevotionalDeps = {
  chapters: readonly JesusFilmChapter[]
  passages: readonly ChapterPassage[]
  corpora: ReflectionCorpora
  hookStyles: readonly string[]
  voiceRotation: readonly DevotionalVoiceName[]
  selectScripture?: typeof selectScriptureForPassage
  modernize?: typeof modernizeReflection
  writeCopy?: typeof writeDevotionalCopy
  /** LLM re-ranker for the Spurgeon shortlist (defaults to the real one). */
  pickSpurgeon?: typeof pickBestSpurgeon
  /** Picks the accent phrase per reflection chunk (defaults to the real one). */
  pickHighlights?: typeof pickReflectionHighlights
}

export type GenerateDevotionalInput = {
  /** JESUS-film chapter index (must have a passage mapping). */
  chapterIndex: number
  /** Monotonic counter driving voice + reflection-source rotation. */
  sequence: number
  /** YYYY-MM-DD. */
  date: string
  llm: DevotionalLlm
  /** Words for the spoken reflection (~30–45s). */
  approxWords?: number
}

export async function generateDevotional(
  input: GenerateDevotionalInput,
  deps: GenerateDevotionalDeps,
): Promise<GeneratedDevotional> {
  const sourced = await sourceClipAndScripture(
    { chapterIndex: input.chapterIndex, llm: input.llm },
    deps,
  )
  return composeDevotionalContent(
    {
      chapter: sourced.chapter,
      scripture: sourced.scripture,
      sequence: input.sequence,
      date: input.date,
      llm: input.llm,
      approxWords: input.approxWords,
    },
    deps,
  )
}

// ---- Stage 1: SOURCE — the clip's passage anchors the scripture -------------

export type SourcedDevotional = {
  chapter: ChapterWithPassage
  scripture: ScriptureRef
}

export async function sourceClipAndScripture(
  input: { chapterIndex: number; llm: DevotionalLlm },
  deps: GenerateDevotionalDeps,
): Promise<SourcedDevotional> {
  const chapter = chapterWithPassage(
    input.chapterIndex,
    deps.passages,
    deps.chapters,
  )
  if (!chapter) {
    throw new Error(`no passage mapping for chapter ${input.chapterIndex}`)
  }
  const selectScripture = deps.selectScripture ?? selectScriptureForPassage
  const scripture = await selectScripture({
    reference: chapter.reference,
    llm: input.llm,
  })
  return { chapter, scripture }
}

// ---- Stage 2: CONTENT — reflection, highlights, copy -------------------------

export type ComposeContentInput = {
  chapter: ChapterWithPassage
  scripture: ScriptureRef
  /** Monotonic counter driving voice + reflection-source rotation. */
  sequence: number
  /** YYYY-MM-DD. */
  date: string
  llm: DevotionalLlm
  /** Words for the spoken reflection (~60–75s). */
  approxWords?: number
}

export async function composeDevotionalContent(
  input: ComposeContentInput,
  deps: GenerateDevotionalDeps,
): Promise<GeneratedDevotional> {
  const { chapter, scripture } = input
  const corpora = deps.corpora
  const modernize = deps.modernize ?? modernizeReflection
  const writeCopy = deps.writeCopy ?? writeDevotionalCopy
  const pickSpurgeon = deps.pickSpurgeon ?? pickBestSpurgeon
  const pickHighlights = deps.pickHighlights ?? pickReflectionHighlights

  let selection = selectReflection(
    {
      passageOsis: chapter.osisRef,
      reference: chapter.reference,
      themes: chapter.themes,
      sequence: input.sequence,
    },
    corpora,
  )
  if (!selection) {
    throw new Error(`no reflection source for ${chapter.osisRef}`)
  }

  // For the Spurgeon flavor, upgrade the keyword pick with an LLM rank over the
  // shortlist. The ranker returns null when NOTHING genuinely fits the scene —
  // in that case fall back to on-passage commentary (quality over rotation).
  if (selection.flavor === "spurgeon") {
    const shortlist = shortlistSpurgeonByTheme(chapter.themes, corpora.spurgeon)
    const best = await pickSpurgeon({
      sceneTitle: chapter.title,
      reference: chapter.reference,
      candidates: shortlist,
      llm: input.llm,
    })
    if (best) {
      selection = {
        flavor: "spurgeon",
        source: best.source,
        reference: best.reference,
        osisRef: best.osisRef,
        text: best.text,
        focusReference: best.reference,
      }
    } else {
      const commentary = matchReflection(chapter.osisRef, corpora)
      if (commentary) {
        selection = {
          ...commentary,
          flavor: "commentary",
          focusReference: chapter.reference,
        }
      }
      // else: no commentary either (non-Gospel) → keep the keyword selection.
    }
  }

  const modern = await modernize({
    sourceText: selection.text,
    focusReference: selection.focusReference,
    sourceName: selection.source,
    approxWords: input.approxWords ?? 170,
    llm: input.llm,
  })
  // Owner rule: NO em/en dashes in generated copy (reads as AI). Agents are
  // instructed to avoid them; this is the safety net. Sanitize the reflection
  // BEFORE picking highlights so the verbatim accent phrases match the final
  // text. Scripture is an exact WEB verse and is left untouched.
  const reflectionText = stripDashes(modern.adapted)

  const copy = await writeCopy({
    sceneTitle: chapter.title,
    reference: scripture.reference,
    scriptureText: scripture.text,
    reflection: reflectionText,
    // Rotate the cover-hook form by sequence so openings vary (not always a
    // question / "What if...").
    hookStyle: hookStyleForSequence(input.sequence, deps.hookStyles),
    llm: input.llm,
  })

  // One accent phrase per reflection chunk (verbatim), aligned with the split.
  const reflectionHighlights = await pickHighlights({
    chunks: splitReflection(reflectionText),
    llm: input.llm,
  })

  return {
    date: input.date,
    clip: { index: chapter.index, id: chapter.id, title: chapter.title },
    passage: {
      reference: chapter.reference,
      osisRef: chapter.osisRef,
      ...(chapter.clipStartSec != null
        ? { clipStartSec: chapter.clipStartSec }
        : {}),
      ...(chapter.clipLengthSec != null
        ? { clipLengthSec: chapter.clipLengthSec }
        : {}),
    },
    title: stripDashes(copy.title),
    scripture,
    reflection: {
      text: reflectionText,
      source: selection.source,
      attribution: modern.attribution,
      flavor: selection.flavor,
    },
    reflectionHighlights,
    conclusion: stripDashes(copy.conclusion),
    question: stripDashes(copy.question),
    prayer: stripDashes(copy.prayer),
    mood: chapter.mood,
    voice: rotateVoice(input.sequence, deps.voiceRotation),
    sequence: input.sequence,
  }
}

/**
 * Map the video-first devotional onto the legacy `Devotional` shape the safety
 * gate scores (hook = cover hook, summary = conclusion, single question). Used
 * by the Content sub-workflow's safety step and the parity scripts.
 */
export function toLegacyDevotional(d: GeneratedDevotional): Devotional {
  return {
    date: d.date,
    hook: {
      type: "question",
      title: d.title,
      summary: d.conclusion,
      sourceUrl: null,
    },
    scripture: d.scripture,
    video: {
      videoId: d.clip.id,
      title: d.clip.title,
      url: d.clip.id,
      thumbnailUrl: null,
    },
    videoMatch: "search",
    reflection: d.reflection.text,
    questions: [d.question],
    // Carry the prayer so the safety gate scores it — it is narrated + rendered.
    prayer: d.prayer,
    furtherReading: null,
    blockOrder: ["hook", "scripture", "video", "reflection", "questions"],
  }
}
