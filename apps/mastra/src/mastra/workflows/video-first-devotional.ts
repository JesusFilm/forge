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
import { produceDevotionalAudio } from "../../services/devotional/devotional-audio"
import {
  cacheDirFor,
  loadCachedAudio,
  loadCachedDevo,
  saveCachedAudio,
  saveCachedDevo,
} from "../../services/devotional/devotional-cache"
import { writeDevotionalCopy } from "../../services/devotional/devotional-copy"
import { renderDevotionalVideo } from "../../services/devotional/devotional-render"
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
  fromCache: z.boolean(),
  sequence: z.number(),
  date: z.string(),
  regenerate: z.boolean(),
  regenerateAudio: z.boolean(),
})

const ContentSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  regenerate: z.boolean(),
  regenerateAudio: z.boolean(),
})

const ProducedSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  /** Cache dir holding the produced audio; null when safety blocked. */
  cacheDir: z.string().nullable(),
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

    // AUTO sequence: one step per APPROVED devotional (sum of ledger counts),
    // so voice, filter, and reflection-source rotation advance with each
    // shipped video — no manual counter in the daily flow.
    let sequence = inputData.sequence
    if (sequence == null) {
      const ledger = await store.read()
      sequence = Object.values(ledger.used).reduce((s, e) => s + e.count, 0)
    }

    let chapterIndex = inputData.chapterIndex
    if (chapterIndex == null) {
      // Only chapters with a curated passage mapping are in the pool.
      const pool = mappedChapterIndices()
        .map((i) => JESUS_FILM_CHAPTERS[i - 1])
        .filter(Boolean)
      const picked = await store.pick(pool)
      chapterIndex = picked.index
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
      }
    }

    const sourced = await sourceClipAndScripture({
      chapterIndex,
      llm: scriptureLlm,
    })
    return {
      chapter: sourced.chapter,
      scripture: sourced.scripture,
      fromCache: false,
      sequence,
      date,
      regenerate: inputData.regenerate,
      regenerateAudio: inputData.regenerateAudio,
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
    const cacheDir = cacheDirFor(inputData.chapter.index, inputData.sequence)
    let devotional = inputData.fromCache ? await loadCachedDevo(cacheDir) : null
    if (!devotional) {
      devotional = await composeDevotionalContent(
        {
          chapter: inputData.chapter,
          scripture: inputData.scripture,
          sequence: inputData.sequence,
          date: inputData.date,
          llm: scriptureLlm, // unused: every LLM-using seam is overridden below
        },
        contentDeps,
      )
      await saveCachedDevo(cacheDir, devotional)
    }

    // The gate runs on EVERY pass (cached text included) — fail closed.
    const safety = await evaluateSafety({
      devotional: toLegacyDevotional(devotional),
      llm: safetyLlm,
    })

    return {
      devotional,
      safety,
      regenerate: inputData.regenerate,
      regenerateAudio: inputData.regenerateAudio,
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
    const { devotional, safety } = inputData
    if (safety.verdict !== "pass") {
      return { devotional, safety, cacheDir: null }
    }
    const cacheDir = cacheDirFor(devotional.clip.index, devotional.sequence)
    const reuse = !inputData.regenerate && !inputData.regenerateAudio
    let audio = reuse ? await loadCachedAudio(cacheDir, devotional.voice) : null
    if (!audio) {
      audio = await produceDevotionalAudio(devotional)
      await saveCachedAudio(cacheDir, audio)
    }
    return { devotional, safety, cacheDir }
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
    const { devotional, safety, cacheDir } = inputData
    if (!cacheDir)
      return { devotional, safety, videoPath: null, wideVideoPath: null }
    const audio = await loadCachedAudio(cacheDir, devotional.voice)
    if (!audio) throw new Error(`no cached audio in ${cacheDir}`)
    const outDir = path.join(devotionalArtifactRoot(), "video")
    // Owner rule: every run ships BOTH aspects — 9:16 (mobile) and 16:9
    // (desktop, text-on-blur bottom band). Sequential on purpose: two
    // concurrent Remotion renders starve the CPU and slow both down.
    const videoPath = await renderDevotionalVideo(devotional, audio, {
      outDir,
      log: () => {},
    })
    const wideVideoPath = await renderDevotionalVideo(devotional, audio, {
      outDir,
      aspect: "wide",
      log: () => {},
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
