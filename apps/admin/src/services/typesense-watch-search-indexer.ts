import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { notRestrictedFromWatchWhere } from "./search-watchability"
import { TypesenseClient } from "./typesense-client"
import { canonicalTypesenseVideoId } from "./typesense-watch-search-identifiers"
import {
  buildTypesenseWatchLexicalDocuments,
  estimateTypesenseKeywordMemory,
  typesenseWatchTokenizerLocales,
} from "./typesense-watch-search-lexical"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  type TypesenseWatchAudioOption,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
  type TypesenseWatchLocale,
  type TypesenseWatchSubtitleOption,
  type TypesenseWatchTranscriptDocument,
  watchAvailabilityCollectionSchema,
  watchCatalogCollectionSchema,
  watchLexicalCollectionSchema,
  watchTranscriptCollectionSchema,
} from "./typesense-watch-search-schema"

const DEFAULT_BATCH_SIZE = 100
const TYPESENSE_VECTOR_BYTES_PER_DIMENSION = 7

type SubtitleIndexRow = {
  id: string
  videoId: string
  languageId: string
  languageSlug: string
}

type TranscriptIndexRow = {
  id: string
  videoId: string
  coreId: string | null
  language: string
  publiclyVisible: boolean
  text: string
  startSeconds: number | null
  embeddingText: string
}

export type TypesenseWatchSearchIndexStats = {
  catalogDocuments: number
  availabilityDocuments: number
  lexicalDocuments: number
  lexicalSearchableBytes: number
  estimatedKeywordMemoryLowBytes: number
  estimatedKeywordMemoryHighBytes: number
  videoDocuments: number
  transcriptDocuments: number
  publicTranscriptDocuments: number
  estimatedVectorMemoryBytes: number
  catalogCollection: string
  availabilityCollection: string
  lexicalCollection: string
  transcriptCollection: string
  transcriptReused: boolean
  hybridReady: boolean
  retiredCollections: string[]
  retirementFailures: Array<{ collection: string; error: string }>
}

export type TypesenseWatchSearchTranscriptStrategy = "reuse" | "rebuild"

const MANAGED_COLLECTION_PREFIXES = [
  `${TYPESENSE_WATCH_CATALOG_ALIAS}_`,
  `${TYPESENSE_WATCH_AVAILABILITY_ALIAS}_`,
  `${TYPESENSE_WATCH_LEXICAL_ALIAS}_`,
  `${TYPESENSE_WATCH_TRANSCRIPT_ALIAS}_`,
] as const

function isManagedWatchCollection(name: string): boolean {
  return MANAGED_COLLECTION_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function isHybridTranscriptCollection(
  collection: { fields: Array<{ name: string }> } | undefined,
): boolean {
  if (!collection) return false
  const fields = new Set(collection.fields.map((field) => field.name))
  return (
    fields.has("documentKind") &&
    fields.has("canonicalVideoId") &&
    fields.has("titles")
  )
}

export class TypesenseWatchSearchIndexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TypesenseWatchSearchIndexError"
  }
}

export function estimateTypesenseVectorMemoryBytes(
  records: number,
  dimensions = TYPESENSE_WATCH_EMBEDDING_DIMENSIONS,
): number {
  if (!Number.isInteger(records) || records < 0) {
    throw new TypesenseWatchSearchIndexError(
      "Typesense vector record count must be a non-negative integer",
    )
  }
  if (!Number.isInteger(dimensions) || dimensions <= 0) {
    throw new TypesenseWatchSearchIndexError(
      "Typesense vector dimensions must be a positive integer",
    )
  }
  return records * dimensions * TYPESENSE_VECTOR_BYTES_PER_DIMENSION
}

function englishName(value: unknown): string | null {
  if (value && typeof value === "object" && "en" in value) {
    const name = (value as { en?: unknown }).en
    return typeof name === "string" && name.trim() ? name : null
  }
  return null
}

function bestImageUrl(image: {
  url: string | null
  mobileCinematicHigh: string | null
  mobileCinematicLow: string | null
  videoStill: string | null
  thumbnail: string | null
}): string | null {
  return (
    image.mobileCinematicHigh ??
    image.mobileCinematicLow ??
    image.videoStill ??
    image.thumbnail ??
    image.url
  )
}

