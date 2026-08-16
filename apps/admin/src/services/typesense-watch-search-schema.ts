import type { TypesenseCollectionSchema } from "./typesense-client"
import { TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD } from "./typesense-watch-search-exact-title"
import { TYPESENSE_WATCH_TOKENIZER_LOCALES } from "./typesense-watch-search-lexical"

export const TYPESENSE_WATCH_CATALOG_ALIAS = "watch_search_catalog"
export const TYPESENSE_WATCH_AVAILABILITY_ALIAS = "watch_search_availability"
export const TYPESENSE_WATCH_LEXICAL_ALIAS = "watch_search_lexical"
export const TYPESENSE_WATCH_TRANSCRIPT_ALIAS = "watch_search_transcripts"
export const TYPESENSE_WATCH_CANDIDATE_PREFIX = "watch_search_candidate"
export const TYPESENSE_WATCH_EMBEDDING_DIMENSIONS = 1536

export type TypesenseWatchLocale = {
  locale: string
  languageSlug?: string | null
  title: string
  description: string | null
}

export type TypesenseWatchAudioOption = {
  id: string
  videoEditionId?: string | null
  languageId: string
  languageSlug: string
  languageEnglishName: string | null
  playbackId: string | null
  durationSeconds: number | null
}

export type TypesenseWatchSubtitleOption = {
  id: string
  videoEditionId?: string | null
  languageId: string
  languageSlug: string
  languageEnglishName?: string | null
  hrefLanguageSlug?: string | null
  playbackId?: string | null
  durationSeconds?: number | null
  actionVideoDubId?: string | null
  actionPriority?: number | null
}

export type TypesenseWatchCatalogDocument = {
  id: string
  coreId: string | null
  slug: string
  titles: string[]
  localeCodes?: string[]
  descriptions: string[]
  localesJson: string
  label: string | null
  childCount: number
  imageUrl: string | null
  imageBlurDataUrl: string | null
  audioLanguageSlugs: string[]
  subtitleLanguageSlugs: string[]
  audioOptionsJson: string
  subtitleOptionsJson: string
}

export type TypesenseWatchAvailabilityDocument = {
  id: string
  videoId: string
  videoEditionId?: string | null
  languageId: string
  languageSlug: string
  languageEnglishName: string | null
  audio: boolean
  subtitles: boolean
  playbackId: string | null
  durationSeconds: number | null
  hrefLanguageSlug?: string | null
  actionVideoDubId?: string | null
  actionPriority?: number | null
}

export type TypesenseWatchTranscriptDocument = {
  id: string
  documentKind: "video" | "transcript"
  videoId: string
  videoEditionId?: string
  canonicalVideoId: string
  language: string
  publiclyVisible: boolean
  titles?: string[]
  descriptions?: string[]
  catalogGeneration?: string
  text: string
  startSeconds: number | null
  embedding?: number[]
}

