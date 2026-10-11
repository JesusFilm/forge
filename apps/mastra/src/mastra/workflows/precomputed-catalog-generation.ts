import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  CatalogGenerationInputSchema,
  runPrecomputedCatalog,
} from "../../services/precomputed-recommendations/catalog-generation"

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
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (
    !isValidServiceBearer({
      authHeader: input.authHeader,
      allowlist: input.serviceKeys,
    })
  )
    return { status: 401, body: { error: "Service bearer required" } }
  return {
    status: 403,
    body: {
      error: "local_manual_operator_required",
      message: "Start or resume this generation from a local operator session.",
    },
  }
}
