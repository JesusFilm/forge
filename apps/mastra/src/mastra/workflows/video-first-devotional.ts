import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import {
  getDevotionalModel,
  getDevotionalSafetyModel,
  isDevotionalQualityGateEnforced,
} from "../../config/env"
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
  chaptersWithReflectionSource,
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
import { pickReflectionPoints } from "../../services/devotional/reflection-point-picker"
import { writeDevotionalConclusion } from "../../services/devotional/devotional-conclusion"
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
    // These two were left unwired when they were added, so production ran them
    // on in-code prompts while every sibling seam above reads its prompt from
    // the Workspace. That silently took the owner's closing-line and
    // point-selection rules off the surface she can edit without a deploy, which
    // is the whole point of the authored plane.
    //
    // `systemPrompt` stays undefined when the deployed document predates the
    // key, and the service then falls back to its in-code copy — see the
    // `.optional()` note on those keys in authored-data.ts.
    pickPoints: (options) =>
      pickReflectionPoints({
        ...options,
        systemPrompt: authored.prompts.prompts.pointPicker,
      }),
    writeConclusion: (options) =>
      writeDevotionalConclusion({
        ...options,
        systemPrompt: authored.prompts.prompts.conclusion,
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
 *  `enforced` records whether this run's verdict was ACTED ON, so a stored
 *  verdict is never ambiguous after the fact: a report-only run carries its
 *  findings with `enforced: false`, which is what makes the critics' false
 *  positive rate and the provider's reliability observable BEFORE enforcement is
 *  turned on.
 *
 *  `.optional()` as well as `.nullable()` is about DEPLOY, not about the happy
 *  path: this workflow suspends for human approval, so a run persisted before
 *  this key existed can resume after the deploy that added it. Without optional,
 *  that resume fails schema validation. With it, the key is simply absent, which
 *  the consumer must treat as "no verdict" — never as a pass. */
const QualityReviewSchema = z
  .object({ blocking: z.array(z.string()), enforced: z.boolean() })
  .nullable()
  .optional()

type QualityVerdict = z.infer<typeof QualityReviewSchema>

/**
 * Does the quality verdict stop this run? ONE function, because the two callers
 * (produce and publish) previously each answered it and disagreed: a legacy run
 * rendered — paying for narration and Remotion — and was then refused at
 * publication, so the money was spent and nothing shipped.
 *
 * Three states that must not be conflated:
 *
 *   `undefined` — LEGACY. Persisted before this key existed, so it is resuming
 *     across the deploy that added it. Policy: treat as report-only, i.e. do NOT
 *     block. The run was composed when no gate existed; refusing to publish it
 *     now punishes it for a check it could never have had, and under this
 *     rollout the gate is not enforcing anyway. Recomputing instead was the other
 *     option, and it is worse here: the critics would judge text a human may
 *     already have approved, at three model calls, to reach a verdict this
 *     rollout would not act on.
 *   `null` — safety blocked, so quality deliberately never ran. Blocks. Callers
 *     reach their own safety clause first, so this is the belt to that braces:
 *     absent evidence is never a pass.
 *   present — a real verdict. Blocks only if it was ENFORCED when produced.
 */
export function qualityBlocksRun(quality: QualityVerdict): boolean {
  if (quality === undefined) return false
  if (quality === null) return true
  return quality.enforced && quality.blocking.length > 0
}

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
    quality: QualityReviewSchema,
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
  /** Which gate blocked, when `status` is "blocked". Without it a quality block
   *  and a safety block are indistinguishable to the approver, and a quality
   *  block used to fall through to `publish_failed` /
   *  `rendered_assets_missing` — a quality problem reported as a render bug. */
  blockedBy: z.enum(["safety", "quality"]).optional(),
  devotional: GeneratedDevotionalSchema,
  safety: SafetyVerdictSchema,
  quality: QualityReviewSchema,
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
      const mapped = mappedChapterIndices(authored.passages)
        .map((index) =>
          chapterWithPassage(index, authored.passages, authored.chapters),
        )
        .filter((chapter) => chapter !== null)
      // ...and only chapters whose reflection the corpus can actually serve.
      // Reserving one it cannot would wedge every automatic run on the same
      // chapter — see `chaptersWithReflectionSource` for why a failure repeats.
      const pool = chaptersWithReflectionSource(
        mapped,
        authored.corpora,
        sequence,
      )
      if (pool.length === 0) {
        throw new Error(
          "no catalogued chapter has a reflection source in the Workspace corpus",
        )
      }
      if (pool.length !== mapped.length) {
        console.log(
          `[devotional] event=chapter_pool_filtered mapped=${mapped.length} eligible=${pool.length} without_reflection=${mapped.length - pool.length}`,
        )
      }
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
  execute: async ({ inputData, mastra, runId, abortSignal }) => {
    try {
      await verifyWorkflowWorkspaceSources(mastra, inputData.selectedSources)
      const authored = await loadAttemptData(mastra, inputData.selectedSources)

      // Both the picker and the critics EXPLAIN themselves — which of the
      // author's points were kept and why, each critic's issues and suggestions,
      // the better-fitting verse when the chosen one is a poor match. None of it
      // fits the devotional's own shape, and both call sites used to omit this
      // seam entirely, so all of it was computed and dropped. Collected here and
      // written into the attempt artifact, so a run's reasoning outlives it.
      const notes: string[] = []
      const log = (message: string) => {
        notes.push(message)
      }

      const devotional = await composeDevotionalContent(
        {
          chapter: inputData.chapter,
          scripture: inputData.scripture,
          sequence: inputData.sequence,
          date: inputData.date,
          llm: scriptureLlm,
          log,
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
      // The critics run in BOTH modes. Report-only changes what happens to the
      // verdict, never whether it is produced — a mode that skipped the calls
      // would observe nothing, which is the opposite of the point.
      const enforced = isDevotionalQualityGateEnforced()
      const quality =
        safety.verdict === "pass"
          ? { ...(await reviewQuality()), enforced }
          : null

      // The gate CRASHING is the same class of fact as a critic that could not
      // run: we did not check. Turning it into a verdict rather than letting it
      // escape is what makes report-only mean what it says — a provider outage
      // must not cost the day's devotional while the false-positive rate is still
      // unknown. Under enforcement the same verdict blocks, which is the fail
      // closed posture; only the consequence differs, never the record.
      async function reviewQuality(): Promise<{ blocking: string[] }> {
        try {
          return await reviewDevotionalText({
            devotional,
            log,
            abortSignal,
            passageReference: inputData.chapter.reference,
            // The composed text here is English; the localized path that makes
            // fidelity meaningless was not carried into this runtime.
            checkFidelity: true,
          })
        } catch (error) {
          // Cancellation must NOT become a verdict. Turning it into a blocking
          // reason produces ordinary workflow data, and in report-only mode
          // blocking does not block — so a cancelled run continued to the paid
          // steps, which is the opposite of what threading the signal was for.
          if (abortSignal?.aborted) throw error
          const reason = error instanceof Error ? error.message : String(error)
          log(
            `[devotional] event=quality_gate_crashed enforced=${enforced} reason=${reason}`,
          )
          return { blocking: [`quality gate could not run: ${reason}`] }
        }
      }
      if (quality && quality.blocking.length > 0 && !enforced) {
        log(
          `[devotional] event=quality_gate_report_only blocking=${quality.blocking.length} ` +
            `reasons=${JSON.stringify(quality.blocking)}`,
        )
      }

      const filesystem = mastra.getWorkspace()?.filesystem
      if (!filesystem) throw new Error("Devotional Workspace is unavailable")
      await writeAttemptJsonArtifact({
        filesystem,
        runId,
        name: "content",
        value: { devotional, safety, quality, notes },
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
      //
      // In report-only mode the verdict is recorded and NOT acted on, so a critic
      // outage cannot cost a day's devotional while the false-positive rate is
      // still unknown. `enforced` travels with the verdict rather than being
      // re-read from env here, so a run's decision matches the mode it actually
      // ran under even if the flag flips mid-flight.
      const blocked = safety.verdict !== "pass" || qualityBlocksRun(quality)
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
      const { devotional, safety, quality, readyForRender } = inputData
      if (!readyForRender)
        return {
          ...attemptContext(inputData),
          devotional,
          safety,
          quality,
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
        quality,
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
      // Nothing to approve. The REASON is derived, not assumed: this note used to
      // say "safety blocked" unconditionally, so a quality-blocked run told the
      // approver the wrong gate stopped it. The third case matters too — assets
      // can be missing because a render failed, and naming a gate then would be
      // just as wrong.
      const reason =
        inputData.safety.verdict !== "pass"
          ? "safety blocked"
          : qualityBlocksRun(inputData.quality)
            ? "quality blocked"
            : "no rendered assets"
      return { ...inputData, approved: false, notes: `skipped: ${reason}` }
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
      quality,
      reservationId,
      portraitAsset,
      wideAsset,
      approved,
      notes,
      approvedBy,
    } = inputData
    let status: z.infer<typeof ResultSchema>["status"]
    let blockedBy: z.infer<typeof ResultSchema>["blockedBy"]
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
    // Quality is checked here too, not only in produceStep. produceStep stops the
    // paid work; this decides what the run REPORTS. Without the second branch a
    // quality-blocked run has safety "pass" and no rendered assets, so it fell
    // through to publish_failed / rendered_assets_missing and read as a render
    // bug. A null verdict means safety blocked, which the first branch owns.
    if (safety.verdict !== "pass") {
      status = "blocked"
      blockedBy = "safety"
    } else if (qualityBlocksRun(quality)) {
      status = "blocked"
      blockedBy = "quality"
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
      // Both optional in ResultSchema, so tsc stays quiet when they are
      // forgotten. They are the only way an operator can tell a quality block
      // from a safety block, and they also land in the publication artifact
      // below, so a run's reason survives past the logs.
      blockedBy,
      devotional,
      safety,
      quality,
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
