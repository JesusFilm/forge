import path from "node:path"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { getDevotionalModel, getDevotionalSafetyModel } from "../../config/env"
import { createAgentLlm } from "../agents/devotional/agent-llm"
import { copyAgent } from "../agents/devotional/copy-agent"
import { highlighterAgent } from "../agents/devotional/highlighter-agent"
import { modernizerAgent } from "../agents/devotional/modernizer-agent"
import { safetyAgent } from "../agents/devotional/safety-agent"
import { scriptureAgent } from "../agents/devotional/scripture-agent"
import { spurgeonRankerAgent } from "../agents/devotional/spurgeon-ranker-agent"
import {
  devotionalArtifactRoot,
  SafetyVerdictSchema,
} from "../../services/devotional/artifacts"
import {
  cacheDirFor,
  loadCachedAudio,
  loadCachedDevo,
  saveCachedDevo,
} from "../../services/devotional/devotional-cache"
import { writeDevotionalCopy } from "../../services/devotional/devotional-copy"
import {
  assertNarrationComplete,
  produceNarration,
  renderDevotionalVideo,
} from "../../services/devotional/devotional-render"
import { localeFor } from "../../services/devotional/devotional-locale"
import { localizeDevotional } from "../../services/devotional/localize-devotional"
import {
  DevotionalQualityGateError,
  reviewDevotionalText,
} from "../../services/devotional/devotional-quality-gate"
import {
  composeDevotionalContent,
  GeneratedDevotionalSchema,
  sourceClipAndScripture,
  toLegacyDevotional,
  type GenerateDevotionalDeps,
} from "../../services/devotional/generate-devotional"
import { JESUS_FILM_CHAPTERS } from "../../services/devotional/jesus-film-catalog"
import {
  chapterWithPassage,
  mappedChapterIndices,
} from "../../services/devotional/jesus-film-passages"
import { calendarEntryFor } from "../../services/devotional/devotional-calendar"
import { evaluateSafety } from "../../services/devotional/safety-gate"
import { pickReflectionHighlights } from "../../services/devotional/reflection-highlighter"
import { modernizeReflection } from "../../services/devotional/reflection-modernizer"
import { pickBestSpurgeon } from "../../services/devotional/spurgeon-ranker"
import { createUsedClipsStore } from "../../services/devotional/used-clips-ledger"

/**
 * Video-first daily-devotional pipeline as SIX swappable sub-workflows composed
 * into one parent (owner: "different workflows inside one" — change a piece
 * without touching the others; localization later swaps Content, not Source):
 *
 *   Source  — pick an UNUSED JESUS-film clip (ledger) → scripture from its passage
 *   Content — reflection (rotate + modernize) → highlights → copy → SAFETY gate
 *   Produce — voiceover (rotated voice) + mood music → disk cache
 *   Render  — clip download/trim → manifest → spawned Remotion render → MP4
 *   Approve — 🧍 suspend/resume: a human approves the finished video in Studio
 *   Publish — record the used clip (site publish is a flagged follow-up)
 *
 * Every LLM call runs on a Mastra Agent via the hybrid adapter (agent
 * instructions + byte-identical wire transport; see agent-llm.ts). A safety
 * block short-circuits the expensive stages: Produce/Render/Approve pass the
 * blocked result through untouched and Publish reports status "blocked".
 *
 * The render spawns Remotion in-process — fine locally/Studio; a deployed run
 * should trigger a dedicated render worker instead.
 */

// ---- Per-agent LLM seams (hybrid adapter) ----------------------------------

