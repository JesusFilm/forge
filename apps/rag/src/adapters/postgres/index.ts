/* eslint-disable max-lines -- colocates the five implementations sharing one Prisma transaction/query vocabulary */
import { Prisma, type PrismaClient } from "../../generated/prisma/index.js"

import type {
  CorpusSearchStore,
  CorpusWriteStore,
  DedupRecord,
  EmbeddedChunk,
  FetchStateStore,
  HttpCacheEntry,
  NormalizedDocument,
  PendingRawDocument,
  RawDocument,
  RawDocumentReader,
  RawDocumentStore,
  RobotsEntry,
  ScoredRow,
  SearchFilter,
  SourceRecord,
} from "../../contracts/index.js"

import { assertQueryDimensions, toVectorLiteral } from "./vector.js"

export { EMBEDDING_DIMENSIONS } from "./vector.js"

export type StoredLanguageCandidate = {
  id: string
  sourceKey: string
  canonicalUrl: string
  language: string | null
  rawContent: string
}

export type StoredLanguageChange = {
  id: string
  sourceKey: string
  oldLanguage: string | null
  newLanguage: string | null
}

export class PostgresLanguageMaintenanceStore {
  constructor(private readonly db: PrismaClient) {}

  async listCandidates(options: {
    sourceKey?: string
    blanksOnly: boolean
    limit?: number
  }): Promise<StoredLanguageCandidate[]> {
    return this.db.$queryRaw(Prisma.sql`
      SELECT DISTINCT ON (d.id)
        d.id, s.key AS "sourceKey", d.canonical_url AS "canonicalUrl",
        d.language, r.raw_content AS "rawContent"
      FROM documents d
      JOIN sources s ON s.id = d.source_id
      JOIN raw_documents r
        ON r.source_key = s.key AND r.canonical_url = d.canonical_url
      WHERE (${options.sourceKey ?? null}::text IS NULL OR s.key = ${options.sourceKey ?? null})
        AND (${options.blanksOnly} = FALSE OR d.language IS NULL)
      ORDER BY d.id, r.fetched_at DESC
      ${options.limit ? Prisma.sql`LIMIT ${options.limit}` : Prisma.empty}
    `)
  }

  async applyLanguageChanges(
    sourceKey: string,
    changes: ReadonlyArray<Omit<StoredLanguageChange, "sourceKey">>,
  ): Promise<StoredLanguageChange[]> {
    return this.db.$transaction(async (tx) => {
      const committed: StoredLanguageChange[] = []
      for (const change of changes) {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE documents d SET language = ${change.newLanguage}, updated_at = NOW()
          FROM sources s
          WHERE d.id = ${change.id}::uuid AND d.source_id = s.id
            AND s.key = ${sourceKey}
            AND d.language IS NOT DISTINCT FROM ${change.oldLanguage}
          RETURNING d.id
        `)
        if (rows.length) committed.push({ ...change, sourceKey })
      }
      return committed
    })
  }

  async revertLanguageChanges(
    changes: ReadonlyArray<{
      id: string
      sourceKey: string
      expectedLanguage: string | null
      restoreLanguage: string | null
    }>,
  ): Promise<number> {
    let reverted = 0
    const bySource = new Map<string, (typeof changes)[number][]>()
    for (const change of changes) {
      const sourceChanges = bySource.get(change.sourceKey) ?? []
      sourceChanges.push(change)
      bySource.set(change.sourceKey, sourceChanges)
    }
    for (const [sourceKey, sourceChanges] of bySource) {
      reverted += await this.db.$transaction(async (tx) => {
        let sourceReverted = 0
        for (const change of sourceChanges) {
          const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          UPDATE documents d SET language = ${change.restoreLanguage}, updated_at = NOW()
          FROM sources s
          WHERE d.id = ${change.id}::uuid AND d.source_id = s.id
            AND s.key = ${sourceKey}
            AND d.language IS NOT DISTINCT FROM ${change.expectedLanguage}
          RETURNING d.id
        `)
          sourceReverted += rows.length
        }
        return sourceReverted
      })
    }
    return reverted
  }
}

const iso = (value: Date): string => value.toISOString()

export class PostgresFetchStateStore implements FetchStateStore {
  constructor(private readonly db: PrismaClient) {}

