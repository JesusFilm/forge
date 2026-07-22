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
import { SafetyVerdictSchema } from "../../services/devotional/artifacts"
import { produceDevotionalAudio } from "../../services/devotional/devotional-audio"
import {
  cacheDirFor,
  clearCachedDevotional,
  loadCachedAudio,
  loadCachedDevo,
  saveCachedAudio,
  saveCachedDevo,
} from "../../services/devotional/devotional-cache"
import { writeDevotionalCopy } from "../../services/devotional/devotional-copy"
import {
  devotionalArtifactProxyPath,
  renderDevotionalOnWorker,
} from "../../services/devotional/devotional-worker-client"
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
import { publishDevotional } from "../../services/devotional/site-publish-client"

/**
 * Video-first daily-devotional pipeline as SIX swappable sub-workflows composed
 * into one parent (owner: "different workflows inside one" — change a piece
 * without touching the others; localization later swaps Content, not Source):
 *
 *   Source  — pick an UNUSED JESUS-film clip (ledger) → scripture from its passage
 *   Content — reflection (rotate + modernize) → highlights → copy → SAFETY gate
 *   Produce — voiceover (rotated voice) + mood music → disk cache
 *   Render  — bounded worker job → durable portrait + wide MP4 artifacts
 *   Approve — 🧍 suspend/resume: a human approves the finished video in Studio
 *   Publish — site ingest → record the used clip only after acceptance
 *
 * Every LLM call runs on a Mastra Agent via the hybrid adapter (agent
 * instructions + byte-identical wire transport; see agent-llm.ts). A safety
 * block short-circuits the expensive stages: Produce/Render/Approve pass the
 * blocked result through untouched and Publish reports status "blocked".
 *
 * Heavy media work (download, ffmpeg, Remotion/Chromium, durable storage) stays
 * in shorts-worker. Mastra passes only text metadata and generated audio.
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
  start: z.string(),
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
  reservationId: z.string().uuid(),
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
  reservationId: z.string().uuid(),
  regenerate: z.boolean(),
  regenerateAudio: z.boolean(),
})

const ProducedSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  reservationId: z.string().uuid(),
  /** Cache dir holding the produced audio; null when safety blocked. */
  cacheDir: z.string().nullable(),
})

const VideoArtifactSchema = z
  .object({
    assetId: z.string(),
    artifactType: z.enum([
      "devotional-output-portrait-v1",
      "devotional-output-wide-v1",
    ]),
    ext: z.literal("mp4"),
  })
  .strict()

const RenderedSchema = z.object({
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  reservationId: z.string().uuid(),
  /** Durable 9:16 worker artifact; null when safety blocked. */
  portraitAsset: VideoArtifactSchema.nullable(),
  /** Durable 16:9 worker artifact; null when safety blocked. */
  wideAsset: VideoArtifactSchema.nullable(),
})

const ApprovalResume = z.object({
  approved: z.boolean(),
  notes: z.string().optional(),
  approvedBy: z.object({
    subject: z.string().min(1).max(256),
    email: z.string().email().max(320).optional(),
    role: z.enum(["admin", "editor"]),
  }),
})

const ApprovalSuspend = z.object({
  message: z.string(),
  portraitAsset: VideoArtifactSchema,
  wideAsset: VideoArtifactSchema,
  portraitUrl: z.string(),
  wideUrl: z.string(),
  title: z.string(),
  reference: z.string(),
  reflectionPreview: z.string(),
})

const ApprovedSchema = RenderedSchema.extend({
  approved: z.boolean(),
  notes: z.string().optional(),
  approvedBy: ApprovalResume.shape.approvedBy.optional(),
})

const ResultSchema = z.object({
  status: z.enum([
    "blocked",
    "rejected",
    "published",
    "publish_skipped",
    "publish_failed",
  ]),
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  portraitAsset: VideoArtifactSchema.nullable(),
  wideAsset: VideoArtifactSchema.nullable(),
  clipRecorded: z.boolean(),
  publishReason: z.string().optional(),
  publishRetryable: z.boolean().optional(),
  notes: z.string().optional(),
  approvedBy: ApprovalResume.shape.approvedBy.optional(),
})