const scriptureLlm = createAgentLlm(scriptureAgent, getDevotionalModel())
const safetyLlm = createAgentLlm(safetyAgent, getDevotionalSafetyModel())
const contentDeps: GenerateDevotionalDeps = {
  modernize: (o) =>
    modernizeReflection({
      ...o,
      llm: createAgentLlm(modernizerAgent, getDevotionalModel()),
    }),
  writeCopy: (o) =>
    writeDevotionalCopy({
      ...o,
      llm: createAgentLlm(copyAgent, getDevotionalModel()),
    }),
  pickSpurgeon: (o) =>
    pickBestSpurgeon({
      ...o,
      llm: createAgentLlm(spurgeonRankerAgent, getDevotionalModel()),
    }),
  pickHighlights: (o) =>
    pickReflectionHighlights({
      ...o,
      llm: createAgentLlm(highlighterAgent, getDevotionalModel()),
    }),
}

// ---- Schemas (the serializable seams between sub-workflows) -----------------

/**
 * Presentation choices, carried through every seam so the RENDER step can see
 * what the CALLER asked for.
 *
 * These existed only as CLI flags, which meant an agent (or anyone driving the
 * registered workflow) could not produce a Russian devotional or choose a grade
 * at all — the workflow's input schema is `.strict()`, so there was no field to
 * set even if the caller wanted to. Every field here is optional and falls back
 * to the render's own default, so adding them changes no existing behaviour.
 *
 * Deliberately EXCLUDES the cover-card props (hideCoverDate / coverTextStatic /
 * coverSecondaryLine): those are for local social-media experiments, not the
 * daily pipeline, and are driven directly through the render script.
 */
const RenderPrefsSchema = z.object({
  /** Localized edition. `en` renders from the English text as-is; `ru`
   *  translates the copy, fetches the Synodal verse, and uses the RU voice. */
  lang: z.enum(["en", "ru"]).default("en"),
  /** Colour grade. Omit to keep the per-sequence rotation the render applies. */
  style: z.string().optional(),
  /** Text arrangement. Omit for the render's own default. */
  layout: z.string().optional(),
})

const InputSchema = z
  .object({
    /** JESUS-film chapter to use; omit to pick the next UNUSED one (ledger). */
    chapterIndex: z.number().int().positive().optional(),
    /** Rotation counter (voice + filter + reflection source). Omit to
     *  AUTO-INCREMENT: the count of approved devotionals in the ledger. */
    sequence: z.number().int().nonnegative().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Regenerate text+audio instead of reusing the cache. */
    regenerate: z.boolean().default(false),
    /** Regenerate only the audio, keeping cached text. */
    regenerateAudio: z.boolean().default(false),
    /** Skip the three text critics. Off by default; the gate exists to stop bad
     *  text costing a narration and a render, so overriding it is deliberate. */
    ignoreQualityGate: z.boolean().default(false),
    prefs: RenderPrefsSchema.default({ lang: "en" }),
  })
  .strict()

const ChapterSchema = z.object({
  index: z.number(),
  id: z.string(),
  title: z.string(),
  osisRef: z.string(),
  reference: z.string(),
  mood: z.enum(["peace", "hope", "lament", "awe"]),
  themes: z.array(z.string()),
  clipStartSec: z.number().optional(),
  clipLengthSec: z.number().optional(),
})

const ScriptureSchema = z.object({
  reference: z.string(),
  text: z.string(),
  translation: z.string().nullable(),
  needsCanonicalSource: z.boolean(),
})

const SourcedSchema = z.object({
  chapter: ChapterSchema,
  scripture: ScriptureSchema,
  /** The clip's own transcript for its curated window (see
   *  GeneratedDevotional.clipTranscript) — absent on the fromCache path,
   *  which skips composeDevotionalContent entirely and so never needs it. */
  clipTranscript: z.string().optional(),
  fromCache: z.boolean(),
  sequence: z.number(),
  date: z.string(),
  regenerate: z.boolean(),
  regenerateAudio: z.boolean(),
  ignoreQualityGate: z.boolean(),
  prefs: RenderPrefsSchema,
})

const ContentSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  regenerate: z.boolean(),
  regenerateAudio: z.boolean(),
  prefs: RenderPrefsSchema,
})

const ProducedSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  /** Cache dir holding the produced audio; null when safety blocked. */
  cacheDir: z.string().nullable(),
  prefs: RenderPrefsSchema,
})

const RenderedSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  /** Rendered 9:16 MP4 (mobile); null when safety blocked. */
  videoPath: z.string().nullable(),
  /** Rendered 16:9 MP4 (desktop, text-on-blur bottom); null when blocked. */
  wideVideoPath: z.string().nullable(),
})

const ApprovalResume = z.object({
  approved: z.boolean(),
  notes: z.string().optional(),
})

const ApprovalSuspend = z.object({
  message: z.string(),
  videoPath: z.string(),
  wideVideoPath: z.string().nullable(),
  title: z.string(),
  reference: z.string(),
  reflectionPreview: z.string(),
})

const ApprovedSchema = RenderedSchema.extend({
  approved: z.boolean(),
  notes: z.string().optional(),
})

const ResultSchema = z.object({
  status: z.enum(["blocked", "rejected", "approved"]),
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  videoPath: z.string().nullable(),
  wideVideoPath: z.string().nullable(),
  clipRecorded: z.boolean(),
  notes: z.string().optional(),
})

// ---- 1 · Source --------------------------------------------------------------

const sourceStep = createStep({
  id: "pick-clip-and-scripture",
  description:
    "Pick an unused JESUS-film clip (ledger) and anchor the scripture in its passage (exact WEB verse).",
  inputSchema: InputSchema,
  outputSchema: SourcedSchema,
  execute: async ({ inputData }) => {
    const date = inputData.date ?? new Date().toISOString().slice(0, 10)
    const store = createUsedClipsStore()
    // Editorial calendar (e.g. the August plan): a specific date can pin a
    // specific chapter. Only consulted when the caller didn't ALREADY pick a
    // chapter explicitly — an explicit chapterIndex is a manual override.
    const calendarEntry =
      inputData.chapterIndex == null ? calendarEntryFor(date) : null

    let chapterIndex = inputData.chapterIndex
    if (chapterIndex == null) {
      if (calendarEntry) {
        chapterIndex = calendarEntry.chapterIndex
      } else {
        // Only chapters with a curated passage mapping are in the pool.
        const pool = mappedChapterIndices()
          .map((i) => JESUS_FILM_CHAPTERS[i - 1])
          .filter(Boolean)
        const picked = await store.pick(pool)
        chapterIndex = picked.index
      }
    }

    // AUTO sequence: one step per APPROVED devotional (sum of ledger counts),
    // so voice, filter, and reflection-source rotation advance with each
    // shipped video — no manual counter in the daily flow. A calendar day
    // uses its PINNED sequence instead (stable regardless of how many OTHER
    // devotionals get approved between now and that date), UNLESS the caller
    // explicitly chose a different chapter than the calendar's for this date.
    let sequence = inputData.sequence
    if (sequence == null) {
      sequence =
        calendarEntry && chapterIndex === calendarEntry.chapterIndex
          ? calendarEntry.sequence
          : Object.values((await store.read()).used).reduce(
              (s, e) => s + e.count,
              0,
            )
    }

    // Reuse the cached devotional's scripture when available (no LLM call);
    // Content will reuse the full cached text too.
    const cacheDir = cacheDirFor(chapterIndex, sequence)
    const cached = inputData.regenerate ? null : await loadCachedDevo(cacheDir)
    if (cached) {
      const chapter = chapterWithPassage(chapterIndex)
      if (!chapter)
        throw new Error(`no passage mapping for chapter ${chapterIndex}`)
      return {
        chapter,
        scripture: cached.scripture,
        fromCache: true,
        sequence,
        date,
        regenerate: inputData.regenerate,
        regenerateAudio: inputData.regenerateAudio,
        ignoreQualityGate: inputData.ignoreQualityGate,
        prefs: inputData.prefs,
      }
    }

    const sourced = await sourceClipAndScripture({
      chapterIndex,
      llm: scriptureLlm,
    })
    return {
      chapter: sourced.chapter,
      scripture: sourced.scripture,
      ...(sourced.clipTranscript
        ? { clipTranscript: sourced.clipTranscript }
        : {}),
      fromCache: false,
      sequence,
      date,
      regenerate: inputData.regenerate,
      regenerateAudio: inputData.regenerateAudio,
      ignoreQualityGate: inputData.ignoreQualityGate,
      prefs: inputData.prefs,
    }
  },
})

