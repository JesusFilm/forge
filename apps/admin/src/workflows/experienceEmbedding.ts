import {
  embedExperienceLocale,
  type EmbedExperienceLocaleResult,
} from "@/services/embeddings.service"

export type ExperienceEmbeddingInput = {
  localeId: string
}

export type ExperienceEmbeddingOutput = {
  localeId: string
  dimensions: number
  model: string
  updated: boolean
}

/**
 * Per-locale experience embedding workflow. Loads the locale, builds
 * the embedding text, generates a vector, and persists it.
 *
 * The whole sequence is wrapped in a single `"use step"` so the
 * production workflow runtime gets a clean replay boundary; the
 * underlying work lives in `embedExperienceLocale` (a plain service
 * function) so the same code path is reachable without the runtime —
 * which is what `runExperienceEmbeddingBackfill` and
 * `pnpm run-embeds --pipeline=experience` rely on.
 */
export async function runExperienceEmbedding(
  input: ExperienceEmbeddingInput,
): Promise<ExperienceEmbeddingOutput> {
  "use workflow"

  const result = await stepEmbed(input.localeId)

  return {
    localeId: result.localeId,
    dimensions: result.dimensions,
    model: result.model,
    updated: true,
  }
}

async function stepEmbed(
  localeId: string,
): Promise<EmbedExperienceLocaleResult> {
  "use step"
  return embedExperienceLocale(localeId)
}
