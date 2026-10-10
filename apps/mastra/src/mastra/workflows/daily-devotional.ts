import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { getDevotionalModel, getDevotionalSafetyModel } from "../../config/env"
import { isValidServiceBearer } from "../../server/service-bearer"
import {
  DevotionalArtifactError,
  DevotionalSchema,
  SafetyVerdictSchema,
  createDevotionalArtifactStore,
  type DevotionalArtifactStore,
} from "../../services/devotional/artifacts"
import {
  createDevotionalLlm,
  DevotionalLlmError,
  type DevotionalLlm,
} from "../../services/devotional/llm"
import { pickHook } from "../../services/devotional/hook-picker"
import { selectScripture } from "../../services/devotional/scripture-selector"
import { matchVideo } from "../../services/devotional/video-matcher"
import { writeDevotional } from "../../services/devotional/devotional-writer"
import { evaluateSafety } from "../../services/devotional/safety-gate"
import { publishDevotional } from "../../services/devotional/site-publish-client"
import { generateVoiceover } from "../../services/devotional/voiceover"
import type {
  Devotional,
  DevotionalReport,
  Hook,
  SafetyVerdict,
  ScriptureRef,
  VideoClip,
  VideoMatchSource,
  VoiceoverInfo,
} from "../../services/devotional/types"

export const DailyDevotionalWorkflowInputSchema = z
  .object({
    /** YYYY-MM-DD; defaults to today. The per-day idempotency key. */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
    persistArtifact: z.boolean().default(true),
  })
  .strict()

export type DailyDevotionalWorkflowInput = z.infer<
  typeof DailyDevotionalWorkflowInputSchema
>

const WorkflowSuccessSchema = z
  .object({
    ok: z.literal(true),
    mastraRunId: z.string(),
    date: z.string(),
    published: z.boolean(),
    videoMatch: z.enum(["search", "fallback", "none"]),
    safety: SafetyVerdictSchema,
    devotional: DevotionalSchema,
    artifactPath: z.string().optional(),
    /** Store-relative path of the generated narration MP3, when voiceover ran. */
    voiceoverPath: z.string().optional(),
  })
  .strict()

const WorkflowFailureSchema = z
  .object({
    ok: z.literal(false),
    reason: z.enum([
      "invalid_input",
      "config_missing",
      "generation_failed",
      "artifact_failed",
    ]),
    retryable: z.boolean(),
    mastraRunId: z.string(),
    stage: z.string().optional(),
    details: z.string().optional(),
  })
  .strict()

export const DailyDevotionalWorkflowOutputSchema = z.discriminatedUnion("ok", [
  WorkflowSuccessSchema,
  WorkflowFailureSchema,
])

export type DailyDevotionalWorkflowResult = z.infer<
  typeof DailyDevotionalWorkflowOutputSchema
>
type DailyDevotionalWorkflowFailure = z.infer<typeof WorkflowFailureSchema>

// --- Injectable seams (each defaults to the real service) ------------------

export type DailyDevotionalDeps = {
  runId?: string
  now?: () => Date
  pickHook?: typeof pickHook
  selectScripture?: typeof selectScripture
  matchVideo?: typeof matchVideo
  writeDevotional?: typeof writeDevotional
  evaluateSafety?: typeof evaluateSafety
  publish?: typeof publishDevotional
  generateVoiceover?: typeof generateVoiceover
  artifactStore?: DevotionalArtifactStore
  /** Override the generation/safety LLMs (tests inject fakes). */
  llm?: DevotionalLlm
  safetyLlm?: DevotionalLlm
}

function failure(
  reason: DailyDevotionalWorkflowFailure["reason"],
  options: {
    mastraRunId: string
    retryable: boolean
    stage?: string
    details?: string
  },
): DailyDevotionalWorkflowFailure {
  return {
    ok: false,
    reason,
    retryable: options.retryable,
    mastraRunId: options.mastraRunId,
    ...(options.stage ? { stage: options.stage } : {}),
    ...(options.details ? { details: options.details } : {}),
  }
}

function dateFromInput(
  input: DailyDevotionalWorkflowInput,
  now: () => Date,
): string {
  return input.date ?? now().toISOString().slice(0, 10)
}

/**
 * Core orchestration — fully injectable, used by both the route/launch path and
 * unit tests. Returns a discriminated-union result rather than throwing. The
 * workflow publishes ONLY when the safety gate passes; a blocked devotional is
 * a success with `published: false` and a persisted blocked report. Publishing
 * is best-effort (a publish failure never fails the run). Idempotent per date:
 * if a published report already exists for the date, publishing is skipped.
 */
