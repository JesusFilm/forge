import { describe, expect, it } from "vitest"
import {
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  watchCatalogCollectionSchema,
  watchTranscriptCollectionSchema,
} from "./typesense-watch-search-schema"

describe("Typesense Watch Search schemas", () => {
  it("uses isolated physical collection names", () => {
    expect(watchCatalogCollectionSchema("2026-08-03T12:00:00Z").name).toBe(
      "watch_search_catalog_2026-08-03T12_00_00Z",
    )
  })

  it("keeps transcript vectors at the existing embedding dimensions", () => {
    const schema = watchTranscriptCollectionSchema("build")
    const embedding = schema.fields.find((field) => field.name === "embedding")
    expect(embedding).toMatchObject({
      type: "float[]",
      num_dim: TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
    })
    expect(schema.fields).toContainEqual({
      name: "publiclyVisible",
      type: "bool",
      facet: true,
    })
  })
})
