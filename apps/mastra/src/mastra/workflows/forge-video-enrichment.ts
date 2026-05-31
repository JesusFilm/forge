import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"

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
  readJson: () => Promise<unknown>
  launch?: (
    input: ForgeVideoEnrichmentInput,
    options: { runId: string },
  ) => Promise<ForgeVideoEnrichmentOutput>
}

export type ForgeVideoEnrichmentRouteOutcome = {
  status: number
  body: Record<string, unknown>
}

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

export const forgeVideoEnrichmentWorkflow = createWorkflow({
  id: "forge-video-enrichment",
  description:
    "Manager-triggered video enrichment workflow. Phase 1 route contract and runId handoff.",
  inputSchema: ForgeVideoEnrichmentInputSchema,
  outputSchema: ForgeVideoEnrichmentOutputSchema,
})
  .then(acceptVideoEnrichmentStep)
  .commit()

export async function launchForgeVideoEnrichmentWorkflow(
  input: ForgeVideoEnrichmentInput,
  options: { runId?: string } = {},
): Promise<ForgeVideoEnrichmentOutput> {
  const runId = options.runId ?? randomUUID()
  const run = await forgeVideoEnrichmentWorkflow.createRun({ runId })
  const result = await run.start({ inputData: input })
  if (result.status === "success") {
    return result.result
  }

  throw new Error(`forge-video-enrichment run ${runId} failed to start`)
}

export async function handleForgeVideoEnrichmentRouteRequest({
  authHeader,
  serviceKeys,
  configured,
  readJson,
  launch = launchForgeVideoEnrichmentWorkflow,
}: RouteHandlerInput): Promise<ForgeVideoEnrichmentRouteOutcome> {
  if (!configured) {
    return {
      status: 503,
      body: { error: "config_missing: MASTRA_ENRICHMENT_API_KEYS not set" },
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

  const runId = randomUUID()
  void launch(parsed.data, { runId }).catch((error) => {
    console.error(
      `[forge-video-enrichment] event=start_failed jobId=${parsed.data.jobId} runId=${runId} error=${error instanceof Error ? error.message : "unknown"}`,
    )
  })

  return {
    status: 202,
    body: { ok: true, runId },
  }
}
