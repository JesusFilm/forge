import { z } from "zod"
import { env } from "@/config/env"

export const OLLAMA_EMBEDDING_DIMENSIONS =
  env.OLLAMA_EMBEDDING_DIMENSIONS ?? 768

const OllamaEmbedResponseSchema = z.object({
  embeddings: z.array(z.array(z.number().finite())).min(1),
})

function ollamaEmbedEndpoint() {
  return new URL(
    "api/embed",
    `${(env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "")}/`,
  ).toString()
}

export async function generateOllamaEmbedding(text: string): Promise<number[]> {
  const input = text.replace(/\s+/g, " ").trim()
  if (!input) {
    throw new Error("Ollama embedding input must not be empty")
  }

  const response = await fetch(ollamaEmbedEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: env.OLLAMA_EMBEDDING_MODEL ?? "embeddinggemma",
      input,
      truncate: true,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) {
    throw new Error(
      `Ollama embedding request failed with status ${response.status}`,
    )
  }

  const parsed = OllamaEmbedResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new Error("Ollama embedding response validation failed")
  }

  const embedding = parsed.data.embeddings[0]!
  if (embedding.length !== OLLAMA_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Ollama embedding returned ${embedding.length} dimensions; expected ${OLLAMA_EMBEDDING_DIMENSIONS}`,
    )
  }

  return embedding
}
