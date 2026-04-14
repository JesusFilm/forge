// Lightweight OpenRouter client for query embeddings.
// Uses the openai SDK with OpenRouter's base URL (singleton pattern).

import OpenAI from "openai"

export const EMBEDDING_MODEL = "openai/text-embedding-3-small"

let _openrouter: OpenAI | undefined

export function getOpenrouter(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Required for embedding generation.",
    )
  }

  if (!_openrouter) {
    _openrouter = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey,
      timeout: 10_000,
      maxRetries: 2,
    })
  }

  return _openrouter
}

export async function embedQuery(text: string): Promise<number[]> {
  const response = await getOpenrouter().embeddings.create({
    model: EMBEDDING_MODEL,
    input: [text],
  })

  const items = Array.isArray(response.data) ? response.data : []
  if (items.length !== 1) {
    throw new Error(`Expected exactly 1 embedding, got ${items.length}`)
  }

  const embedding = items[0]!.embedding
  if (
    !Array.isArray(embedding) ||
    embedding.length === 0 ||
    embedding.some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    )
  ) {
    throw new Error("Embedding response contains invalid vector data")
  }

  return embedding
}
