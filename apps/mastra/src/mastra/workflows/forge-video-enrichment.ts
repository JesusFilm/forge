import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  sendManagerEnrichmentCallback,
  type ManagerEnrichmentCallback,
} from "../../services/manager-enrichment-callback-client"

const RUN_ID_MAX_LENGTH = 128

const JobArtifactEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("downloadable") }).strict(),
  z
    .object({
      kind: z.literal("metadata"),
      data: z.record(z.string(), z.unknown()),
    })
    .strict(),
])

export const ForgeVideoEnrichmentInputSchema = z
  .object({
    jobId: z.string().min(1),
    assetId: z.string().min(1),
    muxAssetId: z.string().min(1),
    playbackId: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    translateTo: z.array(z.string().min(1)).optional(),
    runSceneAnalysis: z.boolean().optional(),
    runAudioCleanup: z.boolean().optional(),
    videoLabel: z.string().optional(),
    bibleVerses: z.array(z.string()).optional(),
    initialArtifacts: z.record(z.string(), JobArtifactEntrySchema).optional(),
    videoDocumentId: z.string().optional(),
    requestedTranscriptionProvider: z
      .enum(["automatic", "elevenlabs", "mux"])
      .optional(),
  })
  .strict()

const ForgeVideoEnrichmentOutputSchema = z
  .object({
    ok: z.literal(true),
    jobId: z.string(),
    runId: z.string(),
    acceptedAt: z.string(),
  })
  .strict()

export type ForgeVideoEnrichmentInput = z.infer<
  typeof ForgeVideoEnrichmentInputSchema
>
export type ForgeVideoEnrichmentOutput = z.infer<
  typeof ForgeVideoEnrichmentOutputSchema
>

type RouteHandlerInput = {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  configured: boolean
  callbackConfigured?: boolean
  readJson: () => Promise<unknown>
}

type StartRouteHandlerInput = RouteHandlerInput & {
  launch?: (
    input: ForgeVideoEnrichmentInput,
    options: { runId: string },
  ) => Promise<ForgeVideoEnrichmentOutput>
}

type WorkflowStartResult =
  | { status: "success"; result: ForgeVideoEnrichmentOutput }
  | { status: string }

type WorkflowRun = {
  start: (input: {
    inputData: ForgeVideoEnrichmentInput
  }) => Promise<WorkflowStartResult>
}

type WorkflowCreateRun = (options: { runId: string }) => Promise<WorkflowRun>

type LaunchOptions = {
  runId?: string
  createRun?: WorkflowCreateRun
  now?: () => string
  onBackgroundError?: (error: unknown) => void
}

type CallbackSender = (callback: ManagerEnrichmentCallback) => Promise<void>

export type ForgeVideoEnrichmentRouteOutcome = {
  status: number
  body: Record<string, unknown>
}

const ForgeVideoEnrichmentStartRequestSchema = z
  .object({
    runId: z.string().min(1).max(RUN_ID_MAX_LENGTH),
    input: ForgeVideoEnrichmentInputSchema,
  })
  .strict()

const acceptVideoEnrichmentStep = createStep({
  id: "accept-video-enrichment",
  inputSchema: ForgeVideoEnrichmentInputSchema,
  outputSchema: ForgeVideoEnrichmentOutputSchema,
  execute: async ({ inputData, runId }) => ({
    ok: true as const,
    jobId: inputData.jobId,
    runId,
    acceptedAt: new Date().toISOString(),
  }),
})

export class ForgeVideoEnrichmentNotImplementedError extends Error {
  constructor(readonly runId: string) {
    super("Mastra video enrichment workflow graph is not implemented yet")
    this.name = "ForgeVideoEnrichmentNotImplementedError"
  }
}

export async function reportForgeVideoEnrichmentNotImplemented(
  input: ForgeVideoEnrichmentOutput,
  sendCallback: CallbackSender = sendManagerEnrichmentCallback,
): Promise<never> {
  await sendCallback({
    jobId: input.jobId,
    engine: "mastra",
    runId: input.runId,
    sequence: 1,
    status: "running",
    step: "transcription",
  })

  await sendCallback({
    jobId: input.jobId,
    engine: "mastra",
    runId: input.runId,
    sequence: 2,
    status: "failed",
    step: "transcription",
    error: "Mastra video enrichment workflow graph is not implemented yet",
    jobStatus: "failed",
  })

  throw new ForgeVideoEnrichmentNotImplementedError(input.runId)
}

const failUntilVideoEnrichmentGraphExistsStep = createStep({
  id: "fail-until-video-enrichment-graph-exists",
  inputSchema: ForgeVideoEnrichmentOutputSchema,
  outputSchema: ForgeVideoEnrichmentOutputSchema,
  execute: async ({ inputData }) =>
    reportForgeVideoEnrichmentNotImplemented(inputData),
})

