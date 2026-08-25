import { z } from "zod"

import type { MusicMood } from "./elevenlabs-music"
import type { DevotionalVoiceName } from "./elevenlabs-voiceover"
import type { DevotionalAgentLlms } from "./devotional-models"
import type { DevotionalLlm } from "./llm"
import { hookStyleForSequence, writeDevotionalCopy } from "./devotional-copy"
import { writeDevotionalConclusion } from "./devotional-conclusion"
import { selectScriptureForPassage } from "./passage-scripture"
import {
  loadReflectionCorpora,
  matchReflection,
  selectReflection,
  shortlistSpurgeonByTheme,
  type CommentaryPreference,
  type ReflectionCorpora,
  type ReflectionFlavor,
  type ReflectionSelection,
} from "./reflection-corpus"
import {
  chapterWithPassage,
  type ChapterWithPassage,
} from "./jesus-film-passages"
import { modernizeReflection } from "./reflection-modernizer"
import { pickReflectionPoints } from "./reflection-point-picker"
import { commentaryPreamble, splitCommentaryPoints } from "./reflection-points"
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
  passage: { reference: string; osisRef: string }
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
    /** TWO-ACT LAYOUT: the reflection written as one half per commentary
     *  point, in order. `text` is their concatenation. When present (and the
     *  clip has an act break) the manifest shows video act 1, then the first
     *  half, then video act 2, then the second half — so each half comments
     *  on what the viewer has just watched. */
    parts?: string[]
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
  passage: z.object({ reference: z.string(), osisRef: z.string() }),
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
    parts: z.array(z.string()).optional(),
  }),
  reflectionHighlights: z.array(z.string()),
  conclusion: z.string(),
  question: z.string(),
  prayer: z.string(),
  mood: z.enum(["peace", "hope", "lament", "awe"]),
  voice: z.enum(["male-d", "male-e", "female-c", "russian"]),
  sequence: z.number(),
}) satisfies z.ZodType<GeneratedDevotional>

/**
 * No ingested commentary covers this chapter's passage.
 *
 * The corpora are Ryle on Matthew/Luke and Matthew Henry on Mark/John, so a
 * JESUS-film chapter outside the Gospels (the film's opening draws on GENESIS
 * creation material) has nothing to adapt. Typed so callers can react —
 * `render-daily-devotional.ts` filters its pool with `hasReflectionSource`
 * so it never picks one, but an explicit `--chapter=N` can still land here.
 */
export class NoReflectionSourceError extends Error {
  readonly code = "no_reflection_source"
  constructor(
    readonly osisRef: string,
    readonly chapterIndex: number,
  ) {
    super(
      `no reflection source for ch${chapterIndex} (${osisRef}) — the ingested ` +
        `corpora cover the four Gospels only. Pick a Gospel-based chapter, or ` +
        `ingest a commentary that covers this passage.`,
    )
    this.name = "NoReflectionSourceError"
  }
}

export type GenerateDevotionalDeps = {
  corpora?: ReflectionCorpora
  selectScripture?: typeof selectScriptureForPassage
  modernize?: typeof modernizeReflection
  /** Narrows a multi-point commentary to the 1–2 points that fit the verse. */
  pickPoints?: typeof pickReflectionPoints
  writeCopy?: typeof writeDevotionalCopy
  /** Runs AFTER writeCopy — sees the reflection + the chosen title/question/
   *  prayer, returns just the conclusion (defaults to the real one). */
  writeConclusion?: typeof writeDevotionalConclusion
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
  /** Fallback LLM for every content seam that has no per-agent override. */
  llm: DevotionalLlm
  /** Per-agent models (scripture/spurgeon/modernize/copy/highlights). Each seam
   *  uses its entry when present, else `llm`. See devotional-models.ts. */
  llms?: DevotionalAgentLlms
  /** Words for the spoken reflection (~30–45s). */
  approxWords?: number
  /** Optional progress logger (which commentary points were chosen, etc.). */
  log?: (msg: string) => void
  /** 1-based beat of a scene that defines `episodes` — a standalone devotional
   *  over part of the scene, with its own window and its own verse. */
  episode?: number
  /** Read the scene with this commentator for this run only, ignoring the
   *  passage table. For comparing readings before committing to one. */
  commentaryOverride?: CommentaryPreference
}

