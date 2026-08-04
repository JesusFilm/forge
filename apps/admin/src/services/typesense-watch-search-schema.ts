import type { TypesenseCollectionSchema } from "./typesense-client"

export const TYPESENSE_WATCH_CATALOG_ALIAS = "watch_search_catalog"
export const TYPESENSE_WATCH_TRANSCRIPT_ALIAS = "watch_search_transcripts"
export const TYPESENSE_WATCH_EMBEDDING_DIMENSIONS = 1536

export type TypesenseWatchLocale = {
  locale: string
  title: string
  description: string | null
}

export type TypesenseWatchAudioOption = {
  id: string
  languageId: string
  languageSlug: string
  languageEnglishName: string | null
  playbackId: string | null
  durationSeconds: number | null
}

export type TypesenseWatchSubtitleOption = {
  id: string
  languageId: string
  languageSlug: string
}

export type TypesenseWatchCatalogDocument = {
  id: string
  coreId: string | null
  slug: string
  titles: string[]
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

export type TypesenseWatchTranscriptDocument = {
  id: string
  videoId: string
  language: string
  publiclyVisible: boolean
  text: string
  startSeconds: number | null
  embedding: number[]
}

function physicalName(alias: string, buildId: string): string {
  return `${alias}_${buildId.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

export function watchCatalogCollectionSchema(
  buildId: string,
): TypesenseCollectionSchema {
  return {
    name: physicalName(TYPESENSE_WATCH_CATALOG_ALIAS, buildId),
    fields: [
      { name: "slug", type: "string" },
      { name: "titles", type: "string[]" },
      { name: "descriptions", type: "string[]", optional: true },
      { name: "audioLanguageSlugs", type: "string[]", facet: true },
      { name: "subtitleLanguageSlugs", type: "string[]", facet: true },
      { name: "childCount", type: "int32" },
    ],
  }
}

export function watchTranscriptCollectionSchema(
  buildId: string,
): TypesenseCollectionSchema {
  return {
    name: physicalName(TYPESENSE_WATCH_TRANSCRIPT_ALIAS, buildId),
    fields: [
      { name: "videoId", type: "string", facet: true },
      { name: "language", type: "string", facet: true },
      { name: "publiclyVisible", type: "bool", facet: true },
      { name: "text", type: "string", index: false },
      { name: "startSeconds", type: "float", optional: true, index: false },
      {
        name: "embedding",
        type: "float[]",
        num_dim: TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
      },
    ],
  }
}