export const forgeVideoEnrichmentWorkflow = createWorkflow({
  id: "forge-video-enrichment",
  description:
    "Manager-triggered video enrichment workflow. Phase 1 callback producer and runId handoff.",
  inputSchema: ForgeVideoEnrichmentInputSchema,
  outputSchema: ForgeVideoEnrichmentOutputSchema,
})
  .then(acceptVideoEnrichmentStep)
  .then(failUntilVideoEnrichmentGraphExistsStep)
  .commit()

export class ForgeVideoEnrichmentWorkflowError extends Error {
  constructor(
    message: string,
    readonly runId: string,
  ) {
    super(message)
    this.name = "ForgeVideoEnrichmentWorkflowError"
  }
}

export async function launchForgeVideoEnrichmentWorkflow(
  input: ForgeVideoEnrichmentInput,
  options: LaunchOptions = {},
): Promise<ForgeVideoEnrichmentOutput> {
  const runId = options.runId ?? randomUUID()
  const createRun =
    options.createRun ??
    (async (runOptions) =>
      forgeVideoEnrichmentWorkflow.createRun(
        runOptions,
      ) as Promise<WorkflowRun>)
  const acceptedAt = options.now?.() ?? new Date().toISOString()
  const run = await createRun({ runId })

  try {
    const startPromise = run.start({ inputData: input })
    void startPromise
      .then((result) => {
        if (result.status !== "success") {
          throw new ForgeVideoEnrichmentWorkflowError(
            `forge-video-enrichment run ${runId} finished with status ${result.status}`,
            runId,
          )
        }
      })
      .catch((error: unknown) => {
        const handler =
          options.onBackgroundError ??
          ((backgroundError: unknown) => {
            console.error(
              `[forge-video-enrichment] event=background_failed jobId=${input.jobId} runId=${runId} error=${backgroundError instanceof Error ? backgroundError.message : "unknown"}`,
            )
          })
        handler(error)
      })
  } catch (error) {
    throw new ForgeVideoEnrichmentWorkflowError(
      `forge-video-enrichment run ${runId} failed to start: ${error instanceof Error ? error.message : "unknown"}`,
      runId,
    )
  }

  return {
    ok: true,
    jobId: input.jobId,
    runId,
    acceptedAt,
  }
}

export async function handleForgeVideoEnrichmentRouteRequest({
  authHeader,
  serviceKeys,
  configured,
  callbackConfigured = true,
  readJson,
}: RouteHandlerInput): Promise<ForgeVideoEnrichmentRouteOutcome> {
  if (!configured) {
    return {
      status: 503,
      body: { error: "config_missing: MASTRA_ENRICHMENT_API_KEYS not set" },
    }
  }

  if (!callbackConfigured) {
    return {
      status: 503,
      body: {
        error:
          "config_missing: MANAGER_ENRICHMENT_CALLBACK_URL and MANAGER_ENRICHMENT_CALLBACK_API_KEY must be set",
      },
    }
  }

  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const body = await readJson().catch(() => undefined)
  const parsed = ForgeVideoEnrichmentInputSchema.safeParse(body)
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Validation failed", details: parsed.error.flatten() },
    }
  }

  return {
    status: 202,
    body: { ok: true, runId: randomUUID() },
  }
}

export async function handleForgeVideoEnrichmentStartRouteRequest({
  authHeader,
  serviceKeys,
  configured,
  callbackConfigured = true,
  readJson,
  launch = launchForgeVideoEnrichmentWorkflow,
}: StartRouteHandlerInput): Promise<ForgeVideoEnrichmentRouteOutcome> {
  if (!configured) {
    return {
      status: 503,
      body: { error: "config_missing: MASTRA_ENRICHMENT_API_KEYS not set" },
    }
  }

  if (!callbackConfigured) {
    return {
      status: 503,
      body: {
        error:
          "config_missing: MANAGER_ENRICHMENT_CALLBACK_URL and MANAGER_ENRICHMENT_CALLBACK_API_KEY must be set",
      },
    }
  }

  if (!isValidServiceBearer({ authHeader, allowlist: serviceKeys })) {
    return {
      status: 401,
      body: { error: "Service bearer required" },
    }
  }

  const body = await readJson().catch(() => undefined)
  const parsed = ForgeVideoEnrichmentStartRequestSchema.safeParse(body)
  if (!parsed.success) {
    return {
      status: 400,
      body: { error: "Validation failed", details: parsed.error.flatten() },
    }
  }

  const { runId, input } = parsed.data
  try {
    const result = await launch(input, { runId })
    return {
      status: 202,
      body: { ok: true, runId: result.runId },
    }
  } catch (error) {
    console.error(
      `[forge-video-enrichment] event=start_failed jobId=${input.jobId} runId=${runId} error=${error instanceof Error ? error.message : "unknown"}`,
    )
    return {
      status: 502,
      body: { error: "forge-video-enrichment workflow failed to start" },
    }
  }
}