export async function generateDevotional(
  input: GenerateDevotionalInput,
  deps: GenerateDevotionalDeps = {},
): Promise<GeneratedDevotional> {
  const sourced = await sourceClipAndScripture(
    {
      chapterIndex: input.chapterIndex,
      llm: input.llm,
      llms: input.llms,
      episode: input.episode,
      commentaryOverride: input.commentaryOverride,
    },
    deps,
  )
  return composeDevotionalContent(
    {
      chapter: sourced.chapter,
      scripture: sourced.scripture,
      sequence: input.sequence,
      date: input.date,
      llm: input.llm,
      llms: input.llms,
      approxWords: input.approxWords,
      log: input.log,
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
  input: {
    chapterIndex: number
    llm: DevotionalLlm
    llms?: DevotionalAgentLlms
    /** Narrow to one beat of the scene — see ChapterPassage.episodes. */
    episode?: number
    commentaryOverride?: CommentaryPreference
  },
  deps: GenerateDevotionalDeps = {},
): Promise<SourcedDevotional> {
  const chapter = chapterWithPassage(input.chapterIndex, input.episode)
  if (!chapter) {
    throw new Error(`no passage mapping for chapter ${input.chapterIndex}`)
  }
  const selectScripture = deps.selectScripture ?? selectScriptureForPassage
  const scripture = await selectScripture({
    reference: chapter.reference,
    llm: input.llms?.scripture ?? input.llm,
  })
  return {
    chapter: input.commentaryOverride
      ? { ...chapter, commentary: input.commentaryOverride }
      : chapter,
    scripture,
  }
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
  /** Per-agent models; each seam uses its entry when present, else `llm`. */
  llms?: DevotionalAgentLlms
  /** Words for the spoken reflection (~60–75s). */
  approxWords?: number
  /** Optional progress logger (which commentary points were chosen, etc.). */
  log?: (msg: string) => void
}

export async function composeDevotionalContent(
  input: ComposeContentInput,
  deps: GenerateDevotionalDeps = {},
): Promise<GeneratedDevotional> {
  const { chapter, scripture } = input
  const corpora = deps.corpora ?? loadReflectionCorpora()
  const modernize = deps.modernize ?? modernizeReflection
  const pickPoints = deps.pickPoints ?? pickReflectionPoints
  const writeCopy = deps.writeCopy ?? writeDevotionalCopy
  const writeConclusion = deps.writeConclusion ?? writeDevotionalConclusion
  const pickSpurgeon = deps.pickSpurgeon ?? pickBestSpurgeon
  const pickHighlights = deps.pickHighlights ?? pickReflectionHighlights

  // SOURCE SELECTION — the reflection MUST be about the scene the viewer watches
  // (owner: "it must match the Bible quote"). Matthew Henry's commentary is bound
  // to the passage, so it is always on-scene. Spurgeon's Morning & Evening entries
  // are THEMATIC (keyed to his own verses), so for a narrative clip they reliably
  // DRIFT from what's on screen — the coherence agent caught this twice on the
  // feeding (a "trust vs scheming" and a "daily bread / no surplus" sermon that
  // even contradicted the twelve baskets). So: on-passage commentary FIRST; use
  // Spurgeon only when there is no commentary for the passage (non-narrative).
  // Depth on thin commentary comes from the sharpened modernizer, not a drifting
  // source. (A per-scene coherence gate could re-enable Spurgeon where it truly
  // fits; kept out for now to guarantee matching.)
  let selection: ReflectionSelection | null = null
  const commentary = matchReflection(
    chapter.osisRef,
    corpora,
    chapter.commentary,
  )
  if (commentary) {
    selection = {
      ...commentary,
      flavor: "commentary",
      focusReference: chapter.reference,
    }
  }
  if (!selection) {
    const spurgeonShortlist = shortlistSpurgeonByTheme(
      chapter.themes,
      corpora.spurgeon,
    )
    if (spurgeonShortlist.length > 0) {
      const best = await pickSpurgeon({
        sceneTitle: chapter.title,
        reference: chapter.reference,
        candidates: spurgeonShortlist,
        llm: input.llms?.spurgeon ?? input.llm,
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
      }
    }
  }
  if (!selection) {
    selection = selectReflection(
      {
        passageOsis: chapter.osisRef,
        reference: chapter.reference,
        themes: chapter.themes,
        sequence: input.sequence,
        ...(chapter.commentary ? { commentary: chapter.commentary } : {}),
      },
      corpora,
    )
  }
  if (!selection) {
    throw new NoReflectionSourceError(chapter.osisRef, chapter.index)
  }

  // Narrow a multi-point commentary to the 1–2 points that fit the verse
  // BEFORE the writer sees it, so selection is enforced by what data reaches
  // the writer rather than by an instruction it can drift from. Excerpts with
  // no ordinal structure (roughly a fifth of the corpus) pass through whole.
  const allPoints = splitCommentaryPoints(selection.text)
  let focusedSource = selection.text
  /** One entry per chosen point, in order — set only when the chapter asks
   *  for the two-act layout, so the manifest can interleave each half with
   *  the act of the clip it comments on. */
  let keptPoints: { index: number; text: string }[] = []
  if (allPoints.length >= 3) {
    const { chosen, reason } = await pickPoints({
      points: allPoints,
      sceneTitle: chapter.title,
      ...(chapter.episodeNote ? { sceneNote: chapter.episodeNote } : {}),
      scriptureReference: scripture.reference,
      scriptureText: scripture.text,
      approxWords: input.approxWords ?? 170,
      llm: input.llms?.pointPicker ?? input.llm,
    })
    // Keep the picker's ORDER, not the author's numbering.
    //
    // The picker is asked to build an arc — what Christ does, then what that
    // means for the believer — and to put the lifting point last, because the
    // closing paragraph is what the viewer carries away. Filtering by source
    // order silently threw that decision away: whichever point the commentator
    // happened to number lower landed last, so the one instruction that could
    // shape the ending had no effect on it.
    //
    // This belongs here rather than in a critic. A critic can only reject, and
    // its `suggestion` field is logged and never reaches the writer, so a rule
    // enforced there bounces the text back with no way for the next attempt to
    // know what to choose differently (owner's point, and the code agrees).
    const order = new Map(chosen.map((index, at) => [index, at]))
    const kept = allPoints
      .filter((p) => order.has(p.index))
      .sort((a, b) => order.get(a.index)! - order.get(b.index)!)
    if (kept.length > 0) {
      keptPoints = kept.map((p) => ({ index: p.index, text: p.text }))
      const preamble = commentaryPreamble(selection.text)
      focusedSource = [preamble, ...kept.map((p) => p.text)]
        .filter(Boolean)
        .join("\n\n")
      input.log?.(
        `reflection points ${chosen.join("+")} of ${allPoints.length} — ${reason}`,
      )
    }
  }

  // TWO-ACT LAYOUT: when the chapter opts in AND the picker chose exactly two
  // points, write the reflection as two halves — one per point — instead of
  // one block. Each half is generated against its own point only, so it
  // comments on the act of the clip it will sit after. Splitting the WRITING
  // (rather than slicing one long text afterwards) is what keeps each half
  // self-contained and roughly half the length.
  const wantsActs = chapter.splitActs === true && keptPoints.length === 2
  let reflectionParts: string[] | undefined
  if (wantsActs) {
    const halfWords = Math.round((input.approxWords ?? 170) / 2)
    const preamble = commentaryPreamble(selection.text)
    const halves: string[] = []
    for (const [i, point] of keptPoints.entries()) {
      const half = await modernize({
        // Preamble only on the first half; repeating it would restate the
        // scene framing in the middle of the video.
        sourceText: [i === 0 ? preamble : "", point.text]
          .filter(Boolean)
          .join("\n\n"),
        focusReference: selection.focusReference,
        sourceName: selection.source,
        scriptureReference: scripture.reference,
        scriptureText: scripture.text,
        approxWords: halfWords,
        maxWords: Math.round(halfWords * 1.2),
        // The second half sees the first, so it can open with one bridge
        // sentence tying its point back. Written blind, the two halves read
        // as competing claims (grace vs works) rather than one argument.
        ...(i > 0 ? { precedingHalf: halves[i - 1] } : {}),
        llm: input.llms?.modernize ?? input.llm,
        ...(input.log ? { log: input.log } : {}),
      })
      halves.push(stripDashes(half.adapted))
    }
    reflectionParts = halves
    input.log?.(
      `two-act reflection: ${halves.map((h) => h.trim().split(/\s+/).length).join(" + ")} words`,
    )
  }

  // In the two-act layout the halves were already written above; the full
  // reflection is simply their concatenation, so per-sentence narration and
  // card order stay identical to the single-block case (the manifest just
  // inserts the second video card between the halves).
  let attribution: string
  let reflectionText: string
  if (reflectionParts) {
    reflectionText = reflectionParts.join(" ")
    attribution = `Adapted from a trusted classic · ${selection.source.split(",")[0].trim()}`
  } else {
    const modern = await modernize({
      sourceText: focusedSource,
      focusReference: selection.focusReference,
      sourceName: selection.source,
      scriptureReference: scripture.reference,
      scriptureText: scripture.text,
      approxWords: input.approxWords ?? 170,
      llm: input.llms?.modernize ?? input.llm,
      ...(input.log ? { log: input.log } : {}),
    })
    // Owner rule: NO em/en dashes in generated copy (reads as AI). Agents are
    // instructed to avoid them; this is the safety net. Sanitize the reflection
    // BEFORE picking highlights so the verbatim accent phrases match the final
    // text. Scripture is an exact WEB verse and is left untouched.
    reflectionText = stripDashes(modern.adapted)
    attribution = modern.attribution
  }

  const copy = await writeCopy({
    sceneTitle: chapter.title,
    reference: scripture.reference,
    scriptureText: scripture.text,
    reflection: reflectionText,
    // Rotate the cover-hook form by sequence so openings vary (not always a
    // question / "What if...").
    hookStyle: hookStyleForSequence(input.sequence),
    llm: input.llms?.copy ?? input.llm,
  })

  // Conclusion runs AFTER copy — it needs to see the chosen title/question/
  // prayer to stay complementary rather than redundant with them.
  const { conclusion } = await writeConclusion({
    sceneTitle: chapter.title,
    reference: scripture.reference,
    scriptureText: scripture.text,
    reflection: reflectionText,
    title: copy.title,
    question: copy.question,
    prayer: copy.prayer,
    llm: input.llms?.conclusion ?? input.llm,
  })

  // One accent phrase per reflection chunk (verbatim), aligned with the split.
  const reflectionHighlights = await pickHighlights({
    chunks: splitReflection(reflectionText),
    llm: input.llms?.highlights ?? input.llm,
  })

  return {
    date: input.date,
    clip: { index: chapter.index, id: chapter.id, title: chapter.title },
    passage: { reference: chapter.reference, osisRef: chapter.osisRef },
    title: stripDashes(copy.title),
    scripture,
    reflection: {
      text: reflectionText,
      source: selection.source,
      attribution,
      flavor: selection.flavor,
      // The CHOSEN points, not the whole entry — this is the fidelity
      // critic's baseline, and comparing a deliberately-narrowed reflection
      // against the full multi-point original would flag the points we meant
      // to leave out as "dropped" on every single run.
      sourceExcerpt: focusedSource,
      ...(reflectionParts ? { parts: reflectionParts } : {}),
    },
    reflectionHighlights,
    conclusion: stripDashes(conclusion),
    question: stripDashes(copy.question),
    prayer: stripDashes(copy.prayer),
    mood: chapter.mood,
    voice: rotateVoice(input.sequence),
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