function physicalName(alias: string, buildId: string): string {
  return `${alias}_${buildId.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

function candidateGenerationId(generationId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(generationId)) {
    throw new Error(
      "Typesense Watch candidate generation id must be a collision-proof safe token",
    )
  }
  return generationId
}

export function candidateWatchCollectionNames(generationId: string) {
  const id = candidateGenerationId(generationId)
  const prefix = `${TYPESENSE_WATCH_CANDIDATE_PREFIX}_${id}`
  return {
    catalog: `${prefix}_catalog`,
    availability: `${prefix}_availability`,
    lexical: `${prefix}_lexical`,
  } as const
}

export function candidateWatchCollectionSchemas(
  generationId: string,
  tokenizerLocales: readonly string[] = TYPESENSE_WATCH_TOKENIZER_LOCALES,
) {
  const names = candidateWatchCollectionNames(generationId)
  return {
    catalog: {
      ...watchCatalogCollectionSchema("candidate"),
      name: names.catalog,
    },
    availability: {
      ...watchAvailabilityCollectionSchema("candidate"),
      name: names.availability,
    },
    lexical: {
      ...candidateWatchLexicalCollectionSchema("candidate", tokenizerLocales),
      name: names.lexical,
    },
  } satisfies Record<
    keyof ReturnType<typeof candidateWatchCollectionNames>,
    TypesenseCollectionSchema
  >
}

export function candidateWatchLexicalCollectionSchema(
  buildId: string,
  tokenizerLocales: readonly string[] = TYPESENSE_WATCH_TOKENIZER_LOCALES,
): TypesenseCollectionSchema {
  const schema = watchLexicalCollectionSchema(buildId, tokenizerLocales)
  return {
    ...schema,
    fields: [
      ...schema.fields,
      {
        name: TYPESENSE_WATCH_EXACT_TITLE_KEYS_FIELD,
        type: "string[]",
        optional: true,
      },
    ],
  }
}

export function watchCatalogCollectionSchema(
  buildId: string,
): TypesenseCollectionSchema {
  return {
    name: physicalName(TYPESENSE_WATCH_CATALOG_ALIAS, buildId),
    fields: [
      { name: "slug", type: "string", index: false },
      { name: "titles", type: "string[]", index: false },
      { name: "localeCodes", type: "string[]", optional: true, index: false },
      {
        name: "descriptions",
        type: "string[]",
        optional: true,
        index: false,
      },
      { name: "audioLanguageSlugs", type: "string[]", facet: true },
      { name: "subtitleLanguageSlugs", type: "string[]", facet: true },
      { name: "childCount", type: "int32" },
    ],
  }
}

export function watchAvailabilityCollectionSchema(
  buildId: string,
): TypesenseCollectionSchema {
  return {
    name: physicalName(TYPESENSE_WATCH_AVAILABILITY_ALIAS, buildId),
    fields: [
      { name: "videoId", type: "string", facet: true },
      { name: "videoEditionId", type: "string", facet: true, optional: true },
      { name: "languageId", type: "string", facet: true },
      { name: "languageSlug", type: "string", facet: true },
      { name: "audio", type: "bool", facet: true },
      { name: "subtitles", type: "bool", facet: true },
      {
        name: "languageEnglishName",
        type: "string",
        optional: true,
        index: false,
      },
      { name: "playbackId", type: "string", optional: true, index: false },
      {
        name: "durationSeconds",
        type: "int32",
        optional: true,
        index: false,
      },
      {
        name: "hrefLanguageSlug",
        type: "string",
        optional: true,
        index: false,
      },
      {
        name: "actionVideoDubId",
        type: "string",
        optional: true,
        index: false,
      },
      {
        name: "actionPriority",
        type: "int32",
        optional: true,
        index: false,
      },
    ],
  }
}

export function watchLexicalCollectionSchema(
  buildId: string,
  tokenizerLocales: readonly string[] = TYPESENSE_WATCH_TOKENIZER_LOCALES,
): TypesenseCollectionSchema {
  const localizedFields = [...new Set(tokenizerLocales)].flatMap((locale) =>
    ["title", "metadata"].map((lane) => ({
      name: `${lane}_${locale}`,
      type: "string[]",
      locale,
      optional: true,
    })),
  )
  return {
    name: physicalName(TYPESENSE_WATCH_LEXICAL_ALIAS, buildId),
    fields: [
      { name: "videoId", type: "string", facet: true },
      { name: "canonicalVideoId", type: "string", facet: true },
      { name: "languageIdentity", type: "string", facet: true },
      { name: "localeCodes", type: "string[]", facet: true },
      ...localizedFields,
      { name: "title_fallback", type: "string[]", optional: true },
      { name: "metadata_fallback", type: "string[]", optional: true },
    ],
  }
}

export function watchTranscriptCollectionSchema(
  buildId: string,
): TypesenseCollectionSchema {
  return {
    name: physicalName(TYPESENSE_WATCH_TRANSCRIPT_ALIAS, buildId),
    fields: [
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
        name: "catalogGeneration",
        type: "string",
        facet: true,
        optional: true,
      },
      { name: "text", type: "string", index: false },
      { name: "startSeconds", type: "float", optional: true, index: false },
      {
        name: "embedding",
        type: "float[]",
        num_dim: TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
        optional: true,
      },
    ],
  }
}
