import { prisma } from "@/db/client"
import { SYSTEM_PRINCIPAL } from "@/auth/principal"
import {
  buildExperienceEmbeddingText,
  generateExperienceEmbedding,
  writeExperienceLocaleEmbedding,
} from "@/services/embeddings.service"

type ExperienceEmbeddingLocaleRecord = {
  id: string
  title: string | null
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  blocks: unknown
}

export type ExperienceEmbeddingInput = {
  localeId: string
}

export type ExperienceEmbeddingOutput = {
  localeId: string
  dimensions: number
  model: string
  updated: boolean
}

export async function runExperienceEmbedding(
  input: ExperienceEmbeddingInput,
): Promise<ExperienceEmbeddingOutput> {
  "use workflow"

  const locale = await stepLoadExperienceLocale(input.localeId)
  const text = buildExperienceEmbeddingText(locale)
  const embedding = await stepGenerateExperienceEmbedding(text)
  await stepPersistExperienceEmbedding(input.localeId, embedding.embedding)

  return {
    localeId: input.localeId,
    dimensions: embedding.dimensions,
    model: embedding.model,
    updated: true,
  }
}

async function stepLoadExperienceLocale(
  localeId: string,
): Promise<ExperienceEmbeddingLocaleRecord> {
  "use step"

  return prisma.experienceLocale.findUniqueOrThrow({
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
}

async function stepGenerateExperienceEmbedding(text: string) {
  "use step"

  return generateExperienceEmbedding(text)
}

async function stepPersistExperienceEmbedding(
  localeId: string,
  embedding: readonly number[],
) {
  "use step"

  await writeExperienceLocaleEmbedding({
    prisma,
    localeId,
    embedding,
    user: SYSTEM_PRINCIPAL,
  })
}
