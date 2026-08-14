import { describe, expect, it } from "vitest"
import { TYPESENSE_WATCH_TOKENIZER_LOCALES } from "./typesense-watch-search-lexical"
import {
  candidateWatchCollectionSchemas,
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CANDIDATE_PREFIX,
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

  it("uses candidate-only collision-proof physical names and all tokenizer fields", () => {
    const schemas = candidateWatchCollectionSchemas("candidate_01")

    expect(schemas.catalog.name).toBe(
      `${TYPESENSE_WATCH_CANDIDATE_PREFIX}_candidate_01_catalog`,
    )
    expect(schemas.availability.name).toBe(
      `${TYPESENSE_WATCH_CANDIDATE_PREFIX}_candidate_01_availability`,
    )
    expect(schemas.lexical.name).toBe(
      `${TYPESENSE_WATCH_CANDIDATE_PREFIX}_candidate_01_lexical`,
    )
    expect(schemas.lexical.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "title_en", locale: "en" }),
        expect.objectContaining({ name: "metadata_zh", locale: "zh" }),
        expect.objectContaining({
          name: "taxonomy_stem_ko",
          locale: "ko",
          stem: true,
        }),
        {
          name: "title_exact_keys",
          type: "string[]",
          optional: true,
        },
        expect.objectContaining({ name: "title_fallback" }),
        expect.objectContaining({ name: "metadata_fallback" }),
        expect.objectContaining({ name: "taxonomy_fallback" }),
      ]),
    )
    expect(schemas.lexical.fields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "title_mi" })]),
    )
    expect(
      Object.values(schemas).every(
        (schema) => !schema.name.startsWith("watch_search_catalog_"),
      ),
    ).toBe(true)
  })

  it("rejects candidate generation ids that could collide after sanitization", () => {
    expect(() => candidateWatchCollectionSchemas("unsafe:id")).toThrow(
      "candidate generation id",
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
        {
          name: "videoEditionId",
          type: "string",
          facet: true,
          optional: true,
        },
        { name: "languageId", type: "string", facet: true },
        { name: "languageSlug", type: "string", facet: true },
        { name: "audio", type: "bool", facet: true },
        { name: "subtitles", type: "bool", facet: true },
        {
          name: "hrefLanguageSlug",
          type: "string",
          optional: true,
          index: false,
        },
      ]),
    )
  })

  it("defines locale-aware lexical fields and faceted canonical identity", () => {
    const schema = watchLexicalCollectionSchema("build")

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
          name: "title_stem_zh",
          type: "string[]",
          locale: "zh",
          optional: true,
          stem: true,
        },
        {
          name: "taxonomy_zh",
          type: "string[]",
          locale: "zh",
          optional: true,
        },
        {
          name: "taxonomy_stem_zh",
          type: "string[]",
          locale: "zh",
          optional: true,
          stem: true,
        },
        { name: "title_fallback", type: "string[]", optional: true },
        { name: "metadata_fallback", type: "string[]", optional: true },
        { name: "taxonomy_fallback", type: "string[]", optional: true },
      ]),
    )
    expect(schema.fields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "title_mi" })]),
    )
  })

  it("declares the exact fixed 153-field searchable lexical manifest", () => {
    const schema = watchLexicalCollectionSchema("build")
    const expectedNames = [
      ...TYPESENSE_WATCH_TOKENIZER_LOCALES.flatMap((locale) => [
        `title_${locale}`,
        `metadata_${locale}`,
      ]),
      ...TYPESENSE_WATCH_TOKENIZER_LOCALES.flatMap((locale) => [
        `title_stem_${locale}`,
        `metadata_stem_${locale}`,
        `taxonomy_${locale}`,
        `taxonomy_stem_${locale}`,
      ]),
      "title_fallback",
      "metadata_fallback",
      "taxonomy_fallback",
    ]
    const searchableNames = schema.fields
      .map((field) => field.name)
      .filter((name) => expectedNames.includes(name))

    expect(searchableNames).toEqual(expectedNames)
    expect(searchableNames).toHaveLength(153)
    expect(schema.fields).not.toContainEqual(
      expect.objectContaining({ name: "title_exact_keys" }),
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
        {
          name: "videoEditionId",
          type: "string",
          optional: true,
          index: false,
        },
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
