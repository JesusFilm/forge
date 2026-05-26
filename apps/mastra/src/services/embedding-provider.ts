export const DEFAULT_TRANSCRIPT_EMBEDDING_MODEL =
  "openai/text-embedding-3-small"
export const DEFAULT_TRANSCRIPT_EMBEDDING_PROVIDER = "openai"
export const DEFAULT_SCENE_EMBEDDING_MODEL = "openai/text-embedding-3-small"
export const DEFAULT_SCENE_EMBEDDING_PROVIDER = "openai"
export const DEFAULT_EXPERIENCE_EMBEDDING_MODEL =
  "openai/text-embedding-3-small"
export const DEFAULT_EXPERIENCE_EMBEDDING_PROVIDER = "openai"
export const DEFAULT_OPENAI_EMBEDDINGS_BASE_URL = "https://api.openai.com/v1"
export const EXPECTED_TRANSCRIPT_EMBEDDING_DIMENSIONS = 1536
export const EXPECTED_SCENE_EMBEDDING_DIMENSIONS = 1536
export const EXPECTED_EXPERIENCE_EMBEDDING_DIMENSIONS = 1536

export type EmbeddingProviderResult = {
  embeddings: number[][]
  dimensions: number
  tokenCount: number
  model: string
  provider: string
  requestModel: string
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

function requestModelForEndpoint(model: string, baseUrl: string): string {
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

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(embeddingEndpoint(baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
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
      options.expectedDimensions != null &&
      options.expectedDimensions !== embedding.length
    ) {
      throw new EmbeddingProviderError(
        "dimension_mismatch",
        `${options.context} changed embedding dimensions from ${options.expectedDimensions} to ${embedding.length}`,
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

  return validateEmbeddingProviderResult(
    {
      dimensions,
      tokenCount: responseUsageTokens(body),
      model,
      provider,
      requestModel,
      embeddings: input.map((_, index) => {
        const embedding = embeddingsByIndex.get(index)
        if (!embedding) {
          throw new EmbeddingProviderError(
            "invalid_response",
            `${options.context} was missing embedding for input index ${index}`,
            true,
          )
        }
        return embedding
      }),
    },
    input.length,
    {
      expectedDimensions: options.expectedDimensions,
      context: options.context,
      itemLabel: options.itemLabel,
    },
  )
}

export const _internals = {
  embeddingEndpoint,
  requestModelForEndpoint,
}
