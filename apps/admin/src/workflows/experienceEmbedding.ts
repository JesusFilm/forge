import {
  launchMastraExperienceEmbeddingForLocale,
  type MastraExperienceEmbeddingLaunchResult,
} from "@/services/mastra-experience-embedding-client"

export type ExperienceEmbeddingInput = {
  localeId: string
}

export type ExperienceEmbeddingOutput = {
  localeId: string
  updated: boolean
}

/**
 * Per-locale experience embedding workflow. Admin authorizes and resolves
 * the locale; Mastra owns provider generation and writes back through
 * Admin's experience-specific ingest endpoint.
 *
 * The GraphQL-facing return intentionally stays scrubbed: no vector,
 * provider payload, model, dimensions, source hash, or Mastra run id.
 */
export async function runExperienceEmbedding(
  input: ExperienceEmbeddingInput,
): Promise<ExperienceEmbeddingOutput> {
  "use workflow"

  const result = await stepEmbed(input.localeId)
  if (!result.ok) {
    throw new Error(
      `Mastra experience embedding failed: ${result.reason}` +
        (result.adminReason ? ` (${result.adminReason})` : ""),
    )
  }

  return {
    localeId: input.localeId,
    updated: true,
  }
}

async function stepEmbed(
  localeId: string,
): Promise<MastraExperienceEmbeddingLaunchResult> {
  "use step"
  return launchMastraExperienceEmbeddingForLocale(localeId, { mode: "force" })
}
