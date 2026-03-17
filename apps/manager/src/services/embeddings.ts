// Embeddings service — generates vector embeddings for semantic search.

import { getOpenrouter } from "@/services/openrouter"
import { writeArtifact } from "@/services/storage"

export type EmbeddingsResult = {
  model: string
  dimensions: number
  chunks: { text: string; embedding: number[] }[]
}

export async function generateEmbeddings(
  assetId: string,
  transcript: string,
): Promise<EmbeddingsResult> {
  // Split transcript into chunks for embedding
  const chunks = chunkText(transcript, 512)

  const response = await getOpenrouter().embeddings.create({
    model: "openai/text-embedding-3-small",
    input: chunks,
  })

  const result: EmbeddingsResult = {
    model: "openai/text-embedding-3-small",
    dimensions: response.data[0]?.embedding.length ?? 0,
    chunks: chunks.map((text, i) => ({
      text,
      embedding: response.data[i]?.embedding ?? [],
    })),
  }

  await writeArtifact({
    assetId,
    artifactType: "embeddings",
    ext: "json",
    body: JSON.stringify(result),
    contentType: "application/json",
  })

  return result
}

function chunkText(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/)
  const chunks: string[] = []

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "))
  }

  return chunks.length > 0 ? chunks : [text]
}
