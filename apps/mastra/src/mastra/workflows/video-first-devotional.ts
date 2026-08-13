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
import { writeDevotionalCopy } from "../../services/devotional/devotional-copy"
import {
  devotionalArtifactProxyPath,
  renderDevotionalOnWorker,
  verifyDevotionalWorkerArtifacts,
} from "../../services/devotional/devotional-worker-client"
import {
  composeDevotionalContent,
  GeneratedDevotionalSchema,
  sourceClipAndScripture,
  toLegacyDevotional,
  type GenerateDevotionalDeps,
} from "../../services/devotional/generate-devotional"
import {
  chapterWithPassage,
  mappedChapterIndices,
} from "../../services/devotional/jesus-film-passages"
import { selectScriptureForPassage } from "../../services/devotional/passage-scripture"
import { lookupVerse } from "../../services/devotional/web-bible"
import { generateMusic } from "../../services/devotional/elevenlabs-music"
import { rotateFilter } from "../../services/devotional/voice-rotation"
import { evaluateSafety } from "../../services/devotional/safety-gate"
import { reviewDevotionalText } from "../../services/devotional/devotional-quality-gate"
import { pickReflectionHighlights } from "../../services/devotional/reflection-highlighter"
import { modernizeReflection } from "../../services/devotional/reflection-modernizer"
import { pickBestSpurgeon } from "../../services/devotional/spurgeon-ranker"
import { getPostgresUsedClipsStore } from "../../services/devotional/workspace/postgres-used-clips"
import { publishDevotional } from "../../services/devotional/site-publish-client"
import {
  devotionalPublicationRequestHash,
  publishWithDurableIntent,
} from "../../services/devotional/workspace/publication"
import { verifyWorkflowWorkspaceSources } from "../../services/devotional/workspace/source-verification"
import { DevotionalSourceRefSchema } from "../../services/devotional/workspace/state-schema"
import { loadDevotionalAttemptAuthoredData } from "../../services/devotional/workspace/attempt-data"
import {
  writeAttemptJsonArtifact,
  writeInputsUsed,
} from "../../services/devotional/workspace/provenance"
import { VideoFirstDevotionalWorkflowInputSchema as InputSchema } from "./video-first-devotional-schema"

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
type WorkflowWorkspaceOwner = {
  getWorkspace():
    | {
        filesystem?: NonNullable<
          Parameters<typeof loadDevotionalAttemptAuthoredData>[0]["filesystem"]
        >
      }
    | undefined
}

async function loadAttemptData(
  mastra: WorkflowWorkspaceOwner,
  selectedSources: z.infer<typeof DevotionalSourceRefSchema>[],
) {
  const filesystem = mastra.getWorkspace()?.filesystem
  if (!filesystem) throw new Error("Devotional Workspace is unavailable")
  return loadDevotionalAttemptAuthoredData({
    filesystem,
    sources: selectedSources,
  })
}

function contentDependencies(
  authored: Awaited<ReturnType<typeof loadAttemptData>>,
): GenerateDevotionalDeps {
  return {
    chapters: authored.chapters,
    passages: authored.passages,
    corpora: authored.corpora,
    hookStyles: authored.prompts.generation.hookStyles,
    voiceRotation: authored.voices.rotation,
    modernize: (options) =>
      modernizeReflection({
        ...options,
        systemPrompt: authored.prompts.prompts.modernizer,
        llm: createAgentLlm(modernizerAgent, getDevotionalModel()),
      }),
    writeCopy: (options) =>
      writeDevotionalCopy({
        ...options,
        systemPrompt: authored.prompts.prompts.copy,
        llm: createAgentLlm(copyAgent, getDevotionalModel()),
      }),
    pickSpurgeon: (options) =>
      pickBestSpurgeon({
        ...options,
        systemPrompt: authored.prompts.prompts.ranker,
        llm: createAgentLlm(spurgeonRankerAgent, getDevotionalModel()),
      }),
    pickHighlights: (options) =>
      pickReflectionHighlights({
        ...options,
        systemPrompt: authored.prompts.prompts.highlighter,
        llm: createAgentLlm(highlighterAgent, getDevotionalModel()),
      }),
  }
}

// ---- Schemas (the serializable seams between sub-workflows) -----------------

const AttemptContextSchema = z.object({
  workspaceGeneration: z.number().int().positive(),
  attemptId: z.string().min(1),
  selectedSources: z.array(DevotionalSourceRefSchema).min(1).max(500),
})