export function parseTypesenseVector(value: string): number[] {
  const trimmed = value.trim()
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new TypesenseWatchSearchIndexError("Transcript vector is malformed")
  }
  const embedding = trimmed.slice(1, -1).split(",").map(Number)
  if (
    embedding.length !== TYPESENSE_WATCH_EMBEDDING_DIMENSIONS ||
    embedding.some((entry) => !Number.isFinite(entry))
  ) {
    throw new TypesenseWatchSearchIndexError(
      `Transcript vector must contain ${TYPESENSE_WATCH_EMBEDDING_DIMENSIONS} finite values`,
    )
  }
  return embedding
}

export { canonicalTypesenseVideoId } from "./typesense-watch-search-identifiers"

function subtitleOptionsByVideo(rows: readonly SubtitleIndexRow[]) {
  const result = new Map<string, TypesenseWatchSubtitleOption[]>()
  for (const row of rows) {
    const options = result.get(row.videoId) ?? []
    if (!options.some((option) => option.languageId === row.languageId)) {
      options.push({
        id: row.id,
        languageId: row.languageId,
        languageSlug: row.languageSlug,
      })
    }
    result.set(row.videoId, options)
  }
  return result
}

async function loadSubtitleRows(
  prisma: PrismaClient,
): Promise<SubtitleIndexRow[]> {
  return prisma.$queryRaw<SubtitleIndexRow[]>(Prisma.sql`
    SELECT DISTINCT ON (vd.video_id, vs.language_id)
      vs.id,
      vd.video_id AS "videoId",
      l.id AS "languageId",
      l.slug AS "languageSlug"
    FROM video_subtitle vs
    JOIN video_edition ve
      ON ve.id = vs.video_edition_id
     AND ve.deleted_at IS NULL
    JOIN video_dub vd
      ON vd.video_edition_id = vs.video_edition_id
     AND vd.deleted_at IS NULL
    JOIN video v
      ON v.id = vd.video_id
     AND v.deleted_at IS NULL
     AND v.no_index = false
    JOIN language l
      ON l.id = vs.language_id
     AND l.deleted_at IS NULL
     AND l.slug IS NOT NULL
    WHERE vs.deleted_at IS NULL
      AND (vs.vtt_src IS NOT NULL OR vs.srt_src IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM video_locale vl
        WHERE vl.video_id = v.id
          AND vl.status = 'published'
          AND vl.deleted_at IS NULL
      )
    ORDER BY vd.video_id, vs.language_id, vs.id
  `)
}

export async function buildCatalogDocuments(
  prisma: PrismaClient,
): Promise<TypesenseWatchCatalogDocument[]> {
  const [videos, subtitleRows] = await Promise.all([
    prisma.video.findMany({
      where: {
        deletedAt: null,
        noIndex: false,
        locales: { some: { status: "PUBLISHED", deletedAt: null } },
        ...notRestrictedFromWatchWhere(),
      },
      orderBy: { id: "asc" },
      select: {
        id: true,
        coreId: true,
        slug: true,
        label: true,
        locales: {
          where: {
            status: "PUBLISHED",
            deletedAt: null,
          },
          orderBy: { id: "asc" },
          select: {
            locale: true,
            languageSlug: true,
            title: true,
            description: true,
          },
        },
        dubs: {
          where: {
            deletedAt: null,
            published: true,
            AND: [{ hls: { not: null } }, { hls: { not: "" } }],
            language: { deletedAt: null, slug: { not: null } },
            OR: [
              { videoEditionId: null },
              { videoEdition: { deletedAt: null } },
            ],
          },
          orderBy: [{ duration: "desc" }, { id: "asc" }],
          select: {
            id: true,
            duration: true,
            language: { select: { id: true, slug: true, name: true } },
            muxVideo: { select: { playbackId: true } },
          },
        },
        images: {
          where: { deletedAt: null },
          orderBy: { id: "asc" },
          select: {
            url: true,
            mobileCinematicHigh: true,
            mobileCinematicLow: true,
            videoStill: true,
            thumbnail: true,
            blurDataUrl: true,
          },
        },
        children: {
          where: { child: { deletedAt: null } },
          select: { childId: true },
        },
      },
    }),
    loadSubtitleRows(prisma),
  ])
  const subtitlesByVideo = subtitleOptionsByVideo(subtitleRows)

  return videos.flatMap((video) => {
    const locales: TypesenseWatchLocale[] = video.locales.flatMap((locale) =>
      locale.locale
        ? [
            {
              locale: locale.locale,
              languageSlug: locale.languageSlug,
              title: locale.title?.trim() ?? "",
              description: locale.description,
            },
          ]
        : [],
    )
    if (locales.length === 0) return []
    const titledLocales = locales.filter(({ title }) => title.length > 0)

    const audioOptions: TypesenseWatchAudioOption[] = []
    for (const dub of video.dubs) {
      const language = dub.language
      if (!language?.slug) continue
      if (audioOptions.some((option) => option.languageId === language.id)) {
        continue
      }
      audioOptions.push({
        id: dub.id,
        languageId: language.id,
        languageSlug: language.slug,
        languageEnglishName: englishName(language.name),
        playbackId: dub.muxVideo?.playbackId ?? null,
        durationSeconds: dub.duration,
      })
    }
    const subtitleOptions = subtitlesByVideo.get(video.id) ?? []
    const firstImage = video.images.find((image) => bestImageUrl(image) != null)

    return [
      {
        id: video.id,
        coreId: video.coreId,
        slug: video.slug,
        titles: titledLocales.map((locale) => locale.title),
        localeCodes: titledLocales.map((locale) => locale.locale),
        descriptions: locales.flatMap((locale) =>
          locale.description ? [locale.description] : [],
        ),
        localesJson: JSON.stringify(locales),
        label: video.label ?? null,
        childCount: video.children.length,
        imageUrl: firstImage ? bestImageUrl(firstImage) : null,
        imageBlurDataUrl: firstImage?.blurDataUrl ?? null,
        audioLanguageSlugs: audioOptions.map((option) => option.languageSlug),
        subtitleLanguageSlugs: subtitleOptions.map(
          (option) => option.languageSlug,
        ),
        audioOptionsJson: JSON.stringify(audioOptions),
        subtitleOptionsJson: JSON.stringify(subtitleOptions),
      },
    ]
  })
}