  async getHttpCache(url: string): Promise<HttpCacheEntry | null> {
    const row = await this.db.httpCache.findUnique({ where: { url } })
    return row
      ? {
          url: row.url,
          etag: row.etag,
          lastModified: row.lastModified,
          bodyHash: row.bodyHash ?? "",
          status: row.statusCode,
          fetchedAt: iso(row.fetchedAt),
        }
      : null
  }

  async putHttpCache(entry: HttpCacheEntry): Promise<void> {
    const values = {
      etag: entry.etag,
      lastModified: entry.lastModified,
      bodyHash: entry.bodyHash,
      statusCode: entry.status,
      fetchedAt: new Date(entry.fetchedAt),
      updatedAt: new Date(),
    }
    await this.db.httpCache.upsert({
      where: { url: entry.url },
      create: { url: entry.url, ...values },
      update: values,
    })
  }

  async getRobots(robotsUrl: string): Promise<RobotsEntry | null> {
    const row = await this.db.robotsCache.findUnique({ where: { robotsUrl } })
    return row
      ? {
          robotsUrl: row.robotsUrl,
          body: row.body,
          status: row.statusCode,
          fetchedAt: iso(row.fetchedAt),
        }
      : null
  }

  async putRobots(entry: RobotsEntry): Promise<void> {
    const values = {
      body: entry.body,
      statusCode: entry.status,
      fetchedAt: new Date(entry.fetchedAt),
      updatedAt: new Date(),
    }
    await this.db.robotsCache.upsert({
      where: { robotsUrl: entry.robotsUrl },
      create: { robotsUrl: entry.robotsUrl, ...values },
      update: values,
    })
  }
}

export class PostgresRawDocumentStore implements RawDocumentStore {
  constructor(private readonly db: PrismaClient) {}

  async putRawDocument(doc: RawDocument): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.rawDocument.deleteMany({
        where: {
          sourceKey: doc.sourceKey,
          canonicalUrl: doc.canonicalUrl,
          ingestedAt: null,
        },
      })
      await tx.rawDocument.create({
        data: {
          sourceKey: doc.sourceKey,
          url: doc.url,
          canonicalUrl: doc.canonicalUrl,
          title: doc.title,
          rawContent: doc.rawContent,
          status: doc.fetch.status,
          bodyHash: doc.fetch.bodyHash,
          etag: doc.fetch.etag,
          lastModified: doc.fetch.lastModified,
          fetchedAt: new Date(doc.fetch.fetchedAt),
          notModified: doc.fetch.notModified,
        },
      })
    })
  }

  async listStagedCanonicalUrls(sourceKey: string): Promise<string[]> {
    const rows = await this.db.rawDocument.findMany({
      where: { sourceKey },
      distinct: ["canonicalUrl"],
      select: { canonicalUrl: true },
    })
    return rows.map(({ canonicalUrl }) => canonicalUrl)
  }
}

export class PostgresRawDocumentReader implements RawDocumentReader {
  constructor(private readonly db: PrismaClient) {}

  async listPending(
    options: {
      sourceKey?: string
      limit?: number
      includeIngested?: boolean
    } = {},
  ): Promise<PendingRawDocument[]> {
    const rows = await this.db.rawDocument.findMany({
      where: {
        sourceKey: options.sourceKey,
        ingestedAt: options.includeIngested ? undefined : null,
      },
      orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
      take: options.limit,
    })
    return rows.map((row) => ({
      id: row.id,
      sourceKey: row.sourceKey,
      url: row.url,
      canonicalUrl: row.canonicalUrl,
      title: row.title,
      rawContent: row.rawContent,
      fetch: {
        status: row.status,
        bodyHash: row.bodyHash ?? "",
        etag: row.etag,
        lastModified: row.lastModified,
        fetchedAt: iso(row.fetchedAt),
        notModified: row.notModified,
      },
    }))
  }

  async markIngested(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await this.db.rawDocument.updateMany({
      where: { id: { in: ids } },
      data: { ingestedAt: new Date() },
    })
  }
}

export class PostgresCorpusWriteStore implements CorpusWriteStore {
  constructor(private readonly db: PrismaClient) {}