function attemptContext(input: z.infer<typeof AttemptContextSchema>) {
  return {
    workspaceGeneration: input.workspaceGeneration,
    attemptId: input.attemptId,
    selectedSources: input.selectedSources,
  }
}

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

const SourcedSchema = z
  .object({
    chapter: ChapterSchema,
    reservationId: z.string().uuid(),
    scripture: ScriptureSchema,
    sequence: z.number(),
    date: z.string(),
  })
  .extend(AttemptContextSchema.shape)

/** Coherence + depth + fidelity verdict. Empty `blocking` means clean. Null when
 *  safety already blocked, since three more model calls cannot change an outcome
 *  that is already "do not publish".
 *
 *  `.optional()` as well as `.nullable()` is about DEPLOY, not about the happy
 *  path: this workflow suspends for human approval, so a run persisted before
 *  this key existed can resume after the deploy that added it. Without optional,
 *  that resume fails schema validation. With it, the key is simply absent, which
 *  the consumer must treat as "no verdict" — never as a pass. */
const QualityReviewSchema = z
  .object({ blocking: z.array(z.string()) })
  .nullable()
  .optional()

const ContentSchema = z
  .object({
    devotional: GeneratedDevotionalSchema,
    safety: SafetyVerdictSchema,
    quality: QualityReviewSchema,
    reservationId: z.string().uuid(),
  })
  .extend(AttemptContextSchema.shape)

const ProducedSchema = z
  .object({
    devotional: GeneratedDevotionalSchema,
    safety: SafetyVerdictSchema,
    quality: QualityReviewSchema,
    reservationId: z.string().uuid(),
    readyForRender: z.boolean(),
  })
  .extend(AttemptContextSchema.shape)