export function buildAvailabilityDocuments(
  catalog: readonly TypesenseWatchCatalogDocument[],
): TypesenseWatchAvailabilityDocument[] {
  return catalog.flatMap((document) => {
    const byLanguage = new Map<string, TypesenseWatchAvailabilityDocument>()
    const audioOptions = JSON.parse(
      document.audioOptionsJson,
    ) as TypesenseWatchAudioOption[]
    const subtitleOptions = JSON.parse(
      document.subtitleOptionsJson,
    ) as TypesenseWatchSubtitleOption[]

    for (const option of audioOptions) {
      byLanguage.set(option.languageId, {
        id: `${document.id}:${option.languageId}`,
        videoId: document.id,
        languageId: option.languageId,
        languageSlug: option.languageSlug,
        languageEnglishName: option.languageEnglishName,
        audio: true,
        subtitles: false,
        playbackId: option.playbackId,
        durationSeconds: option.durationSeconds,
      })
    }
    for (const option of subtitleOptions) {
      const existing = byLanguage.get(option.languageId)
      if (existing) {
        existing.subtitles = true
      } else {
        byLanguage.set(option.languageId, {
          id: `${document.id}:${option.languageId}`,
          videoId: document.id,
          languageId: option.languageId,
          languageSlug: option.languageSlug,
          languageEnglishName: null,
          audio: false,
          subtitles: true,
          playbackId: null,
          durationSeconds: null,
        })
      }
    }
    return [...byLanguage.values()]
  })
}

export type TypesenseWatchCandidateProjectionSnapshot = {
  catalog: TypesenseWatchCatalogDocument[]
  availability: TypesenseWatchAvailabilityDocument[]
  lexical: ReturnType<typeof buildTypesenseWatchLexicalDocuments>
  tokenizerLocales: string[]
  counts: { catalog: number; availability: number; lexical: number }
  digests: {
    catalog: string
    availability: string
    lexical: string
    combined: string
  }
  lexicalMemory: ReturnType<typeof estimateTypesenseKeywordMemory>
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableJsonValue(child)]),
    )
  }
  return value
}

function projectionDigest(value: unknown): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(stableJsonValue(value)))
    .digest("hex")
  return `sha256:${digest}`
}

