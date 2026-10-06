import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  CatalogGenerationInputSchema,
  runPrecomputedCatalog,
  type CatalogGenerationInput,
} from "../../services/precomputed-recommendations/catalog-generation"
import { boundedJson } from "./precomputed-source-generation"

const resultSchema = z.object({
  state: z.enum(["complete", "incomplete", "failed", "replayed"]),
  generationId: z.string(),
  completedSourceCount: z.number().int().nonnegative(),
  failedSourceCount: z.number().int().nonnegative(),
})

const step = createStep({
  id: "build-precomputed-catalog",
  description: "Resume a private catalog generation from durable Admin claims.",
  inputSchema: CatalogGenerationInputSchema,
  outputSchema: resultSchema,
  execute: async ({ inputData }) => runPrecomputedCatalog(inputData),
})

export const precomputedCatalogGenerationWorkflow = createWorkflow({
  id: "precomputed-catalog-generation",
  description:
    "Private GPT-6 Astra catalog build and manual refresh, with no automatic schedule or public activation.",
  inputSchema: CatalogGenerationInputSchema,
  outputSchema: resultSchema,
})
  .then(step)
  .commit()

export async function handlePrecomputedCatalogRouteRequest(input: {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  request: Request
  launch?: (input: CatalogGenerationInput) => Promise<string>
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (
    !isValidServiceBearer({
      authHeader: input.authHeader,
      allowlist: input.serviceKeys,
    })
  )
    return { status: 401, body: { error: "Service bearer required" } }
  let raw: unknown
  try {
    raw = await boundedJson(input.request)
  } catch (error) {
    return {
      status:
        error instanceof Error && error.message === "payload_too_large"
          ? 413
          : 400,
      body: { error: "Invalid catalog generation request" },
    }
  }
  const parsed = CatalogGenerationInputSchema.safeParse(raw)
  if (!parsed.success)
    return {
      status: 400,
      body: { error: "Invalid catalog generation request" },
    }
  try {
    const launch =
      input.launch ??
      (async (data: CatalogGenerationInput) => {
        const runId = randomUUID()
        const run = await precomputedCatalogGenerationWorkflow.createRun({
          runId,
        })
        await run.startAsync({
          inputData: data,
          tracingOptions: {
            hideInput: true,
            hideOutput: true,
            metadata: {
              precomputedGenerationId: data.generationId,
              precomputedInputCutoff: data.inputCutoff,
              precomputedHistoryRequired: data.historyRequired,
            },
          },
        })
        return runId
      })
    const runId = await launch(parsed.data)
    return {
      status: 202,
      body: { runId, generationId: parsed.data.generationId },
    }
  } catch {
    return { status: 503, body: { error: "Catalog generation unavailable" } }
  }
}
