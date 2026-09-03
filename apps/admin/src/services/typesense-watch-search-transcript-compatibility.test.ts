import { describe, expect, it, vi } from "vitest"

vi.mock("./content-embedding-contract", () => ({
  resolveActiveContentEmbeddingContract: vi.fn(async () => ({
    id: "semantic-transcript-pgvector-v1",
    storage: {
      provider: "jesus-film-ai-gateway",
      model: "embeddings",
      dimensions: 1536,
      nativeDimensions: 1536,
      transformVersion: null,
    },
  })),
}))

import { resolveActiveContentEmbeddingContract } from "./content-embedding-contract"
import {
  resolveCurrentWatchSearchTranscriptCompatibility,
  WatchSearchTranscriptCompatibilityError,
} from "./typesense-watch-search-transcript-compatibility"

describe("resolveCurrentWatchSearchTranscriptCompatibility", () => {
  it("returns the active contract id and exact chunking version", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{ chunkingVersion: "mastra-v1" }]),
    }

    await expect(
      resolveCurrentWatchSearchTranscriptCompatibility(prisma as never),
    ).resolves.toEqual({
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
    })
    expect(resolveActiveContentEmbeddingContract).toHaveBeenCalledWith(prisma)

    const firstCall = (prisma.$queryRaw.mock.calls as unknown[][])[0]
    expect(firstCall).toBeDefined()
    const statement = firstCall?.[0] as {
      strings: readonly string[]
      values: readonly unknown[]
    }
    expect(statement.strings.join(" ")).toContain(
      "embedding_transform_version IS NOT DISTINCT FROM",
    )
    expect(statement.strings.join(" ")).toContain("::text")
    expect(statement.values).toContain(null)
  })

  it("uses the resolved contract snapshot for the chunking-version query", async () => {
    vi.mocked(resolveActiveContentEmbeddingContract).mockResolvedValueOnce({
      id: "semantic-transcript-pgvector-v2",
      query: {
        provider: "openrouter",
        model: "qwen/qwen3-embedding-8b",
        dimensions: 1536,
        nativeDimensions: 1536,
        transformVersion: null,
      },
      storage: {
        provider: "jesus-film-ai-gateway",
        model: "embeddings-v2",
        dimensions: 3072,
        nativeDimensions: 4096,
        transformVersion: "normalize-v2",
      },
    })
    const prisma = {
      $queryRaw: vi.fn(async () => [{ chunkingVersion: "mastra-v2" }]),
    }

    await resolveCurrentWatchSearchTranscriptCompatibility(prisma as never)

    const firstCall = (prisma.$queryRaw.mock.calls as unknown[][])[0]
    expect(firstCall).toBeDefined()
    const statement = firstCall?.[0] as {
      strings: readonly string[]
      values: readonly unknown[]
    }
    expect(statement.strings.join(" ")).not.toContain(
      "content_embedding_contract_pointer",
    )
    expect(statement.values).toEqual(
      expect.arrayContaining([
        "jesus-film-ai-gateway",
        "embeddings-v2",
        3072,
        4096,
        "normalize-v2",
      ]),
    )
  })

  it("fails closed when no chunking version is available", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => []),
    }

    await expect(
      resolveCurrentWatchSearchTranscriptCompatibility(prisma as never),
    ).rejects.toThrow(WatchSearchTranscriptCompatibilityError)
  })

  it("fails closed when several chunking versions are active", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [
        { chunkingVersion: "mastra-v1" },
        { chunkingVersion: "mastra-v2" },
      ]),
    }

    await expect(
      resolveCurrentWatchSearchTranscriptCompatibility(prisma as never),
    ).rejects.toThrow(/one exact current chunking version/)
  })

  it("fails closed when the chunking version is blank", async () => {
    const prisma = {
      $queryRaw: vi.fn(async () => [{ chunkingVersion: " " }]),
    }

    await expect(
      resolveCurrentWatchSearchTranscriptCompatibility(prisma as never),
    ).rejects.toThrow(/chunking version is required/)
  })
})
