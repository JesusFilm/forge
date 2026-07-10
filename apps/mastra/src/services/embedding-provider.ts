export const DEFAULT_TRANSCRIPT_EMBEDDING_MODEL =
  "openai/text-embedding-3-small"
export const DEFAULT_TRANSCRIPT_EMBEDDING_PROVIDER = "openai"
export const DEFAULT_EXPERIENCE_EMBEDDING_MODEL =
  "openai/text-embedding-3-small"
export const DEFAULT_EXPERIENCE_EMBEDDING_PROVIDER = "openai"
export const DEFAULT_OPENAI_EMBEDDINGS_BASE_URL = "https://api.openai.com/v1"
export const DEFAULT_EMBEDDING_TRANSFORM_VERSION = "matryoshka-truncate-1536-v1"
export const EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS = 1536
export const EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS = 1536
export const EXPECTED_AI_GATEWAY_EMBEDDING_NATIVE_DIMENSIONS =
  EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS

export type EmbeddingProviderResult = {
  embeddings: number[][]
  dimensions: number
  nativeDimensions?: number
  transformVersion?: string
  tokenCount: number
  model: string
  provider: string
  requestModel: string
}

export type EmbeddingGatewayPreflightResult = {
  model: string
  provider: string
  requestModel: string
  nativeDimensions: number
  finalDimensions: number
  transformVersion: string | null
  sampleCount: number
  norms: number[]
  pairwiseCosine: number | null
}

export class EmbeddingProviderError extends Error {
  constructor(
    readonly code:
      | "config_missing"
      | "auth_failed"
      | "upstream_failed"
      | "invalid_response"
      | "dimension_mismatch",
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = "EmbeddingProviderError"
  }
}

export type RequestEmbeddingVectorsOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
  provider?: string
  expectedDimensions?: number | null
  expectedNativeDimensions?: number | null
  truncateToDimensions?: number | null
  transformVersion?: string
  userAgent?: string
  context: string
  itemLabel: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export type ValidateEmbeddingProviderResultOptions = {
  expectedDimensions?: number | null
  context: string
  itemLabel: string
}

type EmbeddingResponseItem = {
  index?: unknown
  embedding?: unknown
}

function embeddingEndpoint(baseUrl: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL("embeddings", normalized)
}