async function releaseReservation(
  chapterId: string,
  reservationId: string,
): Promise<void> {
  await createUsedClipsStore()
    .release(chapterId, reservationId)
    .catch(() => false)
}

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
    let reservationId: string
    let reservedChapterId: string
    if (chapterIndex == null) {
      // Only chapters with a curated passage mapping are in the pool.
      const pool = mappedChapterIndices()
        .map((i) => JESUS_FILM_CHAPTERS[i - 1])
        .filter(Boolean)
      const picked = await store.pick(pool)
      chapterIndex = picked.chapter.index
      reservationId = picked.reservationId
      reservedChapterId = picked.chapter.id
    } else {
      const requested = chapterWithPassage(chapterIndex)
      if (!requested)
        throw new Error(`no passage mapping for chapter ${chapterIndex}`)
      const reserved = await store.reserve(requested)
      reservationId = reserved.reservationId
      reservedChapterId = reserved.chapter.id
    }

    // Reuse the cached devotional's scripture when available (no LLM call);
    // Content will reuse the full cached text too.
    const cacheDir = cacheDirFor(chapterIndex, sequence, date)
    const cached = inputData.regenerate ? null : await loadCachedDevo(cacheDir)
    if (cached) {
      const chapter = chapterWithPassage(chapterIndex)
      if (!chapter) {
        await releaseReservation(reservedChapterId, reservationId)
        throw new Error(`no passage mapping for chapter ${chapterIndex}`)
      }
      return {
        chapter,
        reservationId,
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
    }).catch(async (error) => {
      await releaseReservation(reservedChapterId, reservationId)
      throw error
    })
    return {
      chapter: sourced.chapter,
      reservationId,
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
    try {
      const cacheDir = cacheDirFor(
        inputData.chapter.index,
        inputData.sequence,
        inputData.date,
      )
      let devotional = inputData.fromCache
        ? await loadCachedDevo(cacheDir)
        : null
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
        reservationId: inputData.reservationId,
        regenerate: inputData.regenerate,
        regenerateAudio: inputData.regenerateAudio,
      }
    } catch (error) {
      await releaseReservation(inputData.chapter.id, inputData.reservationId)
      throw error
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
    try {
      const { devotional, safety } = inputData
      if (safety.verdict !== "pass") {
        return {
          devotional,
          safety,
          reservationId: inputData.reservationId,
          cacheDir: null,
        }
      }
      const cacheDir = cacheDirFor(
        devotional.clip.index,
        devotional.sequence,
        devotional.date,
      )
      const reuse = !inputData.regenerate && !inputData.regenerateAudio
      let audio = reuse
        ? await loadCachedAudio(cacheDir, devotional.voice)
        : null
      if (!audio) {
        audio = await produceDevotionalAudio(devotional)
        await saveCachedAudio(cacheDir, audio)
      }
      return {
        devotional,
        safety,
        reservationId: inputData.reservationId,
        cacheDir,
      }
    } catch (error) {
      await releaseReservation(
        inputData.devotional.clip.id,
        inputData.reservationId,
      )
      throw error
    }
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
    "Upload bounded devotional inputs and await the dedicated worker's durable portrait + wide renders. Skipped when blocked.",
  inputSchema: ProducedSchema,
  outputSchema: RenderedSchema,
  execute: async ({ inputData, runId, abortSignal }) => {
    try {
      const { devotional, safety, cacheDir } = inputData
      if (!cacheDir)
        return {
          devotional,
          safety,
          reservationId: inputData.reservationId,
          portraitAsset: null,
          wideAsset: null,
        }
      const audio = await loadCachedAudio(cacheDir, devotional.voice)
      if (!audio) throw new Error(`no cached audio in ${cacheDir}`)
      const rendered = await renderDevotionalOnWorker(
        {
          runId,
          devotional,
          audio,
        },
        { abortSignal },
      )
      return {
        devotional,
        safety,
        reservationId: inputData.reservationId,
        portraitAsset: rendered.portrait,
        wideAsset: rendered.wide,
      }
    } catch (error) {
      await releaseReservation(
        inputData.devotional.clip.id,
        inputData.reservationId,
      )
      throw error
    }
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
    if (inputData.portraitAsset == null || inputData.wideAsset == null) {
      // Safety blocked upstream — nothing to approve.
      return { ...inputData, approved: false, notes: "skipped: safety blocked" }
    }
    if (!resumeData) {
      await suspend({
        message:
          "Review the rendered devotional, then resume with { approved }.",
        portraitAsset: inputData.portraitAsset,
        wideAsset: inputData.wideAsset,
        portraitUrl: devotionalArtifactProxyPath(inputData.portraitAsset),
        wideUrl: devotionalArtifactProxyPath(inputData.wideAsset),
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
      approvedBy: resumeData.approvedBy,
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
    "On approval, publish both video assets and record the clip only after site acceptance.",
  inputSchema: ApprovedSchema,
  outputSchema: ResultSchema,
  execute: async ({ inputData, abortSignal }) => {
    const {
      devotional,
      safety,
      reservationId,
      portraitAsset,
      wideAsset,
      approved,
      notes,
      approvedBy,
    } = inputData
    let status: z.infer<typeof ResultSchema>["status"]
    let publishReason: string | undefined
    let publishRetryable: boolean | undefined
    let clipRecorded = false
    const store = createUsedClipsStore()
    if (safety.verdict !== "pass") {
      status = "blocked"
    } else if (!approved) {
      status = "rejected"
    } else if (!portraitAsset || !wideAsset) {
      status = "publish_failed"
      publishReason = "rendered_assets_missing"
    } else {
      const published = await publishDevotional({
        devotional: toLegacyDevotional(devotional),
        videoAssets: { portrait: portraitAsset, wide: wideAsset },
        abortSignal,
      })
      if (published.ok && published.published) {
        status = "published"
        try {
          await store.record(devotional.clip.id, reservationId)
          clipRecorded = true
        } catch {
          // Publication is irreversible. Keep this terminal as published so a
          // retry cannot create a second same-date devotional; leave the lease
          // in place for operator reconciliation instead of releasing it.
          publishReason = "ledger_record_failed"
        }
      } else if (!published.ok && published.reason === "config_missing") {
        status = "publish_skipped"
        publishReason = published.reason
      } else if (published.ok) {
        status = "publish_skipped"
        publishReason = "not_accepted"
      } else {
        status = "publish_failed"
        publishReason = published.reason
        publishRetryable = published.retryable
      }
    }

    // Only a confirmed publish burns the clip. Every blocked, rejected,
    // skipped, or failed attempt releases its reservation for a clean retry.
    if (!clipRecorded && status !== "published") {
      const released = await store
        .release(devotional.clip.id, reservationId)
        .catch(() => false)
      if (released) {
        await clearCachedDevotional(
          cacheDirFor(
            devotional.clip.index,
            devotional.sequence,
            devotional.date,
          ),
        ).catch(() => undefined)
      }
    }
    return {
      status,
      devotional,
      safety,
      portraitAsset,
      wideAsset,
      clipRecorded,
      publishReason,
      publishRetryable,
      notes,
      approvedBy,
    }
  },
})

export const devotionalPublishWorkflow = createWorkflow({
  id: "devotional-publish",
  description: "Publish: site ingest, then record the used clip on acceptance.",
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
