import { describe, expect, it } from "vitest"
import {
  INCLUDE_EMBEDDING_ARG,
  stripEmbeddingFromResult,
  takeEmbeddingOptIn,
} from "./client"

describe("takeEmbeddingOptIn", () => {
  it("removes the opt-in flag and returns includeEmbedding=true", () => {
    const result = takeEmbeddingOptIn({
      where: { id: "loc-1" },
      [INCLUDE_EMBEDDING_ARG]: true,
    })

    expect(result.includeEmbedding).toBe(true)
    expect(result.cleanedArgs).toEqual({ where: { id: "loc-1" } })
  })

  it("leaves ordinary args untouched", () => {
    const args = { where: { id: "loc-2" } }
    const result = takeEmbeddingOptIn(args)

    expect(result.includeEmbedding).toBe(false)
    expect(result.cleanedArgs).toEqual(args)
  })
})

describe("stripEmbeddingFromResult", () => {
  it("removes embedding from nested Prisma-like payloads", () => {
    const row = {
      id: "exp-1",
      locales: [
        {
          id: "loc-1",
          embedding: [0.1, 0.2],
        },
      ],
      related: {
        embedding: [0.3, 0.4],
      },
    }

    expect(stripEmbeddingFromResult(row)).toEqual({
      id: "exp-1",
      locales: [{ id: "loc-1" }],
      related: {},
    })
  })
})
