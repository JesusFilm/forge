// Shared embedding provider helper retained for scene embeddings until the
// scene migration moves that workflow to Mastra.

import { getOpenrouter } from "@/services/openrouter"

export const EMBEDDING_MODEL = "openai/text-embedding-3-small"

export async function requestEmbeddingVectors(
  input: string[],
  options: {
    expectedDimensions: number | null
    context: string
    itemLabel: string
  },
): Promise<{ embeddings: number[][]; dimensions: number; tokenCount: number }> {
  const response = await getOpenrouter().embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  })

  const items = Array.isArray(response.data) ? response.data : []
  if (items.length !== input.length) {
    throw new Error(
      `${options.context} returned ${items.length} embeddings for ${input.length} ${options.itemLabel}`,
    )
  }

  const embeddingsByIndex = new Map<number, number[]>()
  let dimensions: number | null = null

  for (const item of items) {
    const index = item?.index
    const embedding = item?.embedding

    if (!Number.isInteger(index) || index < 0 || index >= input.length) {
      throw new Error(`${options.context} returned an invalid response index`)
    }

    if (embeddingsByIndex.has(index)) {
      throw new Error(`${options.context} returned a duplicate response index`)
    }

    if (
      !Array.isArray(embedding) ||
      embedding.length === 0 ||
      embedding.some(
        (value) => typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      throw new Error(`${options.context} returned an invalid embedding vector`)
    }

    if (dimensions === null) {
      dimensions = embedding.length
    } else if (dimensions !== embedding.length) {
      throw new Error(
        `${options.context} returned inconsistent embedding dimensions`,
      )
    }

    if (
      options.expectedDimensions !== null &&
      options.expectedDimensions !== embedding.length
    ) {
      throw new Error(
        `${options.context} changed embedding dimensions from ${options.expectedDimensions} to ${embedding.length}`,
      )
    }

    embeddingsByIndex.set(index, embedding)
  }

  if (dimensions === null) {
    throw new Error(`${options.context} returned no dimensions`)
  }

  return {
    dimensions,
    tokenCount: response.usage?.total_tokens ?? 0,
    embeddings: input.map((_, index) => {
      const embedding = embeddingsByIndex.get(index)
      if (!embedding) {
        throw new Error(
          `${options.context} was missing embedding for input index ${index}`,
        )
      }

      return embedding
    }),
  }
}
