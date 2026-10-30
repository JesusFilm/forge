import { describe, expect, it, vi } from "vitest"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
  ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
  ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
  ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "./content-embedding-contract"

import { buildExperienceEmbeddingSource } from "@/services/embeddings.service"
import { ingestExperienceEmbedding } from "@/services/experience-embedding-ingest.service"
import { searchExperienceSemantic } from "@/services/hybrid-search-retrievers"

type StoredExperienceLocale = {
  id: string
  experienceId: string
  locale: string
  slug: string
  status: "PUBLISHED"
  title: string
  metaDescription: string | null
  ogTitle: string | null
  ogDescription: string | null
  blocks: unknown
  experience: { archivedAt: Date | null }
  embeddingText: string | null
  embeddingSourceContentHash: string | null
  embeddingSourceSummary: string | null
  embeddingModel: string | null
  embeddingDimensions: number | null
  embeddingProvider: string | null
  embeddingNativeDimensions: number | null
  embeddingTransformVersion: string | null
  embeddingGenerationMode: string | null
  embeddingMastraRunId: string | null
  embeddingGeneratedAt: Date | null
}

function vector(seed = 0.0123): number[] {
  return Array.from({ length: 1536 }, (_, index) => seed + index / 1_000_000)
}

function buildContractLocale(): StoredExperienceLocale {
  return {
    id: "loc-contract",
    experienceId: "exp-contract",
    locale: "en",
    slug: "hope",
    status: "PUBLISHED",
    title: "Hope",
    metaDescription: "The resurrection hope.",
    ogTitle: null,
    ogDescription: null,
    blocks: [{ t: "paragraph", text: "Jesus brings lasting hope." }],
    experience: { archivedAt: null },
    embeddingText: null,
    embeddingSourceContentHash: null,
    embeddingSourceSummary: null,
    embeddingModel: null,
    embeddingDimensions: null,
    embeddingProvider: null,
    embeddingNativeDimensions: null,
    embeddingTransformVersion: null,
    embeddingGenerationMode: null,
    embeddingMastraRunId: null,
    embeddingGeneratedAt: null,
  }
}

function buildContractPrisma(locale = buildContractLocale()) {
  const queryRaw = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join(" ")
    if (sql.includes("FROM content_embedding_contract_pointer")) {
      return [
        {
          pointerId: CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
          contractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_ID,
          queryProvider: ACTIVE_CONTENT_QUERY_EMBEDDING_PROVIDER,
          queryModel: ACTIVE_CONTENT_QUERY_EMBEDDING_MODEL,
          queryNativeDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
          queryDimensions: ACTIVE_CONTENT_QUERY_EMBEDDING_DIMENSIONS,
          queryTransformVersion: null,
          storageProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
          storageModel: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
          storageNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          storageDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
          storageTransformVersion: null,
        },
      ]
    }

    if (sql.includes("pg_advisory_xact_lock")) {
      return []
    }

    if (sql.includes("embedding_source_content_hash")) {
      return [
        {
          healthy: locale.embeddingText != null,
          source_content_hash: locale.embeddingSourceContentHash,
          source_summary: locale.embeddingSourceSummary,
          model: locale.embeddingModel,
          dimensions: locale.embeddingDimensions,
          provider: locale.embeddingProvider,
          native_dimensions: locale.embeddingNativeDimensions,
          transform_version: locale.embeddingTransformVersion,
        },
      ]
    }

    if (sql.includes("FROM experience_locale el")) {
      if (!locale.embeddingText) return []
      return [
        {
          experience_locale_id: locale.id,
          slug: locale.slug,
          title: locale.title,
          meta_description: locale.metaDescription,
          similarity: 0.93,
        },
      ]
    }

    return []
  })

  const tx = {
    experienceLocale: {
      findUnique: vi.fn(async () => locale),
    },
    $queryRaw: queryRaw,
    $executeRaw: vi.fn(
      async (
        strings: TemplateStringsArray,
        embeddingText: string,
        sourceContentHash: string,
        sourceSummary: string,
        model: string,
        dimensions: number,
        provider: string | null,
        nativeDimensions: number | null,
        transformVersion: string | null,
        generationMode: string,
        mastraRunId: string,
        generatedAt: Date,
      ) => {
        expect(strings.join(" ")).toContain("UPDATE experience_locale")
        locale.embeddingText = embeddingText
        locale.embeddingSourceContentHash = sourceContentHash
        locale.embeddingSourceSummary = sourceSummary
        locale.embeddingModel = model
        locale.embeddingDimensions = dimensions
        locale.embeddingProvider = provider
        locale.embeddingNativeDimensions = nativeDimensions
        locale.embeddingTransformVersion = transformVersion
        locale.embeddingGenerationMode = generationMode
        locale.embeddingMastraRunId = mastraRunId
        locale.embeddingGeneratedAt = generatedAt
        return 1
      },
    ),
  }

  const prisma = {
    experienceLocale: {
      findUnique: vi.fn(async () => locale),
    },
    $queryRaw: queryRaw,
    $transaction: vi.fn(
      async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  }

  return { prisma, locale }
}

function contractPayload(locale: StoredExperienceLocale) {
  const source = buildExperienceEmbeddingSource(locale)
  return {
    target: {
      experienceId: locale.experienceId,
      experienceLocaleId: locale.id,
      locale: locale.locale,
      slug: locale.slug,
    },
    source: {
      contentHash: source.contentHash,
      summary: source.summary,
    },
    model: {
      name: ACTIVE_CONTENT_STORAGE_EMBEDDING_MODEL,
      provider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
      dimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      nativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
    },
    generation: {
      mode: "idempotent",
      generatedAt: "2026-05-26T00:00:00.000Z",
      mastraRunId: "mastra-run-contract",
    },
    embedding: vector(),
  }
}

describe("Mastra experience ingest contract", () => {
  it("accepts Mastra-shaped output, writes ExperienceLocale vector storage, and feeds existing semantic retrieval", async () => {
    const { prisma, locale } = buildContractPrisma()

    const result = await ingestExperienceEmbedding(
      prisma as never,
      contractPayload(locale),
    )

    expect(result).toMatchObject({
      status: "created",
      target: {
        experienceId: "exp-contract",
        experienceLocaleId: "loc-contract",
        locale: "en",
      },
      dimensions: 1536,
      mastraRunId: "mastra-run-contract",
    })
    expect(locale).toMatchObject({
      embeddingSourceContentHash: contractPayload(locale).source.contentHash,
      embeddingSourceSummary: contractPayload(locale).source.summary,
      embeddingModel: "embeddings",
      embeddingDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      embeddingProvider: ACTIVE_CONTENT_STORAGE_EMBEDDING_PROVIDER,
      embeddingNativeDimensions: ACTIVE_CONTENT_STORAGE_EMBEDDING_DIMENSIONS,
      embeddingTransformVersion: null,
      embeddingGenerationMode: "idempotent",
      embeddingMastraRunId: "mastra-run-contract",
    })
    expect(locale.embeddingText).toBe(
      `[${contractPayload(locale).embedding.join(",")}]`,
    )

    const searchRows = await searchExperienceSemantic(prisma as never, {
      queryEmbedding: `[${contractPayload(locale).embedding.join(",")}]`,
      locale: "en",
      limit: 5,
    })

    expect(searchRows).toEqual([
      {
        resultType: "experience",
        resultId: "loc-contract",
        experienceSlug: "hope",
        experienceTitle: "Hope",
        experienceMetaDescription: "The resurrection hope.",
        imageUrl: null,
        similarity: 0.93,
      },
    ])
  })
})
