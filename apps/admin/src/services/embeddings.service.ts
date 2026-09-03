import { createHash } from "node:crypto"
import type { Prisma, PrismaClient } from "@prisma/client"
import { z } from "zod"
import { canWriteDerived } from "@/auth/permissions"
import type { Principal } from "@/auth/principal"
import { env } from "@/config/env"
import { BlockSchema } from "@/domain/blocks"
import { toPgVector } from "@/db/pgvector"
import {
  ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
  contentEmbeddingTupleMatches,
  resolveActiveContentEmbeddingContract,
  type ContentEmbeddingTuple,
} from "./content-embedding-contract"

export const EXPERIENCE_EMBEDDING_DIMENSIONS =
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS
export const OPENROUTER_EMBEDDING_MODEL = ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL
export const FIREWORKS_EMBEDDING_MODEL = "fireworks/qwen3-embedding-8b"
const OPENROUTER_EMBEDDING_PROVIDER = "SiliconFlow"
const FIREWORKS_EMBEDDING_BASE_URL =
  "https://api.fireworks.ai/inference/v1/embeddings"

/**
 * Hard timeout for provider requests. Node's default fetch has no
 * request timeout; without an AbortSignal a stuck connection blocks
 * indefinitely — catastrophic inside a long-running backfill that
 * fans out across many scenes.
 */
const EMBEDDING_REQUEST_TIMEOUT_MS = 30_000
const SINGLE_EMBEDDING_REQUEST_TIMEOUT_MS = 1_000
const SINGLE_EMBEDDING_REQUEST_ATTEMPTS = 1

const BLOCK_TEXT_IGNORE_KEY =
  /(?:^t$|url$|Url$|link$|Link$|Id$|Color$|variant$|orientation$|itemsSource$|iframeSrc$|sectionKey$|headingLevel$|locale$|icon$)/i

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

export type ExperienceEmbeddingGenerationMode =
  | "idempotent"
  | "repair"
  | "force"
  | "model-upgrade"

export type ExperienceEmbeddingSource = {
  text: string
  contentHash: string
  summary: string
}

