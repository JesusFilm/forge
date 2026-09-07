import { execFileSync } from "node:child_process"
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http"
import { fileURLToPath } from "node:url"

import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "@/services/content-embedding-contract"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  _internals as transcriptEmbeddingIngestInternals,
  ingestTranscriptEmbeddings,
} from "./transcript-embedding-ingest.service"
import { TypesenseClient } from "./typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import { TypesenseWatchSearchService } from "./typesense-watch-search.service"
import {
  publishOneCurrentTranscriptToWatchSearch,
  WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID,
} from "./typesense-watch-search-transcript-publication"
import {
  TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID,
  withTypesenseWatchSearchIndexLock,
} from "./typesense-watch-search-publication-lock"
import { rebuildTypesenseWatchSearchIndex } from "./typesense-watch-search-indexer"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
  watchAvailabilityCollectionSchema,
  watchCatalogCollectionSchema,
  watchLexicalCollectionSchema,
  watchTranscriptCollectionSchema,
  type TypesenseWatchAvailabilityDocument,
  type TypesenseWatchCatalogDocument,
} from "./typesense-watch-search-schema"

const RUN_REAL_DB_TEST = process.env.WATCH_SEARCH_DB_TEST === "1"
const baseDatabaseUrl = process.env.DATABASE_URL
const DEFAULT_VITEST_DATABASE_URL =
  "postgresql://test:test@localhost:5432/forge_admin_test"
const hasRealDatabaseUrl =
  !!baseDatabaseUrl && baseDatabaseUrl !== DEFAULT_VITEST_DATABASE_URL
const ALTERNATE_CONTENT_EMBEDDING_CONTRACT_ID =
  "semantic-transcript-pgvector-v2"