  async upsertSource(source: SourceRecord): Promise<string> {
    const values = {
      name: source.name,
      domain: source.domain,
      trust: source.trust,
      ingestionMode: source.ingestionMode,
      languages: source.languages as Prisma.InputJsonValue,
      defaultTags: source.defaultTags as Prisma.InputJsonValue,
      defaultCategory: source.defaultCategory,
      rights: source.rights,
      contentHash: source.contentHash,
      updatedAt: new Date(),
    }
    const row = await this.db.source.upsert({
      where: { key: source.key },
      create: { key: source.key, ...values },
      update: values,
      select: { id: true },
    })
    return row.id
  }

  async getDedup(
    sourceKey: string,
    canonicalUrl: string,
  ): Promise<DedupRecord | null> {
    const rows = await this.db.$queryRaw<
      Array<{ contentHash: string; embeddingModel: string | null }>
    >`
      SELECT d.content_hash AS "contentHash", e.embedding_model AS "embeddingModel"
      FROM documents d
      JOIN sources s ON s.id = d.source_id
      LEFT JOIN chunks c ON c.document_id = d.id
      LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
      WHERE s.key = ${sourceKey} AND d.canonical_url = ${canonicalUrl}
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async replaceDocument(
    doc: NormalizedDocument,
    chunks: EmbeddedChunk[],
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const source = await tx.source.findUnique({
        where: { key: doc.sourceKey },
        select: { id: true },
      })
      if (!source) {
        throw new Error(
          `replaceDocument: unknown source key '${doc.sourceKey}' — call upsertSource first`,
        )
      }
      const existing = await tx.document.findUnique({
        where: {
          sourceId_canonicalUrl: {
            sourceId: source.id,
            canonicalUrl: doc.canonicalUrl,
          },
        },
        select: { language: true },
      })
      const row = await tx.document.upsert({
        where: {
          sourceId_canonicalUrl: {
            sourceId: source.id,
            canonicalUrl: doc.canonicalUrl,
          },
        },
        create: {
          sourceId: source.id,
          canonicalUrl: doc.canonicalUrl,
          url: doc.canonicalUrl,
          title: doc.title,
          language: doc.language,
          category: doc.category,
          contentHash: doc.contentHash,
          chunkCount: chunks.length,
          indexedAt: new Date(),
        },
        update: {
          url: doc.canonicalUrl,
          title: doc.title,
          language: doc.language ?? existing?.language,
          category: doc.category,
          contentHash: doc.contentHash,
          chunkCount: chunks.length,
          lastSeen: new Date(),
          indexedAt: new Date(),
        },
        select: { id: true },
      })
      await tx.chunk.deleteMany({ where: { documentId: row.id } })
      const chunkRows = chunks.map((chunk) => ({
        id: crypto.randomUUID(),
        documentId: row.id,
        sourceId: source.id,
        ord: chunk.ord,
        text: chunk.text,
        charStart: chunk.charStart,
        charEnd: chunk.charEnd,
        tokenCount: chunk.tokenCount,
        tags: chunk.tags as Prisma.InputJsonValue,
      }))
      if (chunkRows.length === 0) return
      await tx.chunk.createMany({ data: chunkRows })
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO chunk_embeddings (chunk_id, embedding, embedding_model)
        VALUES ${Prisma.join(
          chunks.map(
            (chunk, index) =>
              Prisma.sql`(${chunkRows[index].id}::uuid, ${toVectorLiteral(chunk.embedding)}::halfvec, ${chunk.embeddingModel})`,
          ),
        )}
      `)
    })
  }
}

type SearchRow = Omit<ScoredRow, "tags" | "score"> & {
  tags: unknown
  score: number
}

