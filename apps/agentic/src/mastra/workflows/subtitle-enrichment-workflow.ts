import { createStep, createWorkflow } from "@mastra/core/workflows"

import {
  startSubtitleEnrichmentRunRequestSchema,
  startSubtitleEnrichmentRunResponseSchema,
  type StartSubtitleEnrichmentRunRequest,
  type StartSubtitleEnrichmentRunResponse,
} from "@/contracts/subtitle-enrichment-run"

export const SUBTITLE_ENRICHMENT_WORKFLOW_ID = "subtitle-enrichment-workflow"

type SubtitleEnrichmentWorkflowDependencies = {
  managerBaseUrl?: string
  managerAgenticApiKey?: string
  requestTimeoutMs?: number
  fetcher?: typeof fetch
}

export async function launchSubtitleEnrichmentWorkflow(
  input: StartSubtitleEnrichmentRunRequest,
  dependencies: SubtitleEnrichmentWorkflowDependencies = {},
): Promise<StartSubtitleEnrichmentRunResponse> {
  const { managerBaseUrl, managerAgenticApiKey } = dependencies
  if (managerBaseUrl && managerAgenticApiKey) {
    const agenticRunId = subtitleEnrichmentRunId(input.idempotencyKey)
    try {
      await emitPrototypeSubtitleEvents(input, agenticRunId, {
        ...dependencies,
        managerBaseUrl,
        managerAgenticApiKey,
      })
    } catch {
      return {
        ok: false,
        code: "manager_unavailable",
        message: "Manager subtitle event callback was unavailable.",
      }
    }
  }

  return {
    ok: true,
    agenticRunId: subtitleEnrichmentRunId(input.idempotencyKey),
    managerJobId: input.jobId,
    status: "queued",
    summary: "Subtitle enrichment run queued.",
  }
}

export function createSubtitleEnrichmentWorkflow() {
  const queueSubtitleRunStep = createStep({
    id: "queue-subtitle-enrichment-run",
    description:
      "Queues an approved Manager subtitle enrichment job for Agentic execution.",
    inputSchema: startSubtitleEnrichmentRunRequestSchema,
    outputSchema: startSubtitleEnrichmentRunResponseSchema,
    execute: async ({ inputData }) =>
      launchSubtitleEnrichmentWorkflow(inputData),
  })

  return createWorkflow({
    id: SUBTITLE_ENRICHMENT_WORKFLOW_ID,
    inputSchema: startSubtitleEnrichmentRunRequestSchema,
    outputSchema: startSubtitleEnrichmentRunResponseSchema,
    steps: [queueSubtitleRunStep],
  })
    .then(queueSubtitleRunStep)
    .commit()
}

function subtitleEnrichmentRunId(idempotencyKey: string): string {
  return `subtitle-enrichment:${idempotencyKey}`
}

async function emitPrototypeSubtitleEvents(
  input: StartSubtitleEnrichmentRunRequest,
  agenticRunId: string,
  dependencies: Required<
    Pick<
      SubtitleEnrichmentWorkflowDependencies,
      "managerBaseUrl" | "managerAgenticApiKey"
    >
  > &
    SubtitleEnrichmentWorkflowDependencies,
) {
  const fetcher = dependencies.fetcher ?? fetch
  const occurredAt = new Date().toISOString()
  const events = [
    { type: "workflow_started", sequence: 1 },
    { type: "step_started", step: "transcription", sequence: 2 },
    { type: "step_completed", step: "transcription", sequence: 3 },
    { type: "step_started", step: "translation", sequence: 4 },
    { type: "step_completed", step: "translation", sequence: 5 },
    { type: "step_started", step: "mux_upload", sequence: 6 },
    { type: "step_completed", step: "mux_upload", sequence: 7 },
    { type: "workflow_completed", sequence: 8 },
  ] as const

  for (const event of events) {
    const response = await fetcher(
      `${dependencies.managerBaseUrl.replace(/\/+$/, "")}/api/agentic/subtitle-enrichment-runs/${encodeURIComponent(agenticRunId)}/events`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${dependencies.managerAgenticApiKey}`,
        },
        body: JSON.stringify({
          eventId: `${agenticRunId}:${event.sequence}`,
          runId: agenticRunId,
          jobId: input.jobId,
          idempotencyKey: input.idempotencyKey,
          sequence: event.sequence,
          occurredAt,
          type: event.type,
          ...("step" in event ? { step: event.step } : {}),
        }),
        signal: AbortSignal.timeout(dependencies.requestTimeoutMs ?? 60000),
      },
    )

    if (!response.ok) {
      throw new Error(`Manager callback failed with ${response.status}`)
    }
  }
}