function databaseUrlForDatabase(baseUrl: string, database: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/${database}`
  url.searchParams.delete("schema")
  return url.toString()
}

function adminPackageRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url))
}

function makeEmbedding(seed = 1): number[] {
  return Array.from({ length: 1536 }, (_, index) => {
    if (index === 0) return seed
    if (index === 1) return seed / 2
    return 0
  })
}

function payloadSourceHash(value: {
  source: { text?: string }
  chunks: Array<{
    chunkIndex: number
    text: string
    startSeconds?: number
    endSeconds?: number
  }>
}): string {
  return transcriptEmbeddingIngestInternals.sha256Json({
    text: value.source.text ?? null,
    segments: null,
    chunks: value.chunks.map((chunk) => ({
      index: chunk.chunkIndex,
      text: chunk.text,
      startSeconds: chunk.startSeconds ?? null,
      endSeconds: chunk.endSeconds ?? null,
    })),
  })
}

type StoredCollection = {
  schema: { name: string; fields: Array<{ name: string }> }
  documents: Map<string, Record<string, unknown>>
}

class ControlledTypesenseServer {
  private readonly collections = new Map<string, StoredCollection>()
  private readonly aliases = new Map<string, string>()
  private server = createServer(this.handleRequest.bind(this))
  url = ""

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server.listen(0, "127.0.0.1", () => resolve())
    })
    const address = this.server.address()
    if (!address || typeof address === "string") {
      throw new Error("failed to bind controlled Typesense server")
    }
    this.url = `http://127.0.0.1:${address.port}`
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  reset(): void {
    this.collections.clear()
    this.aliases.clear()
  }

  private async readBody(request: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks).toString("utf8")
  }

  private json(response: ServerResponse, body: unknown, status = 200): void {
    response.statusCode = status
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify(body))
  }

  private text(response: ServerResponse, body: string, status = 200): void {
    response.statusCode = status
    response.setHeader("content-type", "text/plain")
    response.end(body)
  }

  private resolveCollection(name: string): StoredCollection | undefined {
    return this.collections.get(this.aliases.get(name) ?? name)
  }

  private exactList(filterBy: string | null, field: string): string[] | null {
    if (!filterBy) return null
    const match = new RegExp(`${field}:=\\[([^\\]]*)\\]`).exec(filterBy)
    if (!match) return null
    return [...match[1]!.matchAll(/`([^`]*)`/g)].map((entry) => entry[1]!)
  }

  private exactBoolean(filterBy: string | null, field: string): boolean | null {
    if (!filterBy) return null
    const match = new RegExp(`${field}:=(true|false)`).exec(filterBy)
    return match ? match[1] === "true" : null
  }

  private exactString(filterBy: string | null, field: string): string | null {
    if (!filterBy) return null
    const match = new RegExp(`${field}:=([A-Za-z_]+)`).exec(filterBy)
    return match?.[1] ?? null
  }

  private filterDocuments(
    documents: readonly Record<string, unknown>[],
    filterBy: string | null,
  ): Record<string, unknown>[] {
    return documents.filter((document) => {
      const idValues = this.exactList(filterBy, "id")
      if (idValues && !idValues.includes(String(document.id))) return false
      const videoIds = this.exactList(filterBy, "videoId")
      if (videoIds && !videoIds.includes(String(document.videoId))) return false
      const languageIds = this.exactList(filterBy, "languageId")
      if (
        languageIds &&
        !languageIds.includes(String(document.languageId ?? ""))
      ) {
        return false
      }
      const languages = this.exactList(filterBy, "language")
      if (languages && !languages.includes(String(document.language ?? ""))) {
        return false
      }
      const documentKind = this.exactString(filterBy, "documentKind")
      if (documentKind && document.documentKind !== documentKind) return false
      const publiclyVisible = this.exactBoolean(filterBy, "publiclyVisible")
      if (
        publiclyVisible != null &&
        document.publiclyVisible !== publiclyVisible
      ) {
        return false
      }
      const audio = this.exactBoolean(filterBy, "audio")
      if (audio != null && document.audio !== audio) return false
      return true
    })
  }

  private cosineSimilarity(
    left: readonly number[],
    right: readonly number[],
  ): number {
    let dot = 0
    let leftMagnitude = 0
    let rightMagnitude = 0
    for (let index = 0; index < left.length; index += 1) {
      const a = left[index] ?? 0
      const b = right[index] ?? 0
      dot += a * b
      leftMagnitude += a * a
      rightMagnitude += b * b
    }
    if (leftMagnitude === 0 || rightMagnitude === 0) return 0
    return dot / Math.sqrt(leftMagnitude * rightMagnitude)
  }

  private vectorQuery(request: Record<string, unknown>): {
    embedding: number[]
    k: number
    distanceThreshold: number | null
  } | null {
    const raw =
      typeof request.vector_query === "string" ? request.vector_query : null
    if (!raw) return null
    const match =
      /^embedding:\(\[([^\]]*)\], k:(\d+)(?:, distance_threshold:([0-9.]+))?\)$/.exec(
        raw,
      )
    if (!match) return null
    return {
      embedding: match[1]!.split(",").map(Number),
      k: Number(match[2]),
      distanceThreshold: match[3] == null ? null : Number(match[3]),
    }
  }

  private searchResult(
    request: Record<string, unknown>,
    collection: StoredCollection,
  ): Record<string, unknown> {
    const page = Number(request.page ?? 1)
    const perPage = Number(request.per_page ?? 10)
    const filterBy =
      typeof request.filter_by === "string" ? request.filter_by : null
    const vector = this.vectorQuery(request)
    let documents = this.filterDocuments(
      [...collection.documents.values()],
      filterBy,
    )
    let found = documents.length

    if (vector) {
      documents = documents
        .map((document) => {
          const embedding = Array.isArray(document.embedding)
            ? (document.embedding as number[])
            : []
          const similarity = this.cosineSimilarity(vector.embedding, embedding)
          return { document, similarity }
        })
        .filter(({ similarity }) => {
          if (vector.distanceThreshold == null) return true
          return 1 - similarity <= vector.distanceThreshold
        })
        .sort((left, right) => right.similarity - left.similarity)
        .slice(0, vector.k)
        .map(({ document }) => document)
      found = documents.length
    }

    const start = Math.max(0, (page - 1) * perPage)
    const pageDocuments = documents.slice(start, start + perPage)
    if (request.group_by === "canonicalVideoId") {
      const groups = new Map<string, Record<string, unknown>[]>()
      for (const document of pageDocuments) {
        const key = String(document.canonicalVideoId)
        const entries = groups.get(key) ?? []
        entries.push(document)
        groups.set(key, entries)
      }
      return {
        found,
        out_of: found,
        page,
        search_time_ms: 1,
        grouped_hits: [...groups.entries()].map(([key, docs]) => ({
          group_key: [key],
          found: docs.length,
          hits: docs.map((document) => ({
            document,
            vector_distance:
              vector && Array.isArray(document.embedding)
                ? 1 -
                  this.cosineSimilarity(
                    vector.embedding,
                    document.embedding as number[],
                  )
                : undefined,
          })),
        })),
      }
    }
    return {
      found,
      out_of: found,
      page,
      search_time_ms: 1,
      hits: pageDocuments.map((document) => ({ document })),
    }
  }

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const pathname = url.pathname

    if (request.method === "POST" && pathname === "/collections") {
      const schema = JSON.parse(
        await this.readBody(request),
      ) as StoredCollection["schema"]
      this.collections.set(schema.name, { schema, documents: new Map() })
      this.json(response, schema)
      return
    }
    if (request.method === "GET" && pathname === "/collections") {
      this.json(
        response,
        [...this.collections.values()].map(({ schema, documents }) => ({
          ...schema,
          num_documents: documents.size,
        })),
      )
      return
    }
    if (request.method === "GET" && pathname.startsWith("/collections/")) {
      const parts = pathname.split("/").filter(Boolean)
      const collectionName = decodeURIComponent(parts[1] ?? "")
      const collection = this.resolveCollection(collectionName)
      if (!collection) {
        this.text(response, "missing collection", 404)
        return
      }
      if (parts.length === 2) {
        this.json(response, {
          ...collection.schema,
          num_documents: collection.documents.size,
        })
        return
      }
      if (
        parts[2] === "documents" &&
        parts.length === 4 &&
        request.method === "GET"
      ) {
        const document = collection.documents.get(
          decodeURIComponent(parts[3] ?? ""),
        )
        if (!document) {
          response.statusCode = 404
          response.end()
          return
        }
        this.json(response, document)
        return
      }
    }
    if (request.method === "DELETE" && pathname.startsWith("/collections/")) {
      const parts = pathname.split("/").filter(Boolean)
      const collectionName = decodeURIComponent(parts[1] ?? "")
      if (parts.length === 2) {
        this.collections.delete(collectionName)
        response.statusCode = 204
        response.end()
        return
      }
      if (parts[2] === "documents") {
        const collection = this.resolveCollection(collectionName)
        if (!collection) {
          this.json(response, { num_deleted: 0 })
          return
        }
        const ids =
          this.exactList(url.searchParams.get("filter_by"), "id") ?? []
        let deleted = 0
        for (const id of ids) {
          if (collection.documents.delete(id)) deleted += 1
        }
        this.json(response, { num_deleted: deleted })
        return
      }
    }
    if (
      request.method === "POST" &&
      pathname.startsWith("/collections/") &&
      pathname.endsWith("/documents/import")
    ) {
      const parts = pathname.split("/").filter(Boolean)
      const collection = this.resolveCollection(
        decodeURIComponent(parts[1] ?? ""),
      )
      if (!collection) {
        this.text(
          response,
          JSON.stringify({ success: false, error: "missing collection" }),
          404,
        )
        return
      }
      const body = await this.readBody(request)
      const lines = body.split("\n").filter(Boolean)
      for (const line of lines) {
        const document = JSON.parse(line) as Record<string, unknown>
        // Typesense `float` and `float[]` fields store IEEE-754 single
        // precision values. Model that boundary so publication fingerprint
        // tests cannot accidentally depend on JavaScript's wider numbers.
        const storedDocument: Record<string, unknown> = {
          ...document,
          ...(typeof document.startSeconds === "number"
            ? { startSeconds: Math.fround(document.startSeconds) }
            : {}),
          ...(Array.isArray(document.embedding)
            ? {
                embedding: document.embedding.map((value) =>
                  Math.fround(Number(value)),
                ),
              }
            : {}),
        }
        collection.documents.set(String(storedDocument.id), storedDocument)
      }
      this.text(
        response,
        lines.map(() => JSON.stringify({ success: true })).join("\n"),
      )
      return
    }
    if (request.method === "PUT" && pathname.startsWith("/aliases/")) {
      const alias = decodeURIComponent(pathname.split("/").at(-1) ?? "")
      const body = JSON.parse(await this.readBody(request)) as {
        collection_name: string
      }
      this.aliases.set(alias, body.collection_name)
      this.json(response, {
        name: alias,
        collection_name: body.collection_name,
      })
      return
    }
    if (request.method === "GET" && pathname.startsWith("/aliases/")) {
      const alias = decodeURIComponent(pathname.split("/").at(-1) ?? "")
      const collectionName = this.aliases.get(alias)
      if (!collectionName) {
        response.statusCode = 404
        response.end()
        return
      }
      this.json(response, { name: alias, collection_name: collectionName })
      return
    }
    if (request.method === "DELETE" && pathname.startsWith("/aliases/")) {
      this.aliases.delete(decodeURIComponent(pathname.split("/").at(-1) ?? ""))
      response.statusCode = 204
      response.end()
      return
    }
    if (request.method === "POST" && pathname === "/multi_search") {
      const body = JSON.parse(await this.readBody(request)) as {
        searches: Array<Record<string, unknown>>
      }
      this.json(response, {
        results: body.searches.map((search) => {
          const collectionName = String(search.collection)
          const collection = this.resolveCollection(collectionName)
          return collection
            ? this.searchResult(search, collection)
            : { error: `missing collection ${collectionName}`, code: 404 }
        }),
      })
      return
    }

    response.statusCode = 404
    response.end()
  }
}

const suite =
  !RUN_REAL_DB_TEST || !hasRealDatabaseUrl ? describe.skip : describe

suite("current transcript publication into Watch Search", () => {
  const databaseName = `watch_search_transcript_publication_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`
  const databaseUrl = databaseUrlForDatabase(baseDatabaseUrl!, databaseName)
  const typesenseServer = new ControlledTypesenseServer()
  const embedding = makeEmbedding(0.123456789)
  let prisma: PrismaClient
  let pgClient: Client
  let typesense: TypesenseClient
  let searchService: TypesenseWatchSearchService
  let generations: TypesenseWatchSearchCandidateGenerationService
  let databaseCreated = false
  let databaseReady = false

  beforeAll(async () => {
    if (!hasRealDatabaseUrl) return
    pgClient = new Client({ connectionString: baseDatabaseUrl! })
    await pgClient.connect()
    await pgClient.query(`CREATE DATABASE "${databaseName}"`)
    databaseCreated = true
    execFileSync("pnpm", ["db:migrate:deploy"], {
      cwd: adminPackageRoot(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    })
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    })
    await typesenseServer.start()
    typesense = new TypesenseClient({
      host: typesenseServer.url,
      apiKey: "test-key",
      timeoutMs: 30_000,
    })
    generations = new TypesenseWatchSearchCandidateGenerationService(
      prisma,
      typesense,
    )
    searchService = new TypesenseWatchSearchService(prisma, typesense, {
      embedder: async () => embedding,
    })
    databaseReady = true
  }, 180_000)

  beforeEach(async () => {
    if (!databaseReady) return
    typesenseServer.reset()
    await prisma.$executeRawUnsafe(`
      TRUNCATE TABLE
        watch_search_current_transcript_publication_event,
        watch_search_current_transcript_projection,
        watch_search_candidate_pointer,
        watch_search_candidate_lease,
        watch_search_candidate_generation,
        video_transcript_chunk,
        video_transcript,
        video_dub,
        video_locale,
        video,
        video_edition,
        content_embedding_contract_pointer,
        content_embedding_contract,
        language
      RESTART IDENTITY CASCADE
    `)

    const language = await prisma.language.create({
      data: {
        id: "language-english",
        coreId: "core-language-english",
        name: { en: "English" },
        slug: "english",
        bcp47: "en",
      },
    })
    const videoEdition = await prisma.videoEdition.create({
      data: {
        id: "edition-1",
        coreId: "core-edition-1",
        name: "Standard",
      },
    })
    const video = await prisma.video.create({
      data: {
        id: "video-1",
        coreId: "core-video-1",
        slug: "watch-search-transcript-fixture",
        primaryLanguageId: language.id,
      },
    })
    await prisma.videoLocale.create({
      data: {
        id: "video-locale-en",
        videoId: video.id,
        locale: "en",
        languageId: language.id,
        languageSlug: "english",
        title: "Watch Search Transcript Fixture",
        description: "Fixture description.",
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-03T00:00:00.000Z"),
      },
    })
    await prisma.videoDub.create({
      data: {
        id: "dub-1",
        coreId: "core-dub-1",
        videoId: video.id,
        videoEditionId: videoEdition.id,
        languageId: language.id,
        published: true,
        hls: "https://example.com/fixture.m3u8",
      },
    })
    await prisma.contentEmbeddingContract.create({
      data: {
        id: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.id,
        queryProvider: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.provider,
        queryModel: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.model,
        queryNativeDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.nativeDimensions,
        queryDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.dimensions,
        queryTransformVersion:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.transformVersion,
        storageProvider:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.provider,
        storageModel: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.model,
        storageNativeDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.nativeDimensions,
        storageDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.dimensions,
        storageTransformVersion:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.transformVersion,
      },
    })
    await prisma.contentEmbeddingContractPointer.create({
      data: {
        id: CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
        activeContractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.id,
      },
    })

    const catalogSchema = watchCatalogCollectionSchema("fixture")
    const availabilitySchema = watchAvailabilityCollectionSchema("fixture")
    const lexicalSchema = watchLexicalCollectionSchema("fixture")
    const transcriptSchema = watchTranscriptCollectionSchema("fixture")
    await typesense.createCollection(catalogSchema)
    await typesense.createCollection(availabilitySchema)
    await typesense.createCollection(lexicalSchema)
    await typesense.createCollection(transcriptSchema)
    await typesense.upsertAlias(
      TYPESENSE_WATCH_CATALOG_ALIAS,
      catalogSchema.name,
    )
    await typesense.upsertAlias(
      TYPESENSE_WATCH_AVAILABILITY_ALIAS,
      availabilitySchema.name,
    )
    await typesense.upsertAlias(
      TYPESENSE_WATCH_LEXICAL_ALIAS,
      lexicalSchema.name,
    )
    await typesense.upsertAlias(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      transcriptSchema.name,
    )

    const catalogDocument: TypesenseWatchCatalogDocument = {
      id: video.id,
      coreId: video.coreId,
      slug: video.slug,
      titles: ["Watch Search Transcript Fixture"],
      localeCodes: ["en"],
      descriptions: ["Fixture description."],
      localesJson: JSON.stringify([
        {
          locale: "en",
          languageSlug: "english",
          title: "Watch Search Transcript Fixture",
          description: "Fixture description.",
        },
      ]),
      label: "episode",
      childCount: 0,
      imageUrl: "https://example.com/fixture.jpg",
      imageBlurDataUrl: null,
      audioLanguageSlugs: ["english"],
      subtitleLanguageSlugs: [],
      audioOptionsJson: JSON.stringify([
        {
          id: "dub-1",
          videoEditionId: "edition-1",
          languageId: "language-english",
          languageSlug: "english",
          languageEnglishName: "English",
          playbackId: "playback-1",
          durationSeconds: 120,
        },
      ]),
      subtitleOptionsJson: "[]",
      containerLanguagesJson: "[]",
    }
    const availabilityDocument: TypesenseWatchAvailabilityDocument = {
      id: `${video.id}:edition-1:language-english`,
      videoId: video.id,
      videoEditionId: "edition-1",
      languageId: "language-english",
      languageSlug: "english",
      languageEnglishName: "English",
      audio: true,
      subtitles: false,
      playbackId: "playback-1",
      durationSeconds: 120,
      hrefLanguageSlug: "english",
      actionVideoDubId: "dub-1",
      actionPriority: 0,
    }
    await typesense.importDocuments(
      catalogSchema.name,
      [catalogDocument],
      "upsert",
    )
    await typesense.importDocuments(
      availabilitySchema.name,
      [availabilityDocument],
      "upsert",
    )
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    if (typesenseServer.url) {
      await typesenseServer.stop()
    }
    if (databaseCreated && pgClient) {
      await pgClient.query(
        `DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`,
      )
    }
    if (pgClient) {
      await pgClient.end()
    }
  })

  function payload(
    overrides: {
      mode?: "idempotent" | "force"
      chunkingVersion?: string
      chunks?: Array<{ text: string; embedding: number[]; tokenCount: number }>
      mastraRunId?: string
      generatedAt?: string
    } = {},
  ) {
    const chunks = overrides.chunks ?? [
      { text: "Hope and fellowship", embedding, tokenCount: 3 },
      {
        text: "Stale tail chunk",
        embedding: makeEmbedding(0.5),
        tokenCount: 3,
      },
    ]
    const value = {
      target: {
        admin: {
          videoId: "video-1",
          videoEditionId: "edition-1",
          coreId: "core-video-1",
        },
      },
      language: "en",
      source: {
        text: chunks.map((chunk) => chunk.text).join("\n"),
        contentHash: "pending",
      },
      model: {
        name: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.model,
        dimensions: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.dimensions,
        nativeDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.nativeDimensions,
        provider: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.provider,
      },
      chunking: {
        type: "segment-aware" as const,
        maxChunkTokens: 128,
        overlapTokens: 0,
        ...(overrides.chunkingVersion === undefined
          ? { version: "mastra-v1" }
          : overrides.chunkingVersion
            ? { version: overrides.chunkingVersion }
            : {}),
      },
      generation: {
        mode: overrides.mode ?? "idempotent",
        generatedAt: overrides.generatedAt ?? "2026-09-03T00:00:00.000Z",
        mastraRunId: overrides.mastraRunId ?? "mastra-run-1",
      },
      chunks: chunks.map((chunk, index) => ({
        chunkIndex: index,
        chunkId: `chunk-${index}`,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        startSeconds: index * 10 + 0.123456789,
        endSeconds: index * 10 + 5.123456789,
        feltNeeds: [],
        bibleVerses: [],
        demographics: [],
        spiritualContext: [],
        embedding: chunk.embedding,
      })),
    }
    value.source.contentHash = payloadSourceHash(value)
    return value
  }

  it("keeps publication constraint and index names stable below PostgreSQL's identifier limit", async () => {
    const rows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname::text AS name
      FROM pg_constraint
      WHERE conrelid = 'watch_search_current_transcript_publication_event'::regclass
        AND conname LIKE 'watch_search_transcript_pub_%'
      UNION ALL
      SELECT indexname::text AS name
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'watch_search_current_transcript_publication_event'
        AND indexname LIKE 'watch_search_transcript_pub_%'
      ORDER BY name
    `

    expect(rows.map((row) => row.name)).toEqual([
      "watch_search_transcript_pub_status_retry_created_idx",
      "watch_search_transcript_pub_transcript_generation_key",
      "watch_search_transcript_pub_transcript_id_fkey",
      "watch_search_transcript_pub_transcript_status_created_idx",
    ])
    expect(rows.every((row) => Buffer.byteLength(row.name, "utf8") <= 63)).toBe(
      true,
    )
  })

  it("rolls back failed publication-event writes, increments source generation on replacement, and keeps unchanged ingest event-free", async () => {
    await expect(
      ingestTranscriptEmbeddings(
        prisma,
        payload({ chunkingVersion: "", mastraRunId: "invalid-run" }),
      ),
    ).rejects.toMatchObject({ code: "write_failed" })
    expect(await prisma.videoTranscript.count()).toBe(0)
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.count(),
    ).toBe(0)

    const created = await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    expect(created.status).toBe("created")
    const firstTranscript = await prisma.videoTranscript.findFirstOrThrow({
      select: { id: true, sourceGeneration: true },
    })
    expect(firstTranscript.sourceGeneration).toBe(1n)
    const firstEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          orderBy: { sourceGeneration: "asc" },
        },
      )
    expect(firstEvent.sourceGeneration).toBe(1n)
    expect(firstEvent.currentDocumentIds).toHaveLength(2)
    expect(firstEvent.staleDocumentIds).toEqual([])

    const replaced = await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "replace-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope and fellowship", embedding, tokenCount: 3 }],
      }),
    )
    expect(replaced.status).toBe("forced")
    const transcriptAfterReplace =
      await prisma.videoTranscript.findUniqueOrThrow({
        where: { id: firstTranscript.id },
        select: { sourceGeneration: true },
      })
    expect(transcriptAfterReplace.sourceGeneration).toBe(2n)
    const events =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findMany({
        orderBy: { sourceGeneration: "asc" },
      })
    expect(events).toHaveLength(2)
    expect(events[1]?.sourceGeneration).toBe(2n)
    expect(events[1]?.currentDocumentIds).toHaveLength(1)
    expect(events[1]?.staleDocumentIds).toEqual([
      events[0]!.currentDocumentIds[1]!,
    ])

    const unchanged = await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "idempotent",
        mastraRunId: "unchanged-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope and fellowship", embedding, tokenCount: 3 }],
      }),
    )
    expect(unchanged.status).toBe("unchanged")
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.count(),
    ).toBe(2)
  })

  it("treats a chunking-version change as transcript drift instead of unchanged ingest", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const result = await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "idempotent",
        mastraRunId: "changed-chunking-version-run",
        chunkingVersion: "mastra-v2",
      }),
    )

    expect(result).toMatchObject({
      status: "rejected",
      reason: "existing_transcript_differs",
    })
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.count(),
    ).toBe(1)
    expect(
      await prisma.videoTranscript.findFirstOrThrow({
        select: { sourceGeneration: true, chunkingVersion: true },
      }),
    ).toMatchObject({
      sourceGeneration: 1n,
      chunkingVersion: "mastra-v1",
    })
  })

  it("normalizes chunking-version identity so accepted work remains publishable", async () => {
    await expect(
      ingestTranscriptEmbeddings(
        prisma,
        payload({
          mode: "idempotent",
          mastraRunId: "normalized-chunking-version-run",
          chunkingVersion: "  mastra-v1  ",
        }),
      ),
    ).resolves.toMatchObject({ status: "created" })

    await expect(
      prisma.videoTranscript.findFirstOrThrow({
        select: { chunkingVersion: true },
      }),
    ).resolves.toEqual({ chunkingVersion: "mastra-v1" })
    await expect(
      prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow({
        select: { transcriptChunkingVersion: true },
      }),
    ).resolves.toEqual({ transcriptChunkingVersion: "mastra-v1" })

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).resolves.toMatchObject({
      status: "published",
      sourceGeneration: 1n,
      projectionRevision: 1n,
    })
  }, 180_000)

  it("publishes the latest canonical transcript into current Watch Search and makes it retrievable afterward", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "replace-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope and fellowship", embedding, tokenCount: 3 }],
      }),
    )

    const before = await searchService.search({
      query: "hope fellowship",
      targetLanguageSlug: "english",
      queryLanguageSlug: "english",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      limit: 5,
    })
    expect(before.results).toEqual([])

    const published = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })
    expect(published.status).toBe("published")
    if (published.status !== "published") {
      throw new Error("expected a published transcript batch")
    }
    expect(published).toMatchObject({
      status: "published",
      transcriptId: expect.any(String),
      sourceGeneration: 2n,
      projectionRevision: 1n,
      documentCount: 1,
    })
    const projection =
      await prisma.watchSearchCurrentTranscriptProjection.findUniqueOrThrow({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      })
    expect(projection.projectionRevision).toBe(1n)
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.count({
        where: { status: "COMPLETED" },
      }),
    ).toBe(2)

    const currentEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 2n },
        },
      )
    const currentDoc = await typesense.getDocument<{
      id: string
      embedding: number[]
    }>(published.transcriptCollection, currentEvent.currentDocumentIds[0]!)
    expect(currentDoc?.id).toBe(currentEvent.currentDocumentIds[0])
    expect(currentDoc?.embedding).toEqual(embedding.map(Math.fround))
    const staleDoc = await typesense.getDocument(
      published.transcriptCollection,
      currentEvent.staleDocumentIds[0]!,
    )
    expect(staleDoc).toBeUndefined()

    const after = await searchService.search({
      query: "hope fellowship",
      targetLanguageSlug: "english",
      queryLanguageSlug: "english",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      limit: 5,
    })
    expect(after.results).toHaveLength(1)
    expect(after.results[0]).toMatchObject({
      id: "video-1",
      slug: "watch-search-transcript-fixture",
      playbackId: "playback-1",
      evidence: { kind: "transcript_semantic" },
    })
  }, 180_000)

  it("completes while holding the publication lock even when the claim lease deadline has elapsed", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const published = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      // Deliberately make the persisted lease deadline older than wall-clock
      // time. The session advisory lock still prevents another publisher from
      // stealing this claim while the callback is active.
      now: new Date("2000-01-01T00:00:00.000Z"),
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })

    expect(published).toMatchObject({
      status: "published",
      sourceGeneration: 1n,
      projectionRevision: 1n,
    })
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          select: {
            status: true,
            leaseTokenHash: true,
            leaseExpiresAt: true,
            completedAt: true,
          },
        },
      ),
    ).toMatchObject({
      status: "COMPLETED",
      leaseTokenHash: null,
      leaseExpiresAt: null,
      completedAt: expect.any(Date),
    })
  }, 180_000)

  it("allows a candidate lease after a routine transcript projection revision change", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    const firstPublication = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })
    expect(firstPublication).toMatchObject({
      status: "published",
      projectionRevision: 1n,
    })

    const catalogSchema = watchCatalogCollectionSchema("fixture")
    const availabilitySchema = watchAvailabilityCollectionSchema("fixture")
    const lexicalSchema = watchLexicalCollectionSchema("fixture")
    const transcriptSchema = watchTranscriptCollectionSchema("fixture")
    await prisma.watchSearchCandidateGeneration.create({
      data: {
        id: "candidate-before-publication-race",
        state: "READY",
        version: 1,
        indexContractRevision: "watch-search-index-v1",
        contentEmbeddingContractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.id,
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 1n,
        sourceEpoch: "fixture-source",
        sourceDigests: { catalog: "sha256:fixture" },
        catalogCollection: catalogSchema.name,
        availabilityCollection: availabilitySchema.name,
        lexicalCollection: lexicalSchema.name,
        transcriptCollection: transcriptSchema.name,
        catalogFields: catalogSchema.fields,
        availabilityFields: availabilitySchema.fields,
        lexicalFields: lexicalSchema.fields,
        transcriptFields: transcriptSchema.fields,
        ownedCollections: [
          catalogSchema.name,
          availabilitySchema.name,
          lexicalSchema.name,
        ],
        sharedCollections: [transcriptSchema.name],
        validatedAt: new Date(),
      },
    })
    await prisma.watchSearchCandidatePointer.create({
      data: {
        kind: "SERVING",
        generationId: "candidate-before-publication-race",
      },
    })

    await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "replacement-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope after publication", embedding, tokenCount: 3 }],
      }),
    )
    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).resolves.toMatchObject({
      status: "published",
      projectionRevision: 2n,
    })

    await expect(
      generations.acquireLease({
        resourceKey: "candidate-publication-race",
        kind: "EVALUATION",
        holderToken: "stale-profile-holder",
        ttlMs: 30_000,
        generationId: "candidate-before-publication-race",
        indexContractRevision: "watch-search-index-v1",
        transcriptCollection: transcriptSchema.name,
        contentEmbeddingContractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.id,
        transcriptChunkingVersion: "mastra-v1",
        transcriptProjectionRevision: 1n,
        currentBindings: [
          catalogSchema.name,
          availabilitySchema.name,
          lexicalSchema.name,
          transcriptSchema.name,
        ],
      }),
    ).resolves.toMatchObject({
      holderToken: "stale-profile-holder",
      transcriptProjectionRevision: 1n,
    })
    expect(await prisma.watchSearchCandidateLease.count()).toBe(1)
  }, 180_000)

  it("advances the stored transcript projection when a rebuild rotates the active transcript collection", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const firstPublish = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })
    expect(firstPublish).toMatchObject({
      status: "published",
      projectionRevision: 1n,
      transcriptCollection: expect.stringMatching(
        /^watch_search_transcripts_fixture$/,
      ),
    })
    if (firstPublish.status !== "published") {
      throw new Error("expected a published transcript batch")
    }

    const rebuild = await withTypesenseWatchSearchIndexLock(
      () =>
        rebuildTypesenseWatchSearchIndex({
          prisma,
          typesense,
          buildId: "rebuild-2",
          transcriptStrategy: "rebuild",
        }),
      { databaseUrl },
    )
    expect(rebuild.transcriptCollection).toBe(
      "watch_search_transcripts_rebuild-2",
    )

    const projection =
      await prisma.watchSearchCurrentTranscriptProjection.findUniqueOrThrow({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      })
    expect(projection).toMatchObject({
      transcriptCollection: "watch_search_transcripts_rebuild-2",
      contentEmbeddingContractId: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.id,
      transcriptChunkingVersion: "mastra-v1",
      projectionRevision: 2n,
    })
    expect(
      await typesense.getAlias(TYPESENSE_WATCH_TRANSCRIPT_ALIAS),
    ).toMatchObject({
      collection_name: "watch_search_transcripts_rebuild-2",
    })
  }, 180_000)

  it("refuses to bless an out-of-band transcript alias rotation from one incremental event", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    const firstPublish = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })
    expect(firstPublish).toMatchObject({
      status: "published",
      projectionRevision: 1n,
    })

    await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "replace-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope and fellowship", embedding, tokenCount: 3 }],
      }),
    )
    const pendingEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 2n },
        },
      )
    const driftedSchema = watchTranscriptCollectionSchema("drifted")
    await typesense.createCollection(driftedSchema)
    await typesense.upsertAlias(
      TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      driftedSchema.name,
    )

    const firstFailureStartedAt = Date.now()
    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(/full transcript rebuild/i)

    expect(
      await prisma.watchSearchCurrentTranscriptProjection.findUniqueOrThrow({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
        select: {
          transcriptCollection: true,
          projectionRevision: true,
        },
      }),
    ).toEqual({
      transcriptCollection: "watch_search_transcripts_fixture",
      projectionRevision: 1n,
    })
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findUniqueOrThrow(
        {
          where: { id: pendingEvent.id },
          select: {
            status: true,
            lastErrorCode: true,
            attemptCount: true,
            nextAttemptAt: true,
          },
        },
      ),
    ).toMatchObject({
      status: "PENDING",
      lastErrorCode: "WatchSearchTranscriptPublicationError",
      attemptCount: 1,
    })
    const firstFailureEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findUniqueOrThrow(
        { where: { id: pendingEvent.id } },
      )
    expect(firstFailureEvent.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(
      firstFailureStartedAt + 5_000,
    )

    await prisma.watchSearchCurrentTranscriptPublicationEvent.update({
      where: { id: pendingEvent.id },
      data: { nextAttemptAt: new Date(0) },
    })
    const secondFailureStartedAt = Date.now()
    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(/full transcript rebuild/i)
    const secondFailureEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findUniqueOrThrow(
        { where: { id: pendingEvent.id } },
      )
    expect(secondFailureEvent.attemptCount).toBe(2)
    expect(secondFailureEvent.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(
      secondFailureStartedAt + 10_000,
    )
    await expect(
      typesense.getDocument(
        driftedSchema.name,
        pendingEvent.currentDocumentIds[0]!,
      ),
    ).resolves.toBeUndefined()
  }, 180_000)

  it("refuses completion when the active transcript alias rotates during publication", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    const pendingEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
        },
      )
    const driftedSchema = watchTranscriptCollectionSchema("racing-drift")
    await typesense.createCollection(driftedSchema)

    let aliasRotated = false
    const racingTypesense = {
      getAlias: (...args: Parameters<TypesenseClient["getAlias"]>) =>
        typesense.getAlias(...args),
      importDocuments: (
        ...args: Parameters<TypesenseClient["importDocuments"]>
      ) => typesense.importDocuments(...args),
      deleteDocumentsByFilter: (
        ...args: Parameters<TypesenseClient["deleteDocumentsByFilter"]>
      ) => typesense.deleteDocumentsByFilter(...args),
      getDocument: async (
        ...args: Parameters<TypesenseClient["getDocument"]>
      ) => {
        if (!aliasRotated) {
          aliasRotated = true
          await typesense.upsertAlias(
            TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
            driftedSchema.name,
          )
        }
        return typesense.getDocument(...args)
      },
    } satisfies Pick<
      TypesenseClient,
      "deleteDocumentsByFilter" | "getAlias" | "getDocument" | "importDocuments"
    >

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense: racingTypesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(/alias changed during publication/i)

    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findUniqueOrThrow(
        {
          where: { id: pendingEvent.id },
          select: { status: true, completedAt: true, lastErrorCode: true },
        },
      ),
    ).toEqual({
      status: "PENDING",
      completedAt: null,
      lastErrorCode: "WatchSearchTranscriptPublicationError",
    })
    expect(
      await prisma.watchSearchCurrentTranscriptProjection.findUnique({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      }),
    ).toBeNull()
    await expect(
      typesense.getDocument(
        driftedSchema.name,
        pendingEvent.currentDocumentIds[0]!,
      ),
    ).resolves.toBeUndefined()
  }, 180_000)

  it("refuses to complete a batch when the canonical chunk set no longer matches the event evidence", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const pendingEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
          select: { currentDocumentIds: true },
        },
      )
    await prisma.videoTranscriptChunk.delete({
      where: { id: pendingEvent.currentDocumentIds[1]! },
    })

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(/chunk count .* batch evidence/i)

    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
          select: {
            status: true,
            lastErrorCode: true,
          },
        },
      ),
    ).toMatchObject({
      status: "PENDING",
      lastErrorCode: "WatchSearchTranscriptPublicationError",
    })
    await expect(
      prisma.watchSearchCurrentTranscriptProjection.findUniqueOrThrow({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      }),
    ).rejects.toThrow()
  }, 180_000)

  it("refuses to publish when durable event identity does not match the canonical transcript", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const pendingEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
          select: { id: true, currentDocumentIds: true },
        },
      )
    await prisma.watchSearchCurrentTranscriptPublicationEvent.update({
      where: { id: pendingEvent.id },
      data: { videoId: "drifted-video-id" },
    })

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(/identity does not match publication evidence/i)

    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findUniqueOrThrow(
        {
          where: { id: pendingEvent.id },
          select: { status: true, lastErrorCode: true, completedAt: true },
        },
      ),
    ).toEqual({
      status: "PENDING",
      lastErrorCode: "WatchSearchTranscriptPublicationError",
      completedAt: null,
    })
    await expect(
      typesense.getDocument(
        watchTranscriptCollectionSchema("fixture").name,
        pendingEvent.currentDocumentIds[0]!,
      ),
    ).resolves.toBeUndefined()
    await expect(
      prisma.watchSearchCurrentTranscriptProjection.findUniqueOrThrow({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      }),
    ).rejects.toThrow()
  }, 180_000)

  it("refuses to publish canonical chunks whose denormalized identity drifted", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const pendingEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
          select: { id: true, currentDocumentIds: true },
        },
      )
    await prisma.videoTranscriptChunk.update({
      where: { id: pendingEvent.currentDocumentIds[0]! },
      data: { language: "fr" },
    })

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(/chunk identity does not match publication evidence/i)

    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findUniqueOrThrow(
        {
          where: { id: pendingEvent.id },
          select: { status: true, lastErrorCode: true, completedAt: true },
        },
      ),
    ).toEqual({
      status: "PENDING",
      lastErrorCode: "WatchSearchTranscriptPublicationError",
      completedAt: null,
    })
    await expect(
      typesense.getDocument(
        watchTranscriptCollectionSchema("fixture").name,
        pendingEvent.currentDocumentIds[0]!,
      ),
    ).resolves.toBeUndefined()
  }, 180_000)

  it("publishes against the event contract even after the active contract pointer rotates", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    await prisma.contentEmbeddingContract.create({
      data: {
        id: ALTERNATE_CONTENT_EMBEDDING_CONTRACT_ID,
        queryProvider: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.provider,
        queryModel: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.model,
        queryNativeDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.nativeDimensions,
        queryDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.dimensions,
        queryTransformVersion:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.query.transformVersion,
        storageProvider: "alternate-provider",
        storageModel: ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.model,
        storageNativeDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.nativeDimensions,
        storageDimensions:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.dimensions,
        storageTransformVersion:
          ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED.storage.transformVersion,
      },
    })
    await prisma.contentEmbeddingContractPointer.update({
      where: { id: CONTENT_EMBEDDING_CONTRACT_POINTER_ID },
      data: { activeContractId: ALTERNATE_CONTENT_EMBEDDING_CONTRACT_ID },
    })

    const published = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })

    expect(published.status).toBe("published")
    if (published.status !== "published") {
      throw new Error("expected a published transcript batch")
    }
    expect(published).toMatchObject({
      status: "published",
      sourceGeneration: 1n,
      projectionRevision: 1n,
      documentCount: 2,
    })
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.count({
        where: { status: "COMPLETED" },
      }),
    ).toBe(1)
  }, 180_000)

  it("completes older backed-off events when a newer source generation publishes", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    const failingTypesense = {
      getAlias: (...args: Parameters<TypesenseClient["getAlias"]>) =>
        typesense.getAlias(...args),
      importDocuments: async () => {
        throw new Error("simulated publication failure")
      },
      deleteDocumentsByFilter: (
        ...args: Parameters<TypesenseClient["deleteDocumentsByFilter"]>
      ) => typesense.deleteDocumentsByFilter(...args),
      getDocument: (...args: Parameters<TypesenseClient["getDocument"]>) =>
        typesense.getDocument(...args),
    } satisfies Pick<
      TypesenseClient,
      "deleteDocumentsByFilter" | "getAlias" | "getDocument" | "importDocuments"
    >

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense: failingTypesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow("simulated publication failure")

    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
          select: { status: true, nextAttemptAt: true },
        },
      ),
    ).toMatchObject({
      status: "PENDING",
      nextAttemptAt: expect.any(Date),
    })

    await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "replace-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope and fellowship", embedding, tokenCount: 3 }],
      }),
    )

    const published = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      now: new Date("2100-01-01T00:00:00.000Z"),
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })

    expect(published).toMatchObject({
      status: "published",
      sourceGeneration: 2n,
      documentCount: 1,
    })
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findMany({
        orderBy: { sourceGeneration: "asc" },
        select: { sourceGeneration: true, status: true, nextAttemptAt: true },
      }),
    ).toEqual([
      { sourceGeneration: 1n, status: "COMPLETED", nextAttemptAt: null },
      { sourceGeneration: 2n, status: "COMPLETED", nextAttemptAt: null },
    ])

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense,
        generations,
        now: new Date("2100-01-01T00:01:00.000Z"),
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).resolves.toEqual({ status: "idle" })
  }, 180_000)

  it("completes an older actively claimed event when a newer generation wins publication", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )
    const firstPublish = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })
    expect(firstPublish).toMatchObject({
      status: "published",
      sourceGeneration: 1n,
      projectionRevision: 1n,
    })
    const firstEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        { where: { sourceGeneration: 1n } },
      )

    await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "shrink-run",
        generatedAt: "2026-09-03T00:10:00.000Z",
        chunks: [{ text: "Hope and fellowship", embedding, tokenCount: 3 }],
      }),
    )
    const olderEvent =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        { where: { sourceGeneration: 2n } },
      )
    expect(olderEvent.staleDocumentIds).toEqual([
      firstEvent.currentDocumentIds[1],
    ])
    await prisma.watchSearchCurrentTranscriptPublicationEvent.update({
      where: { id: olderEvent.id },
      data: {
        status: "CLAIMED",
        leaseGeneration: 1,
        leaseTokenHash: "older-worker-token-hash",
        leaseExpiresAt: new Date("2100-01-01T00:00:00.000Z"),
        attemptCount: 1,
      },
    })

    await ingestTranscriptEmbeddings(
      prisma,
      payload({
        mode: "force",
        mastraRunId: "replace-run",
        generatedAt: "2026-09-03T00:20:00.000Z",
        chunks: [
          { text: "Hope and fellowship", embedding, tokenCount: 3 },
          {
            text: "Replacement tail chunk",
            embedding: makeEmbedding(0.75),
            tokenCount: 3,
          },
        ],
      }),
    )

    const published = await publishOneCurrentTranscriptToWatchSearch({
      prisma,
      typesense,
      generations,
      withIndexLock: (run) =>
        withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
    })

    expect(published).toMatchObject({
      status: "published",
      sourceGeneration: 3n,
      projectionRevision: 2n,
    })
    expect(
      await typesense.getDocument(
        published.status === "published" ? published.transcriptCollection : "",
        firstEvent.currentDocumentIds[1]!,
      ),
    ).toBeUndefined()
    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findMany({
        orderBy: { sourceGeneration: "asc" },
        select: {
          sourceGeneration: true,
          status: true,
          leaseTokenHash: true,
          leaseExpiresAt: true,
        },
      }),
    ).toEqual([
      {
        sourceGeneration: 1n,
        status: "COMPLETED",
        leaseTokenHash: null,
        leaseExpiresAt: null,
      },
      {
        sourceGeneration: 2n,
        status: "COMPLETED",
        leaseTokenHash: null,
        leaseExpiresAt: null,
      },
      {
        sourceGeneration: 3n,
        status: "COMPLETED",
        leaseTokenHash: null,
        leaseExpiresAt: null,
      },
    ])
  }, 180_000)

  it("does not complete publication when the canonical visibility projection drifts before completion", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    let driftInjected = false
    const racingTypesense = {
      getAlias: (...args: Parameters<TypesenseClient["getAlias"]>) =>
        typesense.getAlias(...args),
      importDocuments: (
        ...args: Parameters<TypesenseClient["importDocuments"]>
      ) => typesense.importDocuments(...args),
      deleteDocumentsByFilter: (
        ...args: Parameters<TypesenseClient["deleteDocumentsByFilter"]>
      ) => typesense.deleteDocumentsByFilter(...args),
      getDocument: async (
        ...args: Parameters<TypesenseClient["getDocument"]>
      ) => {
        if (!driftInjected) {
          driftInjected = true
          await prisma.videoLocale.updateMany({
            where: {
              videoId: "video-1",
              locale: "en",
              deletedAt: null,
            },
            data: { status: "DRAFT" },
          })
        }
        return typesense.getDocument(...args)
      },
    } satisfies Pick<
      TypesenseClient,
      "deleteDocumentsByFilter" | "getAlias" | "getDocument" | "importDocuments"
    >

    await expect(
      publishOneCurrentTranscriptToWatchSearch({
        prisma,
        typesense: racingTypesense,
        generations,
        withIndexLock: (run) =>
          withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
      }),
    ).rejects.toThrow(
      "canonical transcript projection changed before publication completion",
    )

    expect(
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        {
          where: { sourceGeneration: 1n },
          select: {
            status: true,
            lastErrorCode: true,
            completedAt: true,
            nextAttemptAt: true,
          },
        },
      ),
    ).toMatchObject({
      status: "PENDING",
      lastErrorCode: "WatchSearchTranscriptPublicationError",
      completedAt: null,
      nextAttemptAt: expect.any(Date),
    })
    expect(
      await prisma.watchSearchCurrentTranscriptProjection.findUnique({
        where: { id: WATCH_SEARCH_CURRENT_TRANSCRIPT_PROJECTION_ID },
      }),
    ).toBeNull()
    const afterFailure = await searchService.search({
      query: "hope fellowship",
      targetLanguageSlug: "english",
      queryLanguageSlug: "english",
      displayLanguageSlug: "english",
      routeLanguageSlug: "english",
      limit: 5,
    })
    expect(afterFailure.results).toEqual([])
    const event =
      await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
        { select: { currentDocumentIds: true } },
      )
    await expect(
      typesense.getDocument(
        TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
        event.currentDocumentIds[0]!,
      ),
    ).resolves.toBeUndefined()
  }, 180_000)

  it("does not claim an event when the caller's publication lock database is busy", async () => {
    await ingestTranscriptEmbeddings(
      prisma,
      payload({ mode: "idempotent", mastraRunId: "create-run" }),
    )

    const lockHolder = new Client({ connectionString: databaseUrl })
    await lockHolder.connect()
    try {
      await lockHolder.query("SELECT pg_advisory_lock($1)", [
        TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID,
      ])

      await expect(
        publishOneCurrentTranscriptToWatchSearch({
          prisma,
          typesense,
          generations,
          withIndexLock: (run) =>
            withTypesenseWatchSearchIndexLock(run, { databaseUrl }),
        }),
      ).rejects.toThrow(/index release is already running/i)

      expect(
        await prisma.watchSearchCurrentTranscriptPublicationEvent.findFirstOrThrow(
          {
            where: { sourceGeneration: 1n },
            select: {
              status: true,
              lastErrorCode: true,
              attemptCount: true,
              leaseTokenHash: true,
              leaseExpiresAt: true,
            },
          },
        ),
      ).toMatchObject({
        status: "PENDING",
        lastErrorCode: null,
        attemptCount: 0,
        leaseTokenHash: null,
        leaseExpiresAt: null,
      })
    } finally {
      await lockHolder.query("SELECT pg_advisory_unlock($1)", [
        TYPESENSE_WATCH_SEARCH_PUBLICATION_LOCK_ID,
      ])
      await lockHolder.end()
    }
  }, 180_000)
})
