import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  runPrecomputedSource,
  SourceGenerationInputSchema,
} from "../../services/precomputed-recommendations/source-generation"

const resultSchema = z.object({
  state: z.enum(["complete", "failed", "replayed", "incomplete"]),
  generationId: z.string(),
  acceptedCount: z.number().int().nonnegative(),
  failureCode: z.string().optional(),
})

const step = createStep({
  id: "generate-precomputed-source",
  description:
    "Build one private Astra recommendation source from canonical Admin content and optional required history.",
  inputSchema: SourceGenerationInputSchema,
  outputSchema: resultSchema,
  execute: async ({ inputData }) => {
    const result = await runPrecomputedSource(inputData)
    if (result.state === "failed")
      throw new Error(`Precomputed source failed: ${result.failureCode}`)
    return result
  },
})

export const precomputedSourceGenerationWorkflow = createWorkflow({
  id: "precomputed-source-generation",
  description:
    "Private GPT-6 Astra source recommendation build; required history fails closed when unavailable.",
  inputSchema: SourceGenerationInputSchema,
  outputSchema: resultSchema,
})
  .then(step)
  .commit()

export async function handlePrecomputedSourceRouteRequest(input: {
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