function filterSql(filter: SearchFilter): Prisma.Sql {
  const clauses: Prisma.Sql[] = []
  if (filter.allowedSourceKeys !== undefined) {
    clauses.push(
      filter.allowedSourceKeys.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`s.key IN (${Prisma.join(filter.allowedSourceKeys)})`,
    )
  }
  if (filter.sourceKey) clauses.push(Prisma.sql`s.key = ${filter.sourceKey}`)
  if (filter.domain) clauses.push(Prisma.sql`s.domain = ${filter.domain}`)
  if (filter.urlPrefix)
    clauses.push(Prisma.sql`d.canonical_url LIKE ${`${filter.urlPrefix}%`}`)
  if (filter.language) clauses.push(Prisma.sql`d.language = ${filter.language}`)
  if (filter.category) clauses.push(Prisma.sql`d.category = ${filter.category}`)
  if (filter.embeddingModel)
    clauses.push(Prisma.sql`e.embedding_model = ${filter.embeddingModel}`)
  return clauses.length
    ? Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`
    : Prisma.empty
}

const selectColumns = Prisma.sql`
  c.id AS "chunkId", c.document_id AS "documentId", c.text, c.ord, c.tags,
  s.key AS "sourceKey", s.name AS "sourceName", d.title,
  d.canonical_url AS "canonicalUrl", d.content_hash AS "contentHash"
`

const normalizeRows = (rows: SearchRow[]): ScoredRow[] =>
  rows.map((row) => ({ ...row, tags: row.tags as string[] }))

export class PostgresCorpusSearchStore implements CorpusSearchStore {
  constructor(private readonly db: PrismaClient) {}

  async vectorSearch(
    queryVec: number[],
    filter: SearchFilter,
    k: number,
  ): Promise<ScoredRow[]> {
    assertQueryDimensions(queryVec)
    const vector = toVectorLiteral(queryVec)
    const rows = await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.iterative_scan = strict_order`
      return tx.$queryRaw<SearchRow[]>(Prisma.sql`
        SELECT ${selectColumns}, 1 - (e.embedding <=> ${vector}::halfvec) AS score
        FROM chunk_embeddings e
        JOIN chunks c ON c.id = e.chunk_id
        JOIN documents d ON d.id = c.document_id
        JOIN sources s ON s.id = c.source_id
        ${filterSql(filter)}
        ORDER BY e.embedding <=> ${vector}::halfvec
        LIMIT ${k}
      `)
    })
    return normalizeRows(rows)
  }

  async keywordSearch(
    query: string,
    filter: SearchFilter,
    k: number,
  ): Promise<ScoredRow[]> {
    const base = filterSql(filter)
    const conjunction =
      base === Prisma.empty ? Prisma.sql`WHERE` : Prisma.sql`AND`
    const rows = await this.db.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT ${selectColumns},
        ts_rank_cd(c.search_tsv, websearch_to_tsquery('english', ${query})) AS score
      FROM chunks c
      JOIN documents d ON d.id = c.document_id
      JOIN sources s ON s.id = c.source_id
      LEFT JOIN chunk_embeddings e ON e.chunk_id = c.id
      ${base} ${conjunction} c.search_tsv @@ websearch_to_tsquery('english', ${query})
      ORDER BY score DESC LIMIT ${k}
    `)
    return normalizeRows(rows)
  }

  async fetchById(chunkId: string): Promise<ScoredRow | null> {
    const rows = await this.db.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT ${selectColumns}, 1::double precision AS score
      FROM chunks c JOIN documents d ON d.id = c.document_id
      JOIN sources s ON s.id = c.source_id
      WHERE c.id = ${chunkId}::uuid
    `)
    return rows[0] ? normalizeRows(rows)[0] : null
  }

  async fetchDocumentTexts(
    documentIds: string[],
  ): Promise<Map<string, string>> {
    if (documentIds.length === 0) return new Map()
    const rows = await this.db.$queryRaw<
      Array<{ documentId: string; text: string }>
    >(Prisma.sql`
      SELECT document_id AS "documentId", text FROM chunks
      WHERE document_id IN (${Prisma.join(
        documentIds.map((id) => Prisma.sql`${id}::uuid`),
      )}) ORDER BY document_id, ord
    `)
    const parts = new Map<string, string[]>()
    for (const row of rows) {
      const bucket = parts.get(row.documentId) ?? []
      bucket.push(row.text)
      parts.set(row.documentId, bucket)
    }
    return new Map([...parts].map(([id, texts]) => [id, texts.join("\n\n")]))
  }

  async embeddingModels(): Promise<string[]> {
    const rows = await this.db.chunkEmbedding.findMany({
      distinct: ["embeddingModel"],
      select: { embeddingModel: true },
    })
    return rows.map(({ embeddingModel }) => embeddingModel)
  }
}
