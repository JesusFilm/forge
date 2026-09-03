import { describe, expect, it, vi } from "vitest"

vi.mock("./content-embedding-contract", () => ({
  activeTranscriptContentEmbeddingWhere: vi.fn(() => ""),
  resolveActiveContentEmbeddingContract: vi.fn(async () => ({
    id: "semantic-transcript-pgvector-v1",
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
