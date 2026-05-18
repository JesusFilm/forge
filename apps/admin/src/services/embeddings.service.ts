import type { PrismaClient } from "@prisma/client"
import { z } from "zod"
import { canWriteDerived } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import { env } from "@/config/env"
import { prisma as defaultPrisma } from "@/db/client"
import { BlockSchema } from "@/domain/blocks"
import { toPgVector } from "@/db/pgvector"

export const EXPERIENCE_EMBEDDING_DIMENSIONS = 1536
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small"

/**
 * Hard timeout for provider requests. Node's default fetch has no
 * request timeout; without an AbortSignal a stuck connection blocks
 * indefinitely — catastrophic inside a long-running backfill that
 * fans out across many scenes.
 */
const EMBEDDING_REQUEST_TIMEOUT_MS = 30_000

const BLOCK_TEXT_IGNORE_KEY =
  /(?:^t$|url$|Url$|link$|Link$|Id$|Color$|variant$|itemsSource$|iframeSrc$|sectionKey$|headingLevel$|locale$|icon$)/i

const EmbeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        embedding: z.array(z.number().finite()),
      }),
    )
    .min(1),
})

export type ExperienceEmbeddingLocaleInput = {
  title?: string | null
  metaDescription?: string | null
  ogTitle?: string | null
  ogDescription?: string | null
  blocks: unknown
}

export type GeneratedEmbedding = {
  model: string
  dimensions: number
  embedding: number[]
}

export type GeneratedEmbeddings = {
  model: string
  dimensions: number
  /** Embeddings in input-array order: `embeddings[i]` corresponds to `inputs[i]`. */
  embeddings: number[][]
}

/**
 * Typed errors from the batched embedding call so callers can branch on
 * `instanceof EmbeddingsBatchError && error.code === "..."` instead of
 * regex-matching the message. The scene indexer relies on this — a
 * length-or-dimension mismatch must fail-fast for the whole
 * `(video, locale)` target rather than partial-write.
 */
export class EmbeddingsBatchError extends Error {
  constructor(
    readonly code:
      | "empty_input"
      | "missing_credentials"
      | "request_failed"
      | "request_timed_out"
      | "validation_failed"
      | "length_mismatch"
      | "dimension_mismatch",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "EmbeddingsBatchError"
  }
}

function normalizeLine(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function pushLine(
  lines: string[],
  seen: Set<string>,
  value: string | null | undefined,
) {
  if (!value) return
  const line = normalizeLine(value)
  if (!line || seen.has(line)) return
  seen.add(line)
  lines.push(line)
}

function collectBlockText(
  value: unknown,
  lines: string[],
  seen: Set<string>,
  parentKey?: string,
) {
  if (typeof value === "string") {
    if (parentKey && BLOCK_TEXT_IGNORE_KEY.test(parentKey)) {
      return
    }
    pushLine(lines, seen, value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectBlockText(item, lines, seen, parentKey)
    }
    return
  }

  if (value != null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      collectBlockText(nested, lines, seen, key)
    }
  }
}

function embeddingEndpointFromBase(baseUrl: string): string {
  return new URL("embeddings", `${baseUrl.replace(/\/$/, "")}/`).toString()
}

export function buildExperienceEmbeddingText(
  locale: ExperienceEmbeddingLocaleInput,
): string {
  const lines: string[] = []
  const seen = new Set<string>()

  pushLine(lines, seen, locale.title)
  pushLine(lines, seen, locale.metaDescription)
  pushLine(lines, seen, locale.ogTitle)
  pushLine(lines, seen, locale.ogDescription)

  const parsedBlocks = z.array(BlockSchema).safeParse(locale.blocks)
  collectBlockText(
    parsedBlocks.success ? parsedBlocks.data : locale.blocks,
    lines,
    seen,
  )

  if (lines.length === 0) {
    throw new Error("ExperienceLocale has no text content to embed")
  }

  return lines.join("\n\n")
}

type EmbeddingProvider = {
  apiKey: string
  model: string
  url: string
}

function selectProvider(): EmbeddingProvider {
  if (env.OPENROUTER_API_KEY) {
    return {
      apiKey: env.OPENROUTER_API_KEY,
      model: OPENROUTER_EMBEDDING_MODEL,
      url: "https://openrouter.ai/api/v1/embeddings",
    }
  }
  if (env.OPENAI_API_KEY) {
    return {
      apiKey: env.OPENAI_API_KEY,
      model: OPENAI_EMBEDDING_MODEL,
      url: embeddingEndpointFromBase(
        env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      ),
    }
  }
  throw new EmbeddingsBatchError(
    "missing_credentials",
    "OPENROUTER_API_KEY or OPENAI_API_KEY is required for embedding generation",
  )
}

/**
 * Issue ONE embedding request that batches every input. Returns
 * embeddings in input-array order — `embeddings[i]` corresponds to
 * `inputs[i]`. Stage 2 of the embed-backfill performance plan: scene
 * backfill collapses one provider call per scene to one provider call
 * per `(video, locale)` target.
 *
 * Fail-fast on length mismatch (provider returned a different number of
 * vectors) or dimension mismatch (any vector ≠ 1536). Both shape errors
 * surface as `EmbeddingsBatchError` with a typed `code`; the scene
 * indexer's outer try/catch demotes the whole `(video, locale)` target
 * to `failed` rather than partial-write — preserves correctness on the
 * tail while still capturing the 99% happy path in a single round-trip.
 */
