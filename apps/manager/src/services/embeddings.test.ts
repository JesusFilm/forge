import { beforeEach, describe, expect, it, vi } from "vitest"

const { createEmbeddingsMock, writeArtifactMock } = vi.hoisted(() => ({
  createEmbeddingsMock: vi.fn(),
  writeArtifactMock: vi.fn(),
}))

vi.mock("@/services/openrouter", () => ({
  getOpenrouter: () => ({
    embeddings: {
      create: createEmbeddingsMock,
    },
  }),
}))

vi.mock("@/services/storage", () => ({
  writeArtifact: writeArtifactMock,
}))

import { generateEmbeddings } from "@/services/embeddings"

describe("generateEmbeddings", () => {
  beforeEach(() => {
    createEmbeddingsMock.mockReset()
    writeArtifactMock.mockReset()
    writeArtifactMock.mockResolvedValue("embeddings-key")
  })

  it("writes enriched embeddings for segment-aware transcripts", async () => {
    createEmbeddingsMock
      .mockResolvedValueOnce({
        data: [
          { index: 0, embedding: [1, 2, 3] },
          { index: 1, embedding: [4, 5, 6] },
        ],
      })
      .mockResolvedValueOnce({
        data: [{ index: 0, embedding: [7, 8, 9] }],
      })

    const result = await generateEmbeddings(
      "asset-1",
      {
        text: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar",
        language: "en",
        segments: [
          { start: 0, end: 5, text: "alpha bravo charlie delta echo" },
          { start: 5, end: 10, text: "foxtrot golf hotel india juliet" },
          { start: 10, end: 15, text: "kilo lima mike november oscar" },
        ],
      },
      {
        maxChunkTokens: 8,
        overlapTokens: 3,
        maxBatchChunks: 2,
        maxBatchTokens: 16,
        generatedAt: "2026-04-08T12:00:00.000Z",
      },
    )

    expect(createEmbeddingsMock).toHaveBeenCalledTimes(2)
    expect(createEmbeddingsMock).toHaveBeenNthCalledWith(1, {
      model: "openai/text-embedding-3-small",
      input: [
        "alpha bravo charlie delta echo",
        "foxtrot golf hotel india juliet",
      ],
    })
    expect(createEmbeddingsMock).toHaveBeenNthCalledWith(2, {
      model: "openai/text-embedding-3-small",
      input: ["kilo lima mike november oscar"],
    })

    expect(result).toEqual({
      model: "openai/text-embedding-3-small",
      dimensions: 3,
      chunks: [
        {
          chunkId: "chunk-0",
          text: "alpha bravo charlie delta echo",
          embedding: [1, 2, 3],
          metadata: {
            tokenCount: 7,
            startTime: 0,
            endTime: 5,
          },
        },
        {
          chunkId: "chunk-1",
          text: "foxtrot golf hotel india juliet",
          embedding: [4, 5, 6],
          metadata: {
            tokenCount: 7,
            startTime: 5,
            endTime: 10,
          },
        },
        {
          chunkId: "chunk-2",
          text: "kilo lima mike november oscar",
          embedding: [7, 8, 9],
          metadata: {
            tokenCount: 7,
            startTime: 10,
            endTime: 15,
          },
        },
      ],
      averagedEmbedding: [4, 5, 6],
      metadata: {
        totalChunks: 3,
        totalTokens: 21,
        chunkingStrategy: {
          type: "segment-aware",
          maxChunkTokens: 8,
          overlapTokens: 3,
        },
        embeddingDimensions: 3,
        generatedAt: "2026-04-08T12:00:00.000Z",
      },
      artifactKeys: ["embeddings"],
    })

    expect(writeArtifactMock).toHaveBeenCalledTimes(1)
    expect(writeArtifactMock).toHaveBeenCalledWith({
      assetId: "asset-1",
      artifactType: "embeddings",
      ext: "json",
      body: expect.any(String),
      contentType: "application/json",
    })

    const persisted = JSON.parse(writeArtifactMock.mock.calls[0]![0].body)
    expect(persisted.chunks[0]).toMatchObject({
      chunkId: "chunk-0",
      text: "alpha bravo charlie delta echo",
      embedding: [1, 2, 3],
      metadata: {
        startTime: 0,
        endTime: 5,
        tokenCount: 7,
      },
    })
    expect(persisted.averagedEmbedding).toEqual([4, 5, 6])
  })

  it("fails loudly for empty transcript input", async () => {
    await expect(
      generateEmbeddings("asset-1", {
        text: "   ",
        segments: [],
      }),
    ).rejects.toThrow("Embeddings require non-empty transcript text")

    expect(createEmbeddingsMock).not.toHaveBeenCalled()
    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("rejects partial provider responses", async () => {
    createEmbeddingsMock.mockResolvedValue({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    })

    await expect(
      generateEmbeddings(
        "asset-1",
        {
          text: "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
        },
        {
          maxChunkTokens: 8,
          overlapTokens: 3,
          maxBatchChunks: 5,
          maxBatchTokens: 40,
        },
      ),
    ).rejects.toThrow("returned 1 embeddings for 2 chunks")

    expect(writeArtifactMock).not.toHaveBeenCalled()
  })

  it("maps batch responses by index and rejects dimension changes across batches", async () => {
    createEmbeddingsMock
      .mockResolvedValueOnce({
        data: [
          { index: 1, embedding: [4, 5, 6] },
          { index: 0, embedding: [1, 2, 3] },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          { index: 0, embedding: [7, 8] },
          { index: 1, embedding: [9, 10] },
        ],
      })

    await expect(
      generateEmbeddings(
        "asset-1",
        {
          text: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar",
        },
        {
          maxChunkTokens: 8,
          overlapTokens: 3,
          maxBatchChunks: 2,
          maxBatchTokens: 16,
        },
      ),
    ).rejects.toThrow("changed embedding dimensions from 3 to 2")

    expect(writeArtifactMock).not.toHaveBeenCalled()
  })
})