const VideoArtifactSchema = z
  .object({
    assetId: z.string(),
    artifactType: z.enum([
      "devotional-output-portrait-v1",
      "devotional-output-wide-v1",
    ]),
    ext: z.literal("mp4"),
    schemaVersion: z.literal("2").optional(),
    key: z.string().min(1).optional(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
    size: z.number().int().positive().optional(),
    contentType: z.string().min(1).optional(),
    attempt: z
      .object({
        workspaceGeneration: z.number().int().positive(),
        attemptId: z.string().min(1),
        runId: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()

const RenderedSchema = z
  .object({
    devotional: GeneratedDevotionalSchema,
    safety: SafetyVerdictSchema,
    reservationId: z.string().uuid(),
    /** Durable 9:16 worker artifact; null when safety blocked. */
    portraitAsset: VideoArtifactSchema.nullable(),
    /** Durable 16:9 worker artifact; null when safety blocked. */
    wideAsset: VideoArtifactSchema.nullable(),
  })
  .extend(AttemptContextSchema.shape)

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
  await getPostgresUsedClipsStore()
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
  execute: async ({ inputData, mastra, runId }) => {
    await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
    const filesystem = mastra.getWorkspace()?.filesystem
    if (!filesystem) throw new Error("Devotional Workspace is unavailable")
    await writeInputsUsed({
      filesystem,
      runId,
      attemptId: inputData.attemptId,
      catalogGeneration: inputData.workspaceGeneration,
      sources: inputData.selectedSources,
    })
    const authored = await loadAttemptData(mastra, inputData.selectedSources)
    const generationDeps = contentDependencies(authored)
    generationDeps.selectScripture = (options) =>
      selectScriptureForPassage({
        ...options,
        systemPrompt: authored.prompts.prompts.scripture,
        lookupVerse: (reference) =>
          lookupVerse(reference, authored.scripture.verses),
      })
    const date = inputData.date ?? new Date().toISOString().slice(0, 10)
    const store = getPostgresUsedClipsStore()

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
      const pool = mappedChapterIndices(authored.passages)
        .map((index) =>
          chapterWithPassage(index, authored.passages, authored.chapters),
        )
        .filter((chapter) => chapter !== null)
      const picked = await store.pick(pool)
      chapterIndex = picked.chapter.index
      reservationId = picked.reservationId
      reservedChapterId = picked.chapter.id
    } else {
      const requested = chapterWithPassage(
        chapterIndex,
        authored.passages,
        authored.chapters,
      )
      if (!requested)
        throw new Error(`no passage mapping for chapter ${chapterIndex}`)
      const reserved = await store.reserve(requested)
      reservationId = reserved.reservationId
      reservedChapterId = reserved.chapter.id
    }

    const sourced = await sourceClipAndScripture(
      { chapterIndex, llm: scriptureLlm },
      generationDeps,
    ).catch(async (error) => {
      await releaseReservation(reservedChapterId, reservationId)
      throw error
    })
    return {
      ...attemptContext(inputData),
      chapter: sourced.chapter,
      reservationId,
      scripture: sourced.scripture,
      sequence,
      date,
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
  execute: async ({ inputData, mastra, runId }) => {
    try {
      await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
      const authored = await loadAttemptData(mastra, inputData.selectedSources)
      const devotional = await composeDevotionalContent(
        {
          chapter: inputData.chapter,
          scripture: inputData.scripture,
          sequence: inputData.sequence,
          date: inputData.date,
          llm: scriptureLlm,
        },
        contentDependencies(authored),
      )

      // The gate runs on EVERY pass (cached text included) — fail closed.
      const safety = await evaluateSafety({
        devotional: toLegacyDevotional(devotional),
        llm: safetyLlm,
        systemPrompt: authored.safety.prompt,
        minConfidence: authored.safety.effectiveMinimumConfidence,
      })

      // Quality is a SECOND gate, on a different axis: safety asks whether the
      // text is doctrinally and tonally safe to publish, quality asks whether it
      // is worth publishing (coherent with its verse, deep enough to carry
      // something away, faithful to the source it adapts). It runs only when
      // safety passed — three further model calls cannot change an outcome that
      // is already "do not publish". Like safety it runs on every pass, cached
      // text included, and fails closed: a critic that cannot run is a block.
      const quality =
        safety.verdict === "pass"
          ? await reviewDevotionalText({
              devotional,
              passageReference: inputData.chapter.reference,
              // The composed text here is English; the localized path that
              // makes fidelity meaningless was not carried into this runtime.
              checkFidelity: true,
            })
          : null

      const filesystem = mastra.getWorkspace()?.filesystem
      if (!filesystem) throw new Error("Devotional Workspace is unavailable")
      await writeAttemptJsonArtifact({
        filesystem,
        runId,
        name: "content",
        value: { devotional, safety, quality },
      })

      return {
        ...attemptContext(inputData),
        devotional,
        safety,
        quality,
        reservationId: inputData.reservationId,
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
  id: "prepare-media",
  description:
    "Validate the exact authored media policy before the transient Worker handoff. Skipped when safety or quality blocked.",
  inputSchema: ContentSchema,
  outputSchema: ProducedSchema,
  execute: async ({ inputData, mastra }) => {
    try {
      await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
      const { devotional, safety, quality } = inputData
      // Both gates stand between composed text and money: ElevenLabs narration
      // and the Worker render are downstream of here. A null quality verdict
      // means safety already blocked, so it is not a pass by omission.
      // `== null` catches BOTH null (safety blocked, so quality never ran) and
      // undefined (a run persisted before this key existed, resuming across the
      // deploy that added it). Absent evidence is not a pass: blocking such a run
      // costs a missed publish, letting it through costs unreviewed text on the
      // site.
      const blocked =
        safety.verdict !== "pass" ||
        quality == null ||
        quality.blocking.length > 0
      if (blocked) {
        return {
          ...attemptContext(inputData),
          devotional,
          safety,
          quality,
          reservationId: inputData.reservationId,
          readyForRender: false,
        }
      }
      await loadAttemptData(mastra, inputData.selectedSources)
      return {
        ...attemptContext(inputData),
        devotional,
        safety,
        quality,
        reservationId: inputData.reservationId,
        readyForRender: true,
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
  description: "Produce: validate authored media policy for this attempt.",
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
  execute: async ({ inputData, runId, abortSignal, mastra }) => {
    try {
      await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
      const { devotional, safety, readyForRender } = inputData
      if (!readyForRender)
        return {
          ...attemptContext(inputData),
          devotional,
          safety,
          reservationId: inputData.reservationId,
          portraitAsset: null,
          wideAsset: null,
        }
      const authored = await loadAttemptData(mastra, inputData.selectedSources)
      const audio = await produceDevotionalAudio(devotional, {
        narration: authored.narration,
        voiceProfiles: authored.voices.profiles,
        voiceSettings: authored.voices.settings,
        musicLengthMs: authored.music.defaultLengthMs,
        music: (options) =>
          generateMusic({
            ...options,
            moodPrompts: authored.music.moods,
            defaultLengthMs: authored.music.defaultLengthMs,
          }),
      })
      const filesystem = mastra.getWorkspace()?.filesystem
      if (!filesystem) throw new Error("Devotional Workspace is unavailable")
      await writeAttemptJsonArtifact({
        filesystem,
        runId,
        name: "audio-sidecar",
        value: {
          voice: audio.voice,
          skipped: audio.skipped,
          segments: audio.segments.map((segment) => ({
            id: segment.id,
            text: segment.text,
            voiceId: segment.audio.voiceId,
            model: segment.audio.model,
            characterCount: segment.audio.characterCount,
            byteLength: segment.audio.bytes.byteLength,
          })),
          music: audio.music
            ? {
                mood: audio.music.mood,
                prompt: audio.music.audio.prompt,
                lengthMs: audio.music.audio.lengthMs,
                model: audio.music.audio.model,
                byteLength: audio.music.audio.bytes.byteLength,
              }
            : null,
        },
      })
      const rendered = await renderDevotionalOnWorker(
        {
          runId,
          devotional,
          audio,
          workspaceGeneration: inputData.workspaceGeneration,
          attemptId: inputData.attemptId,
          selectedSources: inputData.selectedSources,
          renderStyle: rotateFilter(
            devotional.sequence,
            authored.voices.filterRotation,
          ),
          renderConfig: authored.render,
        },
        { abortSignal },
      )
      return {
        ...attemptContext(inputData),
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
  execute: async ({ inputData, resumeData, suspend, mastra }) => {
    try {
      await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
    } catch (error) {
      await getPostgresUsedClipsStore()
        .release(inputData.devotional.clip.id, inputData.reservationId)
        .catch(() => false)
      throw error
    }
    if (inputData.portraitAsset == null || inputData.wideAsset == null) {
      // Safety blocked upstream — nothing to approve.
      return { ...inputData, approved: false, notes: "skipped: safety blocked" }
    }
    try {
      await verifyDevotionalWorkerArtifacts({
        portrait: inputData.portraitAsset,
        wide: inputData.wideAsset,
      })
    } catch (error) {
      await getPostgresUsedClipsStore()
        .release(inputData.devotional.clip.id, inputData.reservationId)
        .catch(() => false)
      throw error
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
  execute: async ({ inputData, abortSignal, mastra, runId }) => {
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
    const store = getPostgresUsedClipsStore()
    try {
      await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
      if (portraitAsset && wideAsset) {
        await verifyDevotionalWorkerArtifacts({
          portrait: portraitAsset,
          wide: wideAsset,
        })
      }
    } catch (error) {
      await store.release(devotional.clip.id, reservationId).catch(() => false)
      throw error
    }

    let publicationIntentOwnsReservation = false
    if (safety.verdict !== "pass") {
      status = "blocked"
    } else if (!approved) {
      status = "rejected"
    } else if (!portraitAsset || !wideAsset) {
      status = "publish_failed"
      publishReason = "rendered_assets_missing"
    } else {
      publicationIntentOwnsReservation = true
      const legacyDevotional = toLegacyDevotional(devotional)
      const receiverIdempotencyKey = `daily-devotional:${devotional.date}`
      const published = await publishWithDurableIntent({
        attemptId: inputData.attemptId,
        chapterId: devotional.clip.id,
        reservationId,
        receiverIdempotencyKey,
        requestHash: devotionalPublicationRequestHash({
          date: devotional.date,
          chapterId: devotional.clip.id,
          portraitAsset,
          wideAsset,
        }),
        send: () =>
          publishDevotional({
            devotional: legacyDevotional,
            videoAssets: { portrait: portraitAsset, wide: wideAsset },
            abortSignal,
          }),
      })
      if (published.ok && published.published) {
        status = "published"
        clipRecorded = true
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
    if (
      !publicationIntentOwnsReservation &&
      !clipRecorded &&
      status !== "published"
    ) {
      await store.release(devotional.clip.id, reservationId).catch(() => false)
    }
    const result = {
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
    const filesystem = mastra.getWorkspace()?.filesystem
    if (!filesystem) throw new Error("Devotional Workspace is unavailable")
    await writeAttemptJsonArtifact({
      filesystem,
      runId,
      name: "publication",
      value: result,
    })
    return result
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