export const devotionalSourceWorkflow = createWorkflow({
  id: "devotional-source",
  description: "Source: unused clip → passage-anchored scripture.",
  inputSchema: InputSchema,
  outputSchema: SourcedSchema,
})
  .then(sourceStep)
  .commit()

// ---- 2 · Content ---------------------------------------------------------------

const contentStep = createStep({
  id: "compose-content",
  description:
    "Reflection (rotated source, modernized) + highlights + copy, then the safety gate.",
  inputSchema: SourcedSchema,
  outputSchema: ContentSchema,
  execute: async ({ inputData }) => {
    const { lang } = inputData.prefs
    const enDir = cacheDirFor(inputData.chapter.index, inputData.sequence)
    let devotional = inputData.fromCache ? await loadCachedDevo(enDir) : null
    if (!devotional) {
      devotional = await composeDevotionalContent(
        {
          chapter: inputData.chapter,
          scripture: inputData.scripture,
          ...(inputData.clipTranscript
            ? { clipTranscript: inputData.clipTranscript }
            : {}),
          sequence: inputData.sequence,
          date: inputData.date,
          llm: scriptureLlm, // unused: every LLM-using seam is overridden below
        },
        contentDeps,
      )
      await saveCachedDevo(enDir, devotional)
    }

    // Localized edition: translate the copy, fetch the target-language verse,
    // switch to the locale's voice. Cached under its own -<lang> dir so an
    // English and a Russian edition of the same chapter never overwrite each
    // other. This was CLI-only; the workflow had no `lang` at all.
    if (lang !== "en") {
      const langDir = cacheDirFor(
        inputData.chapter.index,
        inputData.sequence,
        lang,
      )
      const cachedLocalized = inputData.regenerate
        ? null
        : await loadCachedDevo(langDir)
      if (cachedLocalized) {
        devotional = cachedLocalized
      } else {
        devotional = await localizeDevotional({
          devotional,
          locale: localeFor(lang),
          llm: createAgentLlm(modernizerAgent, getDevotionalModel()),
        })
        await saveCachedDevo(langDir, devotional)
      }
    }

    // The gate runs on EVERY pass (cached text included) — fail closed.
    const safety = await evaluateSafety({
      devotional: toLegacyDevotional(devotional),
      llm: safetyLlm,
    })

    // The THREE text critics (coherence, depth, source fidelity), before any
    // audio or video work. This ran only on the CLI path, so an agent-driven run
    // got no text-quality checking beyond the safety gate — and a coherence or
    // depth problem surfaced only at the human approval step, after a full
    // narration and two Remotion renders had already been paid for.
    //
    // Fidelity compares the adaptation against the ENGLISH source excerpt, so it
    // is meaningless once the copy is translated.
    if (safety.verdict === "pass") {
      const review = await reviewDevotionalText({
        devotional,
        passageReference: inputData.chapter.reference,
        checkFidelity: lang === "en",
      })
      if (review.blocking.length > 0) {
        if (inputData.ignoreQualityGate) {
          console.warn(
            `[devotional] event=quality_gate_overridden reasons=${review.blocking.length}`,
          )
        } else {
          throw new DevotionalQualityGateError(review.blocking)
        }
      }
    }

    return {
      devotional,
      safety,
      regenerate: inputData.regenerate,
      regenerateAudio: inputData.regenerateAudio,
      prefs: inputData.prefs,
    }
  },
})