export type ExperienceEmbeddingProvenance = {
  sourceContentHash: string
  sourceSummary: string
  model: string
  dimensions: number
  provider?: string
  nativeDimensions?: number
  transformVersion?: string
  generationMode: ExperienceEmbeddingGenerationMode
  mastraRunId: string
  generatedAt: string
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
      | "contract_mismatch"
      | "contract_unavailable"
      | "request_failed"
      | "request_timed_out"
      | "validation_failed"
      | "length_mismatch"
      | "dimension_mismatch",
    message: string,
    readonly cause?: unknown,
    readonly status?: number,
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

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

export function buildExperienceEmbeddingSource(
  locale: ExperienceEmbeddingLocaleInput,
): ExperienceEmbeddingSource {
  const text = buildExperienceEmbeddingText(locale)
  const lines = text.split(/\n+/).filter((line) => line.trim().length > 0)
  return {
    text,
    contentHash: sha256Text(text),
    summary: [
      `chars=${text.length}`,
      `lines=${lines.length}`,
      `title=${locale.title ? "present" : "absent"}`,
      `meta=${locale.metaDescription ? "present" : "absent"}`,
      `og=${locale.ogTitle || locale.ogDescription ? "present" : "absent"}`,
    ].join(";"),
  }
}

type EmbeddingProvider = {
  id: "openrouter" | "fireworks"
  apiKey: string
  model: string
  url: string
  dimensions?: number
  routing?: {
    only: string[]
    allow_fallbacks: boolean
    require_parameters: boolean
  }
}

export type EmbeddingProviderIdentity = {
  provider: EmbeddingProvider["id"]
  model: string
  nativeDimensions: number
  dimensions: number
  transformVersion: string | null
}

type EmbeddingProviderResult =
  | {
      ok: true
      body: unknown
    }
  | {
      ok: false
      status: number
    }

function openRouterProvider(): EmbeddingProvider | null {
  const openRouterApiKey = env.OPENROUTER_API_PAID_KEY ?? env.OPENROUTER_API_KEY
  if (!openRouterApiKey) return null

  return {
    id: "openrouter",
    apiKey: openRouterApiKey,
    model: OPENROUTER_EMBEDDING_MODEL,
    url: "https://openrouter.ai/api/v1/embeddings",
    dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    routing: {
      only: [OPENROUTER_EMBEDDING_PROVIDER],
      allow_fallbacks: false,
      require_parameters: true,
    },
  }
}

function fireworksProvider(): EmbeddingProvider | null {
  if (!env.FIREWORKS_API_KEY) return null

  return {
    id: "fireworks",
    apiKey: env.FIREWORKS_API_KEY,
    model: env.FIREWORKS_EMBEDDING_MODEL ?? FIREWORKS_EMBEDDING_MODEL,
    url: env.FIREWORKS_EMBEDDING_BASE_URL ?? FIREWORKS_EMBEDDING_BASE_URL,
    dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
  }
}

function selectProvider(): EmbeddingProvider {
  const preferredProvider = env.QUERY_EMBEDDING_PROVIDER

  if (preferredProvider === "fireworks") {
    const provider = fireworksProvider()
    if (provider) return provider
    throw new EmbeddingsBatchError(
      "missing_credentials",
      "FIREWORKS_API_KEY is required when QUERY_EMBEDDING_PROVIDER=fireworks",
    )
  }

  if (preferredProvider === "openrouter") {
    const provider = openRouterProvider()
    if (provider) return provider
    throw new EmbeddingsBatchError(
      "missing_credentials",
      "OPENROUTER_API_PAID_KEY or OPENROUTER_API_KEY is required when QUERY_EMBEDDING_PROVIDER=openrouter",
    )
  }

  const openRouter = openRouterProvider()
  if (openRouter) return openRouter

  const fireworks = fireworksProvider()
  if (fireworks) return fireworks

  throw new EmbeddingsBatchError(
    "missing_credentials",
    "OPENROUTER_API_PAID_KEY, OPENROUTER_API_KEY, or FIREWORKS_API_KEY is required for embedding generation",
  )
}

export function currentEmbeddingProviderIdentity(): EmbeddingProviderIdentity {
  const provider = selectProvider()
  return {
    provider: provider.id,
    model: provider.model,
    nativeDimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    dimensions: EXPERIENCE_EMBEDDING_DIMENSIONS,
    transformVersion: null,
  }
}

function currentEmbeddingProviderTuple(): ContentEmbeddingTuple {
  const identity = currentEmbeddingProviderIdentity()
  return {
    provider: identity.provider,
    model: identity.model,
    nativeDimensions: identity.nativeDimensions,
    dimensions: identity.dimensions,
    transformVersion: identity.transformVersion,
  }
}

export async function currentContentQueryEmbeddingIdentity(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<EmbeddingProviderIdentity & { contractId: string }> {
  let contract: Awaited<
    ReturnType<typeof resolveActiveContentEmbeddingContract>
  >
  try {
    contract = await resolveActiveContentEmbeddingContract(prisma)
  } catch (error) {
    throw new EmbeddingsBatchError(
      "contract_unavailable",
      "Active content embedding contract is unavailable",
      error,
    )
  }

  const identity = currentEmbeddingProviderIdentity()
  if (
    !contentEmbeddingTupleMatches(
      contract.query,
      currentEmbeddingProviderTuple(),
    )
  ) {
    throw new EmbeddingsBatchError(
      "contract_mismatch",
      `Configured query embedding provider ${identity.provider}/${identity.model} does not match active content embedding contract ${contract.id}`,
    )
  }

  return {
    contractId: contract.id,
    ...identity,
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError"
}

function embeddingTimeoutError(): Error {
  const error = new Error("Embedding request timed out")
  error.name = "AbortError"
  return error
}

async function fetchEmbeddingResponse(
  provider: EmbeddingProvider,
  body: string,
  signal: AbortSignal,
): Promise<EmbeddingProviderResult> {
  const response = await fetch(provider.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      "content-type": "application/json",
    },
    body,
    signal,
  })

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
    }
  }

  return {
    ok: true,
    body: await response.json(),
  }
}

async function fetchEmbeddingResponseWithDeadline(
  provider: EmbeddingProvider,
  body: string,
  timeoutMs: number,
): Promise<EmbeddingProviderResult> {
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      fetchEmbeddingResponse(provider, body, controller.signal),
      new Promise<EmbeddingProviderResult>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          controller.abort()
          reject(embeddingTimeoutError())
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle)
    }
  }
}