export async function generateExperienceEmbeddings(
  inputs: readonly string[],
): Promise<GeneratedEmbeddings> {
  if (inputs.length === 0) {
    throw new EmbeddingsBatchError(
      "empty_input",
      "Embedding inputs must not be empty",
    )
  }

  const normalized: string[] = []
  for (let i = 0; i < inputs.length; i += 1) {
    const line = normalizeLine(inputs[i]!)
    if (!line) {
      throw new EmbeddingsBatchError(
        "empty_input",
        `Embedding input at index ${i} is empty after normalization`,
      )
    }
    normalized.push(line)
  }

  const provider = selectProvider()

  const controller = new AbortController()
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    EMBEDDING_REQUEST_TIMEOUT_MS,
  )
  let response: Response
  try {
    response = await fetch(provider.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${provider.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        input: normalized,
        encoding_format: "float",
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new EmbeddingsBatchError(
        "request_timed_out",
        `Embedding request timed out after ${EMBEDDING_REQUEST_TIMEOUT_MS}ms`,
        error,
      )
    }
    throw error
  } finally {
    clearTimeout(timeoutHandle)
  }

  if (!response.ok) {
    throw new EmbeddingsBatchError(
      "request_failed",
      `Embedding request failed with status ${response.status}`,
    )
  }

  const parsed = EmbeddingResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new EmbeddingsBatchError(
      "validation_failed",
      "Embedding response validation failed",
    )
  }

  if (parsed.data.data.length !== normalized.length) {
    throw new EmbeddingsBatchError(
      "length_mismatch",
      `Embedding response returned ${parsed.data.data.length} vectors for ${normalized.length} inputs`,
    )
  }

  const embeddings: number[][] = []
  for (let i = 0; i < parsed.data.data.length; i += 1) {
    const embedding = parsed.data.data[i]!.embedding
    if (embedding.length !== EXPERIENCE_EMBEDDING_DIMENSIONS) {
      throw new EmbeddingsBatchError(
        "dimension_mismatch",
        `Embedding ${i} returned ${embedding.length} dimensions; expected ${EXPERIENCE_EMBEDDING_DIMENSIONS}`,
      )
    }
    embeddings.push(embedding)
  }

  return {
    model: provider.model,
    dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    embeddings,
  }
}

/**
 * Single-input convenience wrapper around the batched form. Preserves
 * the original error message ("Embedding input must not be empty") for
 * back-compat with non-batched callers (hybrid search, experience
 * embedding pipeline) that catch on that string today. The batched
 * form's typed errors only surface to callers that opt in.
 */
export async function generateExperienceEmbedding(
  text: string,
): Promise<GeneratedEmbedding> {
  const normalizedText = normalizeLine(text)
  if (!normalizedText) {
    throw new Error("Embedding input must not be empty")
  }
  const result = await generateExperienceEmbeddings([normalizedText])
  return {
    model: result.model,
    dimensions: result.dimensions,
    embedding: result.embeddings[0]!,
  }
}

export async function writeExperienceLocaleEmbedding({
  prisma,
  localeId,
  embedding,
  user,
}: {
  prisma: Pick<PrismaClient, "$executeRaw">
  localeId: string
  embedding: readonly number[]
  user: Principal | null
}): Promise<void> {
  if (!canWriteDerived(user)) {
    throw new Error("Forbidden: derived writes require SYSTEM or ADMIN")
  }

  await prisma.$executeRaw`
    UPDATE experience_locale
    SET embedding = ${toPgVector(embedding)}::vector,
        updated_at = NOW()
    WHERE id = ${localeId}
  `
}

/**
 * End-to-end per-locale embedding work as a plain async service
 * function: load → flatten text → generate vector → persist.
 *
 * Shared by:
 *   - `runExperienceEmbedding` (workflow) — wraps this in a single
 *     `"use step"` so step-replay semantics apply when dispatched via
 *     the production workflow runtime.
 *   - `runExperienceEmbeddingBackfill` (workflow) — calls this from its
 *     per-target step body so the loop never nests `start()` calls.
 *     Mirrors the R1/R2 pattern (`indexEditionScenes`,
 *     `indexEditionTranscript`) where the workflow step body invokes a
 *     plain service function rather than dispatching a sibling workflow.
 *
 * Returns the dimensions + model used so the caller can include them
 * in operator-facing reports. Throws on any failure (load missing,
 * provider error, persistence error) — callers wrap with their own
 * try/catch + typed-outcome shaping.
 */
export type EmbedExperienceLocaleResult = {
  localeId: string
  dimensions: number
  model: string
}

export async function embedExperienceLocale(
  localeId: string,
  options?: { prisma?: PrismaClient },
): Promise<EmbedExperienceLocaleResult> {
  const client = options?.prisma ?? defaultPrisma
  const locale = await client.experienceLocale.findUniqueOrThrow({
    where: { id: localeId },
    select: {
      id: true,
      title: true,
      metaDescription: true,
      ogTitle: true,
      ogDescription: true,
      blocks: true,
    },
  })
  const text = buildExperienceEmbeddingText(locale)
  const generated = await generateExperienceEmbedding(text)
  await writeExperienceLocaleEmbedding({
    prisma: client,
    localeId,
    embedding: generated.embedding,
    user: SYSTEM_PRINCIPAL,
  })
  return {
    localeId,
    dimensions: generated.dimensions,
    model: generated.model,
  }
}