export const devotionalContentWorkflow = createWorkflow({
  id: "devotional-content",
  description: "Content: reflection → highlights → copy → safety gate.",
  inputSchema: SourcedSchema,
  outputSchema: ContentSchema,
})
  .then(contentStep)
  .commit()

// ---- 3 · Produce ---------------------------------------------------------------

const produceStep = createStep({
  id: "produce-audio",
  description:
    "Voiceover (rotated voice) + mood music via ElevenLabs, cached to disk. Skipped when safety blocked.",
  inputSchema: ContentSchema,
  outputSchema: ProducedSchema,
  execute: async ({ inputData }) => {
    const { devotional, safety, prefs } = inputData
    if (safety.verdict !== "pass") {
      return { devotional, safety, cacheDir: null, prefs }
    }
    // Localized audio lives in the -<lang> dir alongside its localized text;
    // sharing the English dir would overwrite one edition's narration with the
    // other's.
    const cacheDir = cacheDirFor(
      devotional.clip.index,
      devotional.sequence,
      prefs.lang,
    )
    // Route through the SHARED narration producer. This step used to call
    // `produceDevotionalAudio(devotional)` bare, which silently cost it four
    // things the CLI path had — per-segment reuse, real-silence pauses between
    // sentences, card pacing, and the completeness guard — and then persisted
    // the result into the very cache the CLI path reads back. See
    // produceNarration's docstring for why this is one function.
    await produceNarration(devotional, localeFor(prefs.lang), {
      cacheDir,
      reuse: !inputData.regenerate && !inputData.regenerateAudio,
    })
    return { devotional, safety, cacheDir, prefs }
  },
})

export const devotionalProduceWorkflow = createWorkflow({
  id: "devotional-produce",
  description: "Produce: narration + music bed → disk cache.",
  inputSchema: ContentSchema,
  outputSchema: ProducedSchema,
})
  .then(produceStep)
  .commit()

// ---- 4 · Render ----------------------------------------------------------------

const renderStep = createStep({
  id: "render-video",
  description:
    "Download + trim the clip, build the manifest, spawn the Remotion render. Skipped when blocked.",
  inputSchema: ProducedSchema,
  outputSchema: RenderedSchema,
  execute: async ({ inputData }) => {
    const { devotional, safety, cacheDir, prefs } = inputData
    if (!cacheDir)
      return { devotional, safety, videoPath: null, wideVideoPath: null }
    const audio = await loadCachedAudio(cacheDir, devotional.voice)
    if (!audio) throw new Error(`no cached audio in ${cacheDir}`)
    // The cache is a seam between steps, and three other callers write to it —
    // so re-check completeness here rather than trusting that whoever filled it
    // did. This is the check whose absence once shipped a 110s video that
    // skipped its own conclusion and question card.
    assertNarrationComplete(audio)
    const outDir = path.join(devotionalArtifactRoot(), "video")
    // Presentation choices now come from the caller. `style` and `layout` were
    // reachable only as CLI flags, and the workflow's `.strict()` input schema
    // had no field for them at all — so an agent-driven run could not pick a
    // grade even deliberately. Omitted values fall through to the render's own
    // defaults, so the existing per-sequence filter rotation is unchanged.
    const renderOpts = {
      outDir,
      locale: localeFor(prefs.lang),
      ...(prefs.style ? { style: prefs.style } : {}),
      ...(prefs.layout ? { layout: prefs.layout } : {}),
      log: () => {},
    }
    // Owner rule: every run ships BOTH aspects — 9:16 (mobile) and 16:9
    // (desktop, text-on-blur bottom band). Sequential on purpose: two
    // concurrent Remotion renders starve the CPU and slow both down.
    const videoPath = await renderDevotionalVideo(devotional, audio, renderOpts)
    const wideVideoPath = await renderDevotionalVideo(devotional, audio, {
      ...renderOpts,
      aspect: "wide",
    })
    return { devotional, safety, videoPath, wideVideoPath }
  },
})