async function fetchSingleEmbeddingResponseWithRetry(
  provider: EmbeddingProvider,
  body: string,
): Promise<EmbeddingProviderResult> {
  let lastError: unknown

  for (
    let attempt = 0;
    attempt < SINGLE_EMBEDDING_REQUEST_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await fetchEmbeddingResponseWithDeadline(
        provider,
        body,
        SINGLE_EMBEDDING_REQUEST_TIMEOUT_MS,
      )
    } catch (error) {
      lastError = error
      if (!isAbortError(error)) {
        throw error
      }
    }
  }

  throw lastError
}

async function fetchEmbeddingResponseWithTimeout(
  provider: EmbeddingProvider,
  body: string,
  inputCount: number,
): Promise<EmbeddingProviderResult> {
  if (inputCount === 1) {
    return fetchSingleEmbeddingResponseWithRetry(provider, body)
  }

  return fetchEmbeddingResponseWithDeadline(
    provider,
    body,
    EMBEDDING_REQUEST_TIMEOUT_MS,
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

  let response: EmbeddingProviderResult
  const requestBody = JSON.stringify({
    model: provider.model,
    input: normalized,
    encoding_format: "float",
    ...(provider.dimensions ? { dimensions: provider.dimensions } : {}),
    ...(provider.routing ? { provider: provider.routing } : {}),
  })
  try {
    response = await fetchEmbeddingResponseWithTimeout(
      provider,
      requestBody,
      normalized.length,
    )
  } catch (error) {
    if (isAbortError(error)) {
      throw new EmbeddingsBatchError(
        "request_timed_out",
        "Embedding request timed out",
        error,
      )
    }
    throw new EmbeddingsBatchError(
      "request_failed",
      "Embedding request failed before response",
      error,
    )
  }

  if (!response.ok) {
    throw new EmbeddingsBatchError(
      "request_failed",
      `Embedding request failed with status ${response.status}`,
      undefined,
      response.status,
    )
  }

  const parsed = EmbeddingResponseSchema.safeParse(response.body)
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

export async function generateCurrentContentQueryEmbedding(
  prisma: Pick<PrismaClient, "$queryRaw">,
  text: string,
): Promise<GeneratedEmbedding & { contractId: string }> {
  const identity = await currentContentQueryEmbeddingIdentity(prisma)
  const result = await generateExperienceEmbedding(text)
  if (
    result.dimensions !== identity.dimensions ||
    result.embedding.length !== identity.dimensions
  ) {
    throw new EmbeddingsBatchError(
      "dimension_mismatch",
      `Query embedding returned ${result.embedding.length} dimensions; expected ${identity.dimensions}`,
    )
  }

  return {
    contractId: identity.contractId,
    ...result,
  }
}

export async function writeExperienceEmbeddingPayloadInTransaction(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  {
    localeId,
    embedding,
    provenance,
    user,
  }: {
    localeId: string
    embedding: readonly number[]
    provenance: ExperienceEmbeddingProvenance
    user: Principal | null
  },
): Promise<void> {
  if (!canWriteDerived(user)) {
    throw new Error("Forbidden: derived writes require SYSTEM or ADMIN")
  }
  if (embedding.length !== EXPERIENCE_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${embedding.length} dimensions; expected ${EXPERIENCE_EMBEDDING_DIMENSIONS}`,
    )
  }
  if (provenance.dimensions !== EXPERIENCE_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding provenance has ${provenance.dimensions} dimensions; expected ${EXPERIENCE_EMBEDDING_DIMENSIONS}`,
    )
  }

  await tx.$executeRaw`
    UPDATE experience_locale
    SET embedding = ${toPgVector(embedding)}::vector,
        embedding_source_content_hash = ${provenance.sourceContentHash},
        embedding_source_summary = ${provenance.sourceSummary},
        embedding_model = ${provenance.model},
        embedding_dimensions = ${provenance.dimensions},
        embedding_provider = ${provenance.provider ?? null},
        embedding_native_dimensions = ${provenance.nativeDimensions ?? null},
        embedding_transform_version = ${provenance.transformVersion ?? null},
        embedding_generation_mode = ${provenance.generationMode},
        embedding_mastra_run_id = ${provenance.mastraRunId},
        embedding_generated_at = ${new Date(provenance.generatedAt)},
        updated_at = NOW()
    WHERE id = ${localeId}
  `
}
