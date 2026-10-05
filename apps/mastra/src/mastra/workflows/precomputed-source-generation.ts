import { randomUUID } from "node:crypto"

import { createStep, createWorkflow } from "@mastra/core/workflows"
import { z } from "zod"

import { isValidServiceBearer } from "../../server/service-bearer"
import {
  runPrecomputedSource,
  SourceGenerationInputSchema,
  type SourceGenerationInput,
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
    "Build one private Astra recommendation source from canonical Admin content.",
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
  description: "Private, content-only GPT-6 Astra source recommendation build.",
  inputSchema: SourceGenerationInputSchema,
  outputSchema: resultSchema,
})
  .then(step)
  .commit()

async function boundedJson(request: Request): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") ?? "",
    )
  )
    throw new Error("invalid_json")
  const reader = request.body?.getReader()
  if (!reader) throw new Error("invalid_json")
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > 4_096) {
      await reader.cancel().catch(() => undefined)
      throw new Error("payload_too_large")
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new Error("invalid_json")
  }
}

export async function handlePrecomputedSourceRouteRequest(input: {
  authHeader: string | null | undefined
  serviceKeys: readonly string[]
  request: Request
  launch?: (input: SourceGenerationInput) => Promise<string>
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
      body: { error: "Invalid source generation request" },
    }
  }
  const parsed = SourceGenerationInputSchema.safeParse(raw)
  if (!parsed.success)
    return { status: 400, body: { error: "Invalid source generation request" } }
  try {
    const launch =
      input.launch ??
      (async (data: SourceGenerationInput) => {
        const runId = randomUUID()
        const run = await precomputedSourceGenerationWorkflow.createRun({
          runId,
        })
        await run.startAsync({ inputData: data })
        return runId
      })
    const runId = await launch(parsed.data)
    return {
      status: 202,
      body: { runId, generationId: parsed.data.generationId },
    }
  } catch {
    return { status: 503, body: { error: "Source generation unavailable" } }
  }
}