export const devotionalRenderWorkflow = createWorkflow({
  id: "devotional-render",
  description: "Render: clip + audio + manifest → MP4 (Remotion).",
  inputSchema: ProducedSchema,
  outputSchema: RenderedSchema,
})
  .then(renderStep)
  .commit()

// ---- 5 · Approve (human-in-the-loop) --------------------------------------------

const approveStep = createStep({
  id: "await-approval",
  description: "Pause for a human to approve the finished video in the Studio.",
  inputSchema: RenderedSchema,
  resumeSchema: ApprovalResume,
  suspendSchema: ApprovalSuspend,
  outputSchema: ApprovedSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (inputData.videoPath == null) {
      // Safety blocked upstream — nothing to approve.
      return { ...inputData, approved: false, notes: "skipped: safety blocked" }
    }
    if (!resumeData) {
      await suspend({
        message:
          "Review the rendered devotional, then resume with { approved }.",
        videoPath: inputData.videoPath,
        wideVideoPath: inputData.wideVideoPath,
        title: inputData.devotional.title,
        reference: inputData.devotional.scripture.reference,
        reflectionPreview: inputData.devotional.reflection.text.slice(0, 240),
      })
      // Not reached until resumed; return keeps the type checker happy.
      return { ...inputData, approved: false }
    }
    return {
      ...inputData,
      approved: resumeData.approved,
      notes: resumeData.notes,
    }
  },
})

export const devotionalApproveWorkflow = createWorkflow({
  id: "devotional-approve",
  description: "Approve: human reviews the finished video (suspend/resume).",
  inputSchema: RenderedSchema,
  outputSchema: ApprovedSchema,
})
  .then(approveStep)
  .commit()

// ---- 6 · Publish -----------------------------------------------------------------

const publishStep = createStep({
  id: "publish",
  description:
    "On approval, record the used clip in the ledger (site publish is a follow-up).",
  inputSchema: ApprovedSchema,
  outputSchema: ResultSchema,
  execute: async ({ inputData }) => {
    const { devotional, safety, videoPath, wideVideoPath, approved, notes } =
      inputData
    const status =
      safety.verdict !== "pass"
        ? ("blocked" as const)
        : approved
          ? ("approved" as const)
          : ("rejected" as const)

    // Record the clip ONLY for an approved devotional, so a blocked/rejected
    // run doesn't burn the clip. A non-approved run RELEASES its Source-time
    // reservation so the clip is immediately available again. Best-effort.
    let clipRecorded = false
    const store = createUsedClipsStore()
    if (status === "approved") {
      try {
        await store.record(devotional.clip.id)
        clipRecorded = true
      } catch {
        clipRecorded = false
      }
    } else {
      await store.release(devotional.clip.id).catch(() => undefined)
    }
    return {
      status,
      devotional,
      safety,
      videoPath,
      wideVideoPath,
      clipRecorded,
      notes,
    }
  },
})

export const devotionalPublishWorkflow = createWorkflow({
  id: "devotional-publish",
  description: "Publish: record the used clip on approval.",
  inputSchema: ApprovedSchema,
  outputSchema: ResultSchema,
})
  .then(publishStep)
  .commit()

// ---- Parent: the whole pipeline ---------------------------------------------------

export const videoFirstDevotionalWorkflow = createWorkflow({
  id: "video-first-devotional",
  description:
    "Generate a video-first daily devotional end to end: source clip → content + safety → audio → render → human approval → publish.",
  inputSchema: InputSchema,
  outputSchema: ResultSchema,
})
  .then(devotionalSourceWorkflow)
  .then(devotionalContentWorkflow)
  .then(devotionalProduceWorkflow)
  .then(devotionalRenderWorkflow)
  .then(devotionalApproveWorkflow)
  .then(devotionalPublishWorkflow)
  .commit()
