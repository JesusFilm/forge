import { describe, expect, it } from "vitest"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  watchAvailabilityCollectionSchema,
  watchCatalogCollectionSchema,
  watchLexicalCollectionSchema,
  watchTranscriptCollectionSchema,
} from "./typesense-watch-search-schema"

describe("Typesense Watch Search schemas", () => {
  it("uses isolated physical collection names", () => {
    expect(watchCatalogCollectionSchema("2026-08-03T12:00:00Z").name).toBe(
      "watch_search_catalog_2026-08-03T12_00_00Z",
    )
  })

  it("keeps catalog hydration fields out of the lexical index", () => {
    const schema = watchCatalogCollectionSchema("build")
    expect(schema.fields).toContainEqual({
      name: "localeCodes",
      type: "string[]",
      optional: true,
      index: false,
    })
    expect(schema.fields).toEqual(
      expect.arrayContaining([
        { name: "slug", type: "string", index: false },
        { name: "titles", type: "string[]", index: false },
        {
          name: "descriptions",
          type: "string[]",
          optional: true,
          index: false,
        },
      ]),
    )
  })

  it("stores targetable video-language availability in a separate index", () => {
    const schema = watchAvailabilityCollectionSchema("build")

    expect(schema.name).toBe(`${TYPESENSE_WATCH_AVAILABILITY_ALIAS}_build`)
    expect(schema.fields).toEqual(
      expect.arrayContaining([
        { name: "videoId", type: "string", facet: true },
        { name: "languageId", type: "string", facet: true },
        { name: "languageSlug", type: "string", facet: true },
        { name: "audio", type: "bool", facet: true },
        { name: "subtitles", type: "bool", facet: true },
      ]),
    )
  })

  it("defines locale-aware lexical fields and faceted canonical identity", () => {
    const schema = watchLexicalCollectionSchema("build", ["mi", "th", "zh"])

    expect(schema.name).toBe(`${TYPESENSE_WATCH_LEXICAL_ALIAS}_build`)
    expect(schema.fields).toEqual(
      expect.arrayContaining([
        { name: "videoId", type: "string", facet: true },
        { name: "canonicalVideoId", type: "string", facet: true },
        { name: "languageIdentity", type: "string", facet: true },
        { name: "localeCodes", type: "string[]", facet: true },
        {
          name: "title_zh",
          type: "string[]",
          locale: "zh",
          optional: true,
        },
        {
          name: "metadata_th",
          type: "string[]",
          locale: "th",
          optional: true,
        },
        {
          name: "title_mi",
          type: "string[]",
          locale: "mi",
          optional: true,
        },
        { name: "title_fallback", type: "string[]", optional: true },
        { name: "metadata_fallback", type: "string[]", optional: true },
      ]),
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

  it("upgrades transcripts into one native hybrid collection", () => {
    const schema = watchTranscriptCollectionSchema("build")

    expect(schema.fields).toEqual(
      expect.arrayContaining([
        { name: "documentKind", type: "string", facet: true },
        { name: "videoId", type: "string", facet: true },
        { name: "canonicalVideoId", type: "string", facet: true },
        { name: "language", type: "string", facet: true },
        { name: "publiclyVisible", type: "bool", facet: true },
        { name: "titles", type: "string[]", optional: true },
        { name: "descriptions", type: "string[]", optional: true },
        {
          name: "embedding",
          type: "float[]",
          num_dim: TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
          optional: true,
        },
      ]),
    )
  })
})