export async function buildTypesenseWatchCandidateProjectionSnapshot(
  prisma: PrismaClient,
): Promise<TypesenseWatchCandidateProjectionSnapshot> {
  return prisma.$transaction(
    async (tx) => {
      const catalog = (await buildCatalogDocuments(tx as PrismaClient)).sort(
        (left, right) => left.id.localeCompare(right.id),
      )
      const availability = buildAvailabilityDocuments(catalog).sort(
        (left, right) => left.id.localeCompare(right.id),
      )
      const lexical = buildTypesenseWatchLexicalDocuments(catalog).sort(
        (left, right) => left.id.localeCompare(right.id),
      )
      const tokenizerLocales = typesenseWatchTokenizerLocales(lexical)
      const catalogDigest = projectionDigest(catalog)
      const availabilityDigest = projectionDigest(availability)
      const lexicalDigest = projectionDigest(lexical)
      const digests = {
        catalog: catalogDigest,
        availability: availabilityDigest,
        lexical: lexicalDigest,
        combined: projectionDigest({
          catalog: catalogDigest,
          availability: availabilityDigest,
          lexical: lexicalDigest,
        }),
      }
      return {
        catalog,
        availability,
        lexical,
        tokenizerLocales,
        counts: {
          catalog: catalog.length,
          availability: availability.length,
          lexical: lexical.length,
        },
        digests,
        lexicalMemory: estimateTypesenseKeywordMemory(lexical),
      }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  )
}

async function loadTranscriptBatch(
  prisma: PrismaClient,
  afterId: string | null,
  limit: number,
): Promise<TranscriptIndexRow[]> {
  return prisma.$queryRaw<TranscriptIndexRow[]>(Prisma.sql`
    SELECT
      vtc.id,
      vt.video_id AS "videoId",
      v.core_id AS "coreId",
      vtc.language,
      COALESCE(
        NULLIF(vtc.content_summary, ''),
        NULLIF(vtc.raw_source_text, ''),
        vtc.text
      ) AS text,
      vtc.start_seconds AS "startSeconds",
      vtc.embedding::text AS "embeddingText",
      (
        v.deleted_at IS NULL
        AND v.no_index = false
        AND EXISTS (
          SELECT 1 FROM video_locale vl
          WHERE vl.video_id = v.id
            AND vl.locale = vtc.language
            AND vl.status = 'published'
            AND vl.deleted_at IS NULL
        )
      ) AS "publiclyVisible"
    FROM video_transcript_chunk vtc
    JOIN video_transcript vt
      ON vt.id = vtc.transcript_id
     AND vt.embedding_provider = 'jesus-film-ai-gateway'
     AND vt.model = 'embeddings'
     AND vt.dimensions = ${TYPESENSE_WATCH_EMBEDDING_DIMENSIONS}
     AND vt.embedding_native_dimensions = ${TYPESENSE_WATCH_EMBEDDING_DIMENSIONS}
     AND vt.embedding_transform_version IS NULL
    JOIN video v
      ON v.id = vt.video_id
    WHERE vtc.embedding IS NOT NULL
      AND vtc.model = 'embeddings'
      AND vtc.dimensions = ${TYPESENSE_WATCH_EMBEDDING_DIMENSIONS}
      AND (${afterId}::text IS NULL OR vtc.id > ${afterId})
    ORDER BY vtc.id ASC
    LIMIT ${limit}
  `)
}

export async function rebuildTypesenseWatchSearchIndex({
  prisma,
  typesense,
  buildId = new Date().toISOString(),
  batchSize = DEFAULT_BATCH_SIZE,
  transcriptStrategy = "reuse",
  onProgress,
}: {
  prisma: PrismaClient
  typesense: TypesenseClient
  buildId?: string
  batchSize?: number
  transcriptStrategy?: TypesenseWatchSearchTranscriptStrategy
  onProgress?: (stats: {
    catalogDocuments: number
    availabilityDocuments: number
    lexicalDocuments: number
    lexicalSearchableBytes: number
    transcriptDocuments: number
    transcriptReused: boolean
  }) => void
}): Promise<TypesenseWatchSearchIndexStats> {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new TypesenseWatchSearchIndexError(
      "Typesense index batch size must be a positive integer",
    )
  }
  const catalogSchema = watchCatalogCollectionSchema(buildId)
  const availabilitySchema = watchAvailabilityCollectionSchema(buildId)
  const transcriptSchema = watchTranscriptCollectionSchema(buildId)
  const [
    existingCollections,
    previousCatalogAlias,
    previousAvailabilityAlias,
    previousLexicalAlias,
    previousTranscriptAlias,
  ] = await Promise.all([
    typesense.listCollections(),
    typesense.getAlias(TYPESENSE_WATCH_CATALOG_ALIAS),
    typesense.getAlias(TYPESENSE_WATCH_AVAILABILITY_ALIAS),
    typesense.getAlias(TYPESENSE_WATCH_LEXICAL_ALIAS),
    typesense.getAlias(TYPESENSE_WATCH_TRANSCRIPT_ALIAS),
  ])
  const existingManagedCollections = existingCollections
    .map((collection) => collection.name)
    .filter(isManagedWatchCollection)
  const transcriptReused =
    transcriptStrategy === "reuse" && previousTranscriptAlias != null
  const transcriptCollection = transcriptReused
    ? previousTranscriptAlias.collection_name
    : transcriptSchema.name
  const hybridReady = transcriptReused
    ? isHybridTranscriptCollection(
        existingCollections.find(
          (collection) => collection.name === transcriptCollection,
        ),
      )
    : true
  const catalog = await buildCatalogDocuments(prisma)
  const availability = buildAvailabilityDocuments(catalog)
  const lexical = buildTypesenseWatchLexicalDocuments(catalog)
  const lexicalSchema = watchLexicalCollectionSchema(
    buildId,
    typesenseWatchTokenizerLocales(lexical),
  )
  const keywordMemory = estimateTypesenseKeywordMemory(lexical)
  let catalogDocuments = 0
  let availabilityDocuments = 0
  let lexicalDocuments = 0
  const lexicalSearchableBytes = keywordMemory.searchableBytes
  const estimatedKeywordMemoryLowBytes = keywordMemory.estimatedRamLowBytes
  const estimatedKeywordMemoryHighBytes = keywordMemory.estimatedRamHighBytes
  const videoDocuments = 0
  let transcriptDocuments = 0
  let publicTranscriptDocuments = 0
  let catalogAliasUpdated = false
  let availabilityAliasUpdated = false
  let lexicalAliasUpdated = false
  let transcriptAliasUpdated = false

  if (transcriptReused) {
    const [allTranscripts, publicTranscripts] = await typesense.multiSearch([
      {
        collection: transcriptCollection,
        q: "*",
        filter_by: hybridReady ? "documentKind:=transcript" : undefined,
        per_page: 1,
        exclude_fields: "embedding,text",
      },
      {
        collection: transcriptCollection,
        q: "*",
        filter_by: hybridReady
          ? "documentKind:=transcript && publiclyVisible:=true"
          : "publiclyVisible:=true",
        per_page: 1,
        exclude_fields: "embedding,text",
      },
    ])
    transcriptDocuments = allTranscripts?.found ?? 0
    publicTranscriptDocuments = publicTranscripts?.found ?? 0
  }

  await typesense.createCollection(catalogSchema)
  try {
    await typesense.createCollection(availabilitySchema)
    await typesense.createCollection(lexicalSchema)
    if (!transcriptReused) {
      await typesense.createCollection(transcriptSchema)
    }
    for (let index = 0; index < catalog.length; index += batchSize) {
      const batch = catalog.slice(index, index + batchSize)
      await typesense.importDocuments(catalogSchema.name, batch)
      catalogDocuments += batch.length
      onProgress?.({
        catalogDocuments,
        availabilityDocuments,
        lexicalDocuments,
        lexicalSearchableBytes,
        transcriptDocuments,
        transcriptReused,
      })
    }
    for (let index = 0; index < availability.length; index += batchSize) {
      const batch = availability.slice(index, index + batchSize)
      await typesense.importDocuments(availabilitySchema.name, batch)
      availabilityDocuments += batch.length
      onProgress?.({
        catalogDocuments,
        availabilityDocuments,
        lexicalDocuments,
        lexicalSearchableBytes,
        transcriptDocuments,
        transcriptReused,
      })
    }
    for (let index = 0; index < lexical.length; index += batchSize) {
      const batch = lexical.slice(index, index + batchSize)
      await typesense.importDocuments(lexicalSchema.name, batch)
      lexicalDocuments += batch.length
      onProgress?.({
        catalogDocuments,
        availabilityDocuments,
        lexicalDocuments,
        lexicalSearchableBytes,
        transcriptDocuments,
        transcriptReused,
      })
    }

    if (!transcriptReused) {
      let afterId: string | null = null
      for (;;) {
        const rows = await loadTranscriptBatch(prisma, afterId, batchSize)
        if (rows.length === 0) break
        const documents: TypesenseWatchTranscriptDocument[] = rows.map(
          (row) => ({
            id: row.id,
            documentKind: "transcript",
            videoId: row.videoId,
            canonicalVideoId: canonicalTypesenseVideoId(
              row.videoId,
              row.coreId,
            ),
            language: row.language,
            publiclyVisible: row.publiclyVisible,
            text: row.text,
            startSeconds:
              row.startSeconds == null ? null : Number(row.startSeconds),
            embedding: parseTypesenseVector(row.embeddingText),
          }),
        )
        await typesense.importDocuments(transcriptSchema.name, documents)
        transcriptDocuments += documents.length
        for (const document of documents) {
          if (document.publiclyVisible) publicTranscriptDocuments += 1
        }
        afterId = rows.at(-1)?.id ?? null
        onProgress?.({
          catalogDocuments,
          availabilityDocuments,
          lexicalDocuments,
          lexicalSearchableBytes,
          transcriptDocuments,
          transcriptReused,
        })
      }
    }

    await typesense.upsertAlias(
      TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      availabilitySchema.name,
    )
    availabilityAliasUpdated = true
    await typesense.upsertAlias(
      TYPESENSE_WATCH_LEXICAL_ALIAS,
      lexicalSchema.name,
    )
    lexicalAliasUpdated = true
    if (!transcriptReused) {
      await typesense.upsertAlias(
        TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
        transcriptSchema.name,
      )
      transcriptAliasUpdated = true
    }
    await typesense.upsertAlias(
      TYPESENSE_WATCH_CATALOG_ALIAS,
      catalogSchema.name,
    )
    catalogAliasUpdated = true
  } catch (error) {
    const restoreAlias = async (
      alias: string,
      previousCollection: string | undefined,
      updated: boolean,
    ): Promise<boolean> => {
      if (!updated) return true
      try {
        if (previousCollection) {
          await typesense.upsertAlias(alias, previousCollection)
        } else {
          await typesense.deleteAlias(alias)
        }
        return true
      } catch {
        return false
      }
    }
    const [
      catalogRestored,
      availabilityRestored,
      lexicalRestored,
      transcriptRestored,
    ] = await Promise.all([
      restoreAlias(
        TYPESENSE_WATCH_CATALOG_ALIAS,
        previousCatalogAlias?.collection_name,
        catalogAliasUpdated,
      ),
      restoreAlias(
        TYPESENSE_WATCH_AVAILABILITY_ALIAS,
        previousAvailabilityAlias?.collection_name,
        availabilityAliasUpdated,
      ),
      restoreAlias(
        TYPESENSE_WATCH_LEXICAL_ALIAS,
        previousLexicalAlias?.collection_name,
        lexicalAliasUpdated,
      ),
      restoreAlias(
        TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
        previousTranscriptAlias?.collection_name,
        transcriptAliasUpdated,
      ),
    ])
    await Promise.allSettled([
      ...(catalogRestored
        ? [typesense.deleteCollection(catalogSchema.name)]
        : []),
      ...(!transcriptReused && transcriptRestored
        ? [typesense.deleteCollection(transcriptSchema.name)]
        : []),
      ...(availabilityRestored
        ? [typesense.deleteCollection(availabilitySchema.name)]
        : []),
      ...(lexicalRestored
        ? [typesense.deleteCollection(lexicalSchema.name)]
        : []),
    ])
    throw error
  }

  const activeCollections = new Set([
    catalogSchema.name,
    availabilitySchema.name,
    lexicalSchema.name,
    transcriptCollection,
  ])
  const collectionsToRetire = existingManagedCollections.filter(
    (collection) => !activeCollections.has(collection),
  )
  const retirementResults = await Promise.allSettled(
    collectionsToRetire.map((collection) =>
      typesense.deleteCollection(collection),
    ),
  )
  const retiredCollections: string[] = []
  const retirementFailures: Array<{ collection: string; error: string }> = []
  retirementResults.forEach((result, index) => {
    const collection = collectionsToRetire[index]
    if (collection == null) return
    if (result.status === "fulfilled") {
      retiredCollections.push(collection)
    } else {
      retirementFailures.push({
        collection,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
      })
    }
  })

  return {
    catalogDocuments,
    availabilityDocuments,
    lexicalDocuments,
    lexicalSearchableBytes,
    estimatedKeywordMemoryLowBytes,
    estimatedKeywordMemoryHighBytes,
    videoDocuments,
    transcriptDocuments,
    publicTranscriptDocuments,
    estimatedVectorMemoryBytes:
      estimateTypesenseVectorMemoryBytes(transcriptDocuments),
    catalogCollection: catalogSchema.name,
    availabilityCollection: availabilitySchema.name,
    lexicalCollection: lexicalSchema.name,
    transcriptCollection,
    transcriptReused,
    hybridReady,
    retiredCollections,
    retirementFailures,
  }
}
