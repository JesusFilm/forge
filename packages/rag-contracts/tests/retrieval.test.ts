import { describe, expect, it } from "vitest"

import {
  rankedResultSchema,
  retrievalPolicySchema,
  searchRequestSchema,
  searchResponseSchema,
} from "../src/index.js"

describe("published /v1 retrieval contract", () => {
  it("accepts the preserved request and response shapes", () => {
    expect(
      searchRequestSchema.parse({
        query: "Who is Jesus?",
        policy: {
          allowedSourceKeys: ["jesusfilm-org"],
          preferSourceKey: "jesusfilm-org",
          language: "en",
          category: "gospel",
          topK: 5,
          minScore: 0.37,
          includeDocument: true,
        },
      }),
    ).toBeTruthy()

    const result = rankedResultSchema.parse({
      chunkId: "chunk-1",
      score: 0.91,
      text: "Jesus is the Son of God.",
      ord: 0,
      tags: ["gospel"],
      citation: {
        sourceKey: "jesusfilm-org",
        sourceName: "Jesus Film Project",
        title: null,
        url: "https://www.jesusfilm.org/",
      },
      document: "Jesus is the Son of God.",
    })
    expect(
      searchResponseSchema.parse({ results: [result] }).results,
    ).toHaveLength(1)
  })

  it("rejects unknown policy fields and abusive request bounds", () => {
    expect(() =>
      retrievalPolicySchema.parse({ audience: "children" }),
    ).toThrow()
    expect(() => retrievalPolicySchema.parse({ topK: 51 })).toThrow()
    expect(() => retrievalPolicySchema.parse({ minScore: -0.1 })).toThrow()
    expect(() => searchRequestSchema.parse({ query: "" })).toThrow()
    expect(() =>
      searchRequestSchema.parse({ query: "x".repeat(2001) }),
    ).toThrow()
  })
})
