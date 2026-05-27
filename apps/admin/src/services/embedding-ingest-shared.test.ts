import { describe, expect, it } from "vitest"

import {
  EmbeddingGenerationModeSchema,
  EmbeddingTimestampSchema,
  statusForEmbeddingRewrite,
} from "./embedding-ingest-shared"

describe("embedding ingest shared helpers", () => {
  it("defaults generation mode to idempotent and validates known modes", () => {
    expect(EmbeddingGenerationModeSchema.parse(undefined)).toBe("idempotent")
    expect(EmbeddingGenerationModeSchema.parse("repair")).toBe("repair")
    expect(() => EmbeddingGenerationModeSchema.parse("retry")).toThrow()
  })

  it("maps explicit rewrite modes to common Admin outcome statuses", () => {
    expect(statusForEmbeddingRewrite("repair")).toBe("repaired")
    expect(statusForEmbeddingRewrite("model-upgrade")).toBe("model_upgraded")
    expect(statusForEmbeddingRewrite("force")).toBe("forced")
  })

  it("validates timestamp-shaped provenance values", () => {
    expect(EmbeddingTimestampSchema.parse("2026-05-25T00:00:00.000Z")).toBe(
      "2026-05-25T00:00:00.000Z",
    )
    expect(() => EmbeddingTimestampSchema.parse("soon-ish")).toThrow()
  })
})