export function requestModelForEndpoint(
  model: string,
  baseUrl: string,
): string {
  const host = new URL(baseUrl).hostname
  if (host === "api.openai.com" && model.startsWith("openai/")) {
    return model.slice("openai/".length)
  }
  return model
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function responseUsageTokens(value: unknown): number {
  const body = asRecord(value)
  const usage = asRecord(body?.usage)
  const totalTokens = usage?.total_tokens
  return typeof totalTokens === "number" && Number.isFinite(totalTokens)
    ? totalTokens
    : 0
}

function vectorNorm(vector: readonly number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number | null {
  if (left.length !== right.length || left.length === 0) return null
  const leftNorm = vectorNorm(left)
  const rightNorm = vectorNorm(right)
  if (!Number.isFinite(leftNorm) || !Number.isFinite(rightNorm)) return null
  if (leftNorm === 0 || rightNorm === 0) return null
  let dot = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
  }
  return dot / (leftNorm * rightNorm)
}

function truncateAndNormalizeEmbedding(
  embedding: readonly number[],
  dimensions: number,
  context: string,
): number[] {
  if (dimensions <= 0 || !Number.isInteger(dimensions)) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      `${context} requested invalid final embedding dimensions`,
    )
  }
  if (embedding.length < dimensions) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      `${context} returned ${embedding.length} native dimensions; cannot truncate to ${dimensions}`,
    )
  }

  const transformed = embedding.slice(0, dimensions)
  const norm = vectorNorm(transformed)
  if (!Number.isFinite(norm) || norm === 0) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${context} returned a zero-norm transformed embedding vector`,
      true,
    )
  }
  return transformed.map((value) => value / norm)
}

export function validateEmbeddingProviderResult(
  result: EmbeddingProviderResult,
  expectedCount: number,
  options: ValidateEmbeddingProviderResultOptions,
): EmbeddingProviderResult {
  if (expectedCount <= 0) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} requires at least one ${options.itemLabel}`,
    )
  }
  if (result.embeddings.length !== expectedCount) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} returned ${result.embeddings.length} embeddings for ${expectedCount} ${options.itemLabel}`,
      true,
    )
  }

  let dimensions: number | null = null
  for (const embedding of result.embeddings) {
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new EmbeddingProviderError(
        "invalid_response",
        `${options.context} returned an invalid embedding vector`,
        true,
      )
    }

    if (dimensions === null) {
      dimensions = embedding.length
    } else if (dimensions !== embedding.length) {
      throw new EmbeddingProviderError(
        "dimension_mismatch",
        `${options.context} returned inconsistent embedding dimensions`,
      )
    }
  }

  if (dimensions === null || result.dimensions !== dimensions) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      `${options.context} returned inconsistent embedding dimensions`,
    )
  }
  if (
    options.expectedDimensions != null &&
    options.expectedDimensions !== dimensions
  ) {
    throw new EmbeddingProviderError(
      "dimension_mismatch",
      `${options.context} changed embedding dimensions from ${options.expectedDimensions} to ${dimensions}`,
    )
  }

  return result
}

export async function requestEmbeddingVectors(
  input: string[],
  options: RequestEmbeddingVectorsOptions,
): Promise<EmbeddingProviderResult> {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) {
    throw new EmbeddingProviderError(
      "config_missing",
      "embedding provider API key is not configured",
    )
  }
  if (input.length === 0) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} requires at least one ${options.itemLabel}`,
    )
  }

  const model = options.model ?? DEFAULT_TRANSCRIPT_EMBEDDING_MODEL
  const provider = options.provider ?? DEFAULT_TRANSCRIPT_EMBEDDING_PROVIDER
  const baseUrl = options.baseUrl ?? DEFAULT_OPENAI_EMBEDDINGS_BASE_URL
  const requestModel = requestModelForEndpoint(model, baseUrl)
  const transformDimensions = options.truncateToDimensions ?? null
  const transformVersion =
    transformDimensions == null
      ? undefined
      : (options.transformVersion ?? DEFAULT_EMBEDDING_TRANSFORM_VERSION)

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(embeddingEndpoint(baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(options.userAgent ? { "user-agent": options.userAgent } : {}),
      },
      body: JSON.stringify({ model: requestModel, input }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    })
  } catch {
    throw new EmbeddingProviderError(
      "upstream_failed",
      `${options.context} embedding request failed`,
      true,
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new EmbeddingProviderError(
      "auth_failed",
      `${options.context} embedding provider rejected credentials`,
    )
  }
  if (!response.ok) {
    throw new EmbeddingProviderError(
      "upstream_failed",
      `${options.context} embedding provider returned HTTP ${response.status}`,
      response.status >= 500 || response.status === 429,
    )
  }

  const body = await response.json().catch(() => {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} embedding provider returned invalid JSON`,
    )
  })
  const bodyRecord = asRecord(body)
  const items = bodyRecord?.data
  if (!Array.isArray(items)) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} embedding provider response is missing data`,
    )
  }
  if (items.length !== input.length) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} returned ${items.length} embeddings for ${input.length} ${options.itemLabel}`,
      true,
    )
  }

  const embeddingsByIndex = new Map<number, number[]>()
  let dimensions: number | null = null

  for (const item of items as EmbeddingResponseItem[]) {
    const index = item.index
    const embedding = item.embedding
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= input.length
    ) {
      throw new EmbeddingProviderError(
        "invalid_response",
        `${options.context} returned an invalid response index`,
        true,
      )
    }
    if (embeddingsByIndex.has(index)) {
      throw new EmbeddingProviderError(
        "invalid_response",
        `${options.context} returned a duplicate response index`,
        true,
      )
    }
    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new EmbeddingProviderError(
        "invalid_response",
        `${options.context} returned an invalid embedding vector`,
        true,
      )
    }

    if (dimensions === null) {
      dimensions = embedding.length
    } else if (dimensions !== embedding.length) {
      throw new EmbeddingProviderError(
        "dimension_mismatch",
        `${options.context} returned inconsistent embedding dimensions`,
      )
    }
    if (
      transformDimensions == null &&
      options.expectedDimensions != null &&
      options.expectedDimensions !== embedding.length
    ) {
      throw new EmbeddingProviderError(
        "dimension_mismatch",
        `${options.context} changed embedding dimensions from ${options.expectedDimensions} to ${embedding.length}`,
      )
    }
    if (
      transformDimensions != null &&
      options.expectedNativeDimensions != null &&
      options.expectedNativeDimensions !== embedding.length
    ) {
      throw new EmbeddingProviderError(
        "dimension_mismatch",
        `${options.context} returned ${embedding.length} native dimensions; expected ${options.expectedNativeDimensions}`,
      )
    }

    embeddingsByIndex.set(index, embedding)
  }

  if (dimensions === null) {
    throw new EmbeddingProviderError(
      "invalid_response",
      `${options.context} returned no dimensions`,
      true,
    )
  }

  const orderedEmbeddings = input.map((_, index) => {
    const embedding = embeddingsByIndex.get(index)
    if (!embedding) {
      throw new EmbeddingProviderError(
        "invalid_response",
        `${options.context} was missing embedding for input index ${index}`,
        true,
      )
    }
    return transformDimensions == null
      ? embedding
      : truncateAndNormalizeEmbedding(
          embedding,
          transformDimensions,
          options.context,
        )
  })
  const finalDimensions = transformDimensions ?? dimensions

  return validateEmbeddingProviderResult(
    {
      dimensions: finalDimensions,
      nativeDimensions: dimensions,
      transformVersion,
      tokenCount: responseUsageTokens(body),
      model,
      provider,
      requestModel,
      embeddings: orderedEmbeddings,
    },
    input.length,
    {
      expectedDimensions: options.expectedDimensions,
      context: options.context,
      itemLabel: options.itemLabel,
    },
  )
}

export async function preflightEmbeddingGateway(
  sampleInput: string[],
  options: RequestEmbeddingVectorsOptions,
): Promise<EmbeddingGatewayPreflightResult> {
  const result = await requestEmbeddingVectors(sampleInput, {
    ...options,
    context: options.context || "Embedding gateway preflight",
    itemLabel: options.itemLabel || "sample inputs",
  })
  return {
    model: result.model,
    provider: result.provider,
    requestModel: result.requestModel,
    nativeDimensions: result.nativeDimensions ?? result.dimensions,
    finalDimensions: result.dimensions,
    transformVersion: result.transformVersion ?? null,
    sampleCount: result.embeddings.length,
    norms: result.embeddings.map((embedding) => vectorNorm(embedding)),
    pairwiseCosine:
      result.embeddings.length >= 2
        ? cosineSimilarity(result.embeddings[0]!, result.embeddings[1]!)
        : null,
  }
}

export const _internals = {
  embeddingEndpoint,
  requestModelForEndpoint,
  truncateAndNormalizeEmbedding,
  vectorNorm,
}
