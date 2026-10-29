import {
  ForgeVideoEnrichmentInputSchema,
  ForgeVideoEnrichmentOutputSchema,
  type ForgeVideoEnrichmentInput,
  type ForgeVideoEnrichmentOutput,
} from "../../server/forge-video-enrichment-contract"
export {
  ForgeVideoEnrichmentInputSchema,
  type ForgeVideoEnrichmentInput,
  type ForgeVideoEnrichmentOutput,
} from "../../server/forge-video-enrichment-contract"
export {
  handleForgeVideoEnrichmentRouteRequest,
  handleForgeVideoEnrichmentStartRouteRequest,
} from "../../server/forge-video-enrichment-routes"
import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"

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

import {
  runVideoEnrichmentGraph,
  type VideoEnrichmentGraphDeps,
} from "../../services/video-enrichment/graph"

export function createForgeVideoEnrichmentWorkflow(
  dependencies: Partial<VideoEnrichmentGraphDeps> = {},
) {
  const execute = createStep({
    id: "execute-video-enrichment",
    inputSchema: ForgeVideoEnrichmentInputSchema,
    outputSchema: ForgeVideoEnrichmentOutputSchema,
    execute: async ({ inputData, runId }) =>
      runVideoEnrichmentGraph(inputData, runId, dependencies),
  })
  return createWorkflow({
    id: "forge-video-enrichment",
    description:
      "Run-fenced Manager enrichment: source, correction, settled parallel enrichment, Mux publication and optional scene analysis.",
    inputSchema: ForgeVideoEnrichmentInputSchema,
    outputSchema: ForgeVideoEnrichmentOutputSchema,
  })
    .then(execute)
    .commit()
}
export const forgeVideoEnrichmentWorkflow = createForgeVideoEnrichmentWorkflow()

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