export async function runDailyDevotional(
  rawInput: unknown,
  deps: DailyDevotionalDeps = {},
): Promise<DailyDevotionalWorkflowResult> {
  const mastraRunId = deps.runId ?? randomUUID()
  const now = deps.now ?? (() => new Date())

  const parsedInput = DailyDevotionalWorkflowInputSchema.safeParse(rawInput)
  if (!parsedInput.success) {
    return failure("invalid_input", { mastraRunId, retryable: false })
  }
  const input = parsedInput.data
  const date = dateFromInput(input, now)

  // Build the LLMs (missing credentials => config_missing, never a crash).
  let llm = deps.llm
  let safetyLlm = deps.safetyLlm
  try {
    llm = llm ?? createDevotionalLlm({ model: getDevotionalModel() })
    safetyLlm =
      safetyLlm ?? createDevotionalLlm({ model: getDevotionalSafetyModel() })
  } catch (error) {
    if (
      error instanceof DevotionalLlmError &&
      error.code === "missing_credentials"
    ) {
      return failure("config_missing", {
        mastraRunId,
        retryable: false,
        details: error.message,
      })
    }
    throw error
  }

  const pickHookFn = deps.pickHook ?? pickHook
  const selectScriptureFn = deps.selectScripture ?? selectScripture
  const matchVideoFn = deps.matchVideo ?? matchVideo
  const writeDevotionalFn = deps.writeDevotional ?? writeDevotional
  const evaluateSafetyFn = deps.evaluateSafety ?? evaluateSafety
  const publishFn = deps.publish ?? publishDevotional
  const generateVoiceoverFn = deps.generateVoiceover ?? generateVoiceover
  const artifactStore = deps.artifactStore ?? createDevotionalArtifactStore()

  // Read any prior report for this date up front. Idempotency is per date: if
  // this date was already published, regenerate nothing and return the stored
  // devotional unchanged — never overwrite live (possibly human-edited) content
  // and never re-publish. Only a genuine "not found" counts as a first run; any
  // other read error is surfaced rather than silently treated as first run
  // (which would otherwise re-publish over an existing day).
  let existing: DevotionalReport | null = null
  try {
    existing = await artifactStore.readReport(date)
  } catch (error) {
    if (
      error instanceof DevotionalArtifactError &&
      error.code === "not_found"
    ) {
      existing = null
    } else {
      return failure("artifact_failed", {
        mastraRunId,
        retryable: true,
        details: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (
    existing &&
    existing.published &&
    existing.devotional &&
    existing.safety
  ) {
    return {
      ok: true,
      mastraRunId,
      date,
      published: true,
      videoMatch: existing.videoMatch,
      safety: existing.safety,
      devotional: existing.devotional,
    }
  }

  const startedAt = now().toISOString()

  let stage = "pick-hook"
  let devotional: Devotional
  let safety: SafetyVerdict
  try {
    const hook: Hook = await pickHookFn({ date, llm })
    stage = "select-scripture"
    const scripture: ScriptureRef = await selectScriptureFn({ hook, llm })
    stage = "match-video"
    const videoResult = await matchVideoFn({ scripture, hook })
    const video: VideoClip | null = videoResult.video
    const videoMatch: VideoMatchSource = videoResult.videoMatch
    stage = "write-devotional"
    devotional = await writeDevotionalFn({
      date,
      hook,
      scripture,
      video,
      videoMatch,
      llm,
    })
    stage = "safety-gate"
    safety = await evaluateSafetyFn({ devotional, llm: safetyLlm })
  } catch (error) {
    return failure("generation_failed", {
      mastraRunId,
      retryable: true,
      stage,
      details: error instanceof Error ? error.message : String(error),
    })
  }

  // Publish ONLY on a safety pass. The short-circuit above already returned for
  // an already-published date, so here the date is not yet published — always
  // attempt. Best-effort: a publish failure never fails the run. Per-date
  // publish idempotency ultimately relies on the watch-site ingest deduping by
  // date (assumption A7); if the post-publish artifact write fails, a cron retry
  // re-attempts publish and the site absorbs the duplicate.
  let published = false
  if (safety.verdict === "pass") {
    const result = await publishFn({ devotional })
    published = result.ok ? result.published : false
  }

  // Generate narration audio for a safety-passed devotional. Best-effort, same
  // gate as publish: any voiceover or persist failure leaves `voiceover: null`
  // and never fails the run (config_missing simply means Azure TTS is not set
  // up). Persist BEFORE recording so the report only ever references audio that
  // actually landed on disk.
  let voiceover: VoiceoverInfo | null = null
  if (safety.verdict === "pass") {
    try {
      const result = await generateVoiceoverFn({ devotional })
      if (result.ok) {
        const written = await artifactStore.writeAudio(date, result.audio.bytes)
        voiceover = {
          format: result.audio.format,
          voice: result.audio.voice,
          locale: result.audio.locale,
          characterCount: result.audio.characterCount,
          artifactPath: written.relativePath,
        }
      }
    } catch {
      voiceover = null
    }
  }

  const finishedAt = now().toISOString()

  let artifactPath: string | undefined
  if (input.persistArtifact) {
    const report: DevotionalReport = {
      schemaVersion: "1",
      kind: "daily-devotional",
      reportId: date,
      mastraRunId,
      date,
      startedAt,
      finishedAt,
      published,
      videoMatch: devotional.videoMatch,
      safety,
      devotional,
      voiceover,
    }
    try {
      const written = await artifactStore.writeReport(report)
      artifactPath = written.path
    } catch (error) {
      const retryable =
        !(error instanceof DevotionalArtifactError) ||
        error.code === "write_failed" ||
        error.code === "read_failed"
      return failure("artifact_failed", {
        mastraRunId,
        retryable,
        details: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    ok: true,
    mastraRunId,
    date,
    published,
    videoMatch: devotional.videoMatch,
    safety,
    devotional,
    ...(artifactPath ? { artifactPath } : {}),
    ...(voiceover ? { voiceoverPath: voiceover.artifactPath } : {}),
  }
}

// --- Mastra workflow (Studio-facing) ---------------------------------------
//
// A single orchestrating step runs the full pipeline. The rich Devotional
// object only crosses the serialization boundary once (as the result), which
// is simpler and safer than threading Hook/Scripture/Video across six steps.

const runStep = createStep({
  id: "run-daily-devotional",
  description:
    "Pick a hook, choose scripture, match a clip, write, safety-gate, then publish + persist.",
  inputSchema: DailyDevotionalWorkflowInputSchema,
  outputSchema: DailyDevotionalWorkflowOutputSchema,
  execute: async ({ inputData, runId }) =>
    runDailyDevotional(inputData, { runId }),
})

export const dailyDevotionalWorkflow = createWorkflow({
  id: "daily-devotional",
  description:
    "Generate one timely, scripture-centered daily devotional and auto-publish it after a safety check.",
  inputSchema: DailyDevotionalWorkflowInputSchema,
  outputSchema: DailyDevotionalWorkflowOutputSchema,
})
  .then(runStep)
  .commit()

export async function launchDailyDevotionalWorkflow(
  rawInput: unknown,
  options: { runId?: string } = {},
): Promise<DailyDevotionalWorkflowResult> {
  const runId = options.runId ?? randomUUID()
  const parsed = DailyDevotionalWorkflowInputSchema.safeParse(rawInput)
  if (!parsed.success) {
    return failure("invalid_input", { mastraRunId: runId, retryable: false })
  }

  try {
    const run = await dailyDevotionalWorkflow.createRun({ runId })
    const result = await run.start({ inputData: parsed.data })
    if (result.status === "success") return result.result
    return failure("generation_failed", { mastraRunId: runId, retryable: true })
  } catch (error) {
    return failure("generation_failed", {
      mastraRunId: runId,
      retryable: true,
      details: error instanceof Error ? error.message : String(error),
    })
  }
}

// --- Route handler ----------------------------------------------------------

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  readJson: () => Promise<unknown>
  launch?: (
    input: unknown,
    options: { runId: string },
  ) => Promise<DailyDevotionalWorkflowResult>
}

export type DailyDevotionalRouteOutcome = {
  status: number
  body: { result?: DailyDevotionalWorkflowResult; error?: string }
}

function routeStatusForResult(result: DailyDevotionalWorkflowResult): number {
  if (result.ok) return 200
  if (result.reason === "invalid_input") return 400
  if (result.reason === "config_missing") return 503
  if (result.reason === "artifact_failed") return 500
  return 502
}

export async function handleDailyDevotionalRouteRequest({
  authHeader,
  serviceKeys,
  readJson,
  launch = launchDailyDevotionalWorkflow,
}: RouteHandlerInput): Promise<DailyDevotionalRouteOutcome> {
  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return { status: 401, body: { error: "Service bearer required" } }
  }

  const runId = randomUUID()
  const body = await readJson().catch(() => undefined)
  const result =
    body === undefined
      ? failure("invalid_input", { mastraRunId: runId, retryable: false })
      : await launch(body, { runId }).catch((error: unknown) =>
          failure("generation_failed", {
            mastraRunId: runId,
            retryable: true,
            details: error instanceof Error ? error.message : String(error),
          }),
        )

  return { status: routeStatusForResult(result), body: { result } }
}

export const _internals = { dateFromInput, routeStatusForResult }
