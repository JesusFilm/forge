import { beforeEach, describe, expect, it, vi } from "vitest"

const { createEmbeddingsMock } = vi.hoisted(() => ({
  createEmbeddingsMock: vi.fn(),
}))

vi.mock("@/services/openrouter", () => ({
  getOpenrouter: () => ({
    embeddings: {
      create: createEmbeddingsMock,
    },
  }),
}))

import { EMBEDDING_MODEL, requestEmbeddingVectors } from "@/services/embeddings"

describe("requestEmbeddingVectors", () => {
  beforeEach(() => {
    createEmbeddingsMock.mockReset()
  })

  it("requests OpenRouter embeddings and aligns response indexes", async () => {
    createEmbeddingsMock.mockResolvedValueOnce({
      data: [
        { index: 1, embedding: [4, 5, 6] },
        { index: 0, embedding: [1, 2, 3] },
      ],
      usage: { total_tokens: 12 },
    })

    await expect(
      requestEmbeddingVectors(["one", "two"], {
        expectedDimensions: null,
        context: "Scene embedding batch 1/3",
        itemLabel: "scene descriptions",
      }),
    ).resolves.toEqual({
      embeddings: [
        [1, 2, 3],
        [4, 5, 6],
      ],
      dimensions: 3,
      tokenCount: 12,
    })

    expect(createEmbeddingsMock).toHaveBeenCalledWith({
      model: EMBEDDING_MODEL,
      input: ["one", "two"],
    })
  })

  it("rejects invalid response counts, duplicate indexes, and dimension drift", async () => {
    createEmbeddingsMock.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    })

    await expect(
      requestEmbeddingVectors(["one", "two"], {
        expectedDimensions: null,
        context: "Scene embedding batch 1/3",
        itemLabel: "scene descriptions",
      }),
    ).rejects.toThrow("returned 1 embeddings for 2 scene descriptions")

    createEmbeddingsMock.mockResolvedValueOnce({
      data: [
        { index: 0, embedding: [1, 2, 3] },
        { index: 0, embedding: [4, 5, 6] },
      ],
    })

    await expect(
      requestEmbeddingVectors(["one", "two"], {
        expectedDimensions: null,
        context: "Scene embedding batch 1/3",
        itemLabel: "scene descriptions",
      }),
    ).rejects.toThrow("returned a duplicate response index")

    createEmbeddingsMock.mockResolvedValueOnce({
      data: [{ index: 0, embedding: [1, 2, 3] }],
    })

    await expect(
      requestEmbeddingVectors(["one"], {
        expectedDimensions: 1536,
        context: "Scene embedding batch 1/3",
        itemLabel: "scene descriptions",
      }),
    ).rejects.toThrow("changed embedding dimensions from 1536 to 3")
  })
})
