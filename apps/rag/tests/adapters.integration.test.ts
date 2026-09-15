/* eslint-disable max-lines -- one real-Postgres lifecycle shared across adapter integration scenarios */
import { setTimeout as delay } from "node:timers/promises"
import { Prisma, PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  EMBEDDING_DIMENSIONS,
  PostgresCorpusSearchStore,
  PostgresCorpusWriteStore,
  PostgresFetchStateStore,
  PostgresLanguageMaintenanceStore,
  PostgresRawDocumentReader,
  PostgresRawDocumentStore,
} from "../src/adapters/postgres/index.js"
import type {
  EmbeddedChunk,
  NormalizedDocument,
  RawDocument,
  SourceRecord,
} from "../src/contracts/index.js"
import { createRetriever } from "../src/retrieval/index.js"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new Error("DATABASE_URL is required for adapter integration tests")
const db = new PrismaClient({ datasourceUrl: databaseUrl })
const key = `adapter-test-${crypto.randomUUID()}`
const prefix = `https://${key}.test/`

const source: SourceRecord = {
  key,
  name: "Adapter fixture",
  domain: `${key}.test`,
  trust: "owned",
  ingestionMode: "manual",
  languages: ["en", "fr"],
  defaultTags: ["fixture"],
  defaultCategory: "article",
  rights: "test",
  contentHash: null,
}

const document = (
  hash: string,
  language: string | null,
): NormalizedDocument => ({
  sourceKey: key,
  source: `${key}.test`,
  canonicalUrl: `${prefix}hope`,
  title: "Hope",
  content: "Hope remains",
  language,
  category: "article",
  tags: ["fixture"],
  contentHash: hash,
  metadata: {},
})

const vector = (axis: number): number[] => {
  const value = Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  value[axis] = 1
  return value
}

const chunk = (
  ord: number,
  text: string,
  axis: number,
  embeddingModel = "fixture/model",
): EmbeddedChunk => ({
  ord,
  text,
  charStart: 0,
  charEnd: text.length,
  tokenCount: text.split(" ").length,
  tags: ["fixture"],
  embedding: vector(axis),
  embeddingModel,
})

const raw = (body: string, slug = "raw"): RawDocument => ({
  sourceKey: key,
  url: `${prefix}${slug}`,
  canonicalUrl: `${prefix}${slug}`,
  title: "Raw",
  rawContent: body,
  fetch: {
    status: 200,
    bodyHash: body,
    etag: null,
    lastModified: null,
    fetchedAt: "2026-08-28T00:00:00.000Z",
    notModified: false,
  },
})

// Occupy a real connection (and optionally a row lock) before starting the
// adapter. No fake timers, transaction mocks, or production delay hooks.
async function whileTransactionHeld<T>(
  client: PrismaClient,
  holdMs: number,
  prepare: (tx: Prisma.TransactionClient) => Promise<unknown>,
  operation: () => Promise<T>,
): Promise<T> {
  let signalReady!: () => void
  let signalFailure!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    signalReady = resolve
    signalFailure = reject
  })
  const holding = client.$transaction(
    async (tx) => {
      await prepare(tx)
      signalReady()
      await delay(holdMs)
    },
    { maxWait: 10_000, timeout: holdMs + 10_000 },
  )
  void holding.catch(signalFailure)
  try {
    await ready
    return await operation()
  } finally {
    await holding
  }
}

beforeAll(() => db.$connect())
afterAll(async () => {
  await db.source.deleteMany({ where: { key } })
  await db.rawDocument.deleteMany({ where: { sourceKey: key } })
  await db.httpCache.deleteMany({ where: { url: { startsWith: prefix } } })
  await db.robotsCache.deleteMany({
    where: { robotsUrl: { startsWith: prefix } },
  })
  await db.$disconnect()
})

describe("Prisma-backed RAG adapters", () => {
  const writes = new PostgresCorpusWriteStore(db)
  const search = new PostgresCorpusSearchStore(db)
  const rawStore = new PostgresRawDocumentStore(db)
  const rawReader = new PostgresRawDocumentReader(db)
  const fetchState = new PostgresFetchStateStore(db)
  const languageStore = new PostgresLanguageMaintenanceStore(db)
  const resetCorpusFixture = async () => {
    await db.source.deleteMany({ where: { key } })
    await db.rawDocument.deleteMany({ where: { sourceKey: key } })
  }

  it("upserts caches and preserves ISO timestamps", async () => {
    await fetchState.putHttpCache({
      url: `${prefix}cache`,
      etag: "v1",
      lastModified: null,
      bodyHash: "a",
      status: 200,
      fetchedAt: "2026-08-28T00:00:00.000Z",
    })
    await fetchState.putHttpCache({
      url: `${prefix}cache`,
      etag: "v2",
      lastModified: null,
      bodyHash: "b",
      status: 304,
      fetchedAt: "2026-08-28T01:00:00.000Z",
    })
    expect(await fetchState.getHttpCache(`${prefix}cache`)).toMatchObject({
      etag: "v2",
      bodyHash: "b",
      fetchedAt: "2026-08-28T01:00:00.000Z",
    })
  })

  it("replaces only pending raw rows and resumes over ingested plus pending", async () => {
    await rawStore.putRawDocument(raw("first"))
    await rawStore.putRawDocument(raw("second"))
    let pending = await rawReader.listPending({ sourceKey: key })
    expect(pending).toHaveLength(1)
    expect(pending[0].rawContent).toBe("second")
    await rawReader.markIngested([pending[0].id])
    await rawStore.putRawDocument(raw("third"))
    pending = await rawReader.listPending({ sourceKey: key })
    expect(pending).toHaveLength(1)
    expect(await rawStore.listStagedCanonicalUrls(key)).toEqual([
      `${prefix}raw`,
    ])
    expect(
      await rawReader.listPending({ sourceKey: key, includeIngested: true }),
    ).toHaveLength(2)
  })

  it("records the attempted model in the document replacement transaction", async () => {
    await resetCorpusFixture()
    await writes.upsertSource(source)
    await rawStore.putRawDocument(raw("atomic model state", "atomic-model"))
    const [pending] = await rawReader.listPending({ sourceKey: key })

    await writes.replaceDocument(
      {
        ...document("atomic-model", "en"),
        canonicalUrl: pending.canonicalUrl,
      },
      [chunk(0, "Atomic model state", 0, "fixture/model-atomic")],
      {
        rawDocumentId: pending.id,
        attemptedModel: "fixture/model-atomic",
      },
    )

    await expect(
      db.rawDocument.findUniqueOrThrow({ where: { id: pending.id } }),
    ).resolves.toMatchObject({
      ingestedAt: expect.any(Date),
      indexAttemptedModel: "fixture/model-atomic",
    })
    await expect(
      rawReader.listPending({
        sourceKey: key,
        includeIngested: true,
        targetEmbeddingModel: "fixture/model-atomic",
      }),
    ).resolves.toEqual([])
  })

  it("acquires a corpus transaction after waiting beyond two seconds", async () => {
    await resetCorpusFixture()
    await writes.upsertSource(source)
    const singleConnectionUrl = new URL(databaseUrl)
    singleConnectionUrl.searchParams.set("connection_limit", "1")
    const client = new PrismaClient({ datasourceUrl: singleConnectionUrl.href })
    try {
      const writer = new PostgresCorpusWriteStore(client)
      await whileTransactionHeld(
        client,
        3_000,
        (tx) => tx.$queryRaw`SELECT 1`,
        () =>
          writer.replaceDocument(document("waited", "en"), [
            chunk(0, "Waited", 0),
          ]),
      )
      expect(await writes.getDedup(key, `${prefix}hope`)).toMatchObject({
        contentHash: "waited",
      })
    } finally {
      await client.$disconnect()
    }
  }, 15_000)

  it("commits corpus and staging after a write exceeds five seconds", async () => {
    await resetCorpusFixture()
    await writes.upsertSource(source)
    await rawStore.putRawDocument(raw("Delayed write", "hope"))
    const [pending] = await rawReader.listPending({ sourceKey: key })
    const blocker = new PrismaClient({ datasourceUrl: databaseUrl })
    try {
      await whileTransactionHeld(
        blocker,
        6_000,
        (tx) => tx.$queryRaw`
          SELECT id FROM raw_documents WHERE id = ${pending.id}::uuid FOR UPDATE
        `,
        () =>
          writes.replaceDocument(
            document("delayed", "en"),
            [chunk(0, "Delayed write", 0)],
            {
              rawDocumentId: pending.id,
              attemptedModel: "fixture/model",
            },
          ),
      )
      expect(await writes.getDedup(key, `${prefix}hope`)).toEqual({
        contentHash: "delayed",
        embeddingModel: "fixture/model",
      })
      expect(await db.chunk.count({ where: { source: { key } } })).toBe(1)
      expect(
        await db.rawDocument.findUniqueOrThrow({ where: { id: pending.id } }),
      ).toMatchObject({
        ingestedAt: expect.any(Date),
        indexAttemptedAt: expect.any(Date),
        indexAttemptedModel: "fixture/model",
      })
    } finally {
      await blocker.$disconnect()
    }
  }, 20_000)

  it("rolls back the entire replacement when the 30-second deadline expires", async () => {
    await resetCorpusFixture()
    await writes.upsertSource(source)
    await writes.replaceDocument(document("original", "en"), [
      chunk(0, "Original", 0),
    ])
    await rawStore.putRawDocument(raw("Replacement", "hope"))
    const [pending] = await rawReader.listPending({ sourceKey: key })
    const snapshot = async () => ({
      documents: await db.document.findMany({
        where: { source: { key } },
        include: { chunks: { orderBy: { ord: "asc" } } },
      }),
      embeddings: await db.$queryRaw`
        SELECT e.chunk_id, e.embedding::text, e.embedding_model, e.embedded_at
        FROM chunk_embeddings e JOIN chunks c ON c.id = e.chunk_id
        JOIN sources s ON s.id = c.source_id WHERE s.key = ${key}
        ORDER BY e.chunk_id
      `,
      staging: await db.rawDocument.findUniqueOrThrow({
        where: { id: pending.id },
      }),
    })
    const before = await snapshot()
    const blocker = new PrismaClient({ datasourceUrl: databaseUrl })
    try {
      // The final staging update blocks after document/chunk/vector writes.
      // Releasing the lock after 32s must not allow an expired write to commit.
      await expect(
        whileTransactionHeld(
          blocker,
          32_000,
          (tx) => tx.$queryRaw`
          SELECT id FROM raw_documents WHERE id = ${pending.id}::uuid FOR UPDATE
        `,
          () =>
            writes.replaceDocument(
              document("replacement", "fr"),
              [chunk(0, "Replacement", 1, "fixture/new-model")],
              {
                rawDocumentId: pending.id,
                attemptedModel: "fixture/new-model",
              },
            ),
        ),
      ).rejects.toMatchObject({ code: "P2028" })
      expect(await snapshot()).toEqual(before)
      expect(
        (await rawReader.listPending({ sourceKey: key })).map(({ id }) => id),
      ).toEqual([pending.id])
    } finally {
      await blocker.$disconnect()
    }
  }, 45_000)

  it("applies literal path boundaries before limits in normal and forced reads", async () => {
    await resetCorpusFixture()
    await writes.upsertSource(source)
    for (const slug of [
      "english/article.html",
      "islenska-other/article.html",
      "isXYZ/article.html",
      "islenska/article.html",
      "is_%/article.html",
    ]) {
      await rawStore.putRawDocument(raw(`Fixture ${slug}`, slug))
    }
    for (const path of ["islenska/", "is_%/"]) {
      for (const mode of [
        {},
        { includeIngested: true },
        { includeIngested: true, targetEmbeddingModel: "fixture/new" },
      ]) {
        const selected = await rawReader.listPending({
          sourceKey: key,
          canonicalUrlPrefix: `${prefix}${path}`,
          limit: 1,
          ...mode,
        })
        expect(selected.map(({ canonicalUrl }) => canonicalUrl)).toEqual([
          `${prefix}${path}article.html`,
        ])
      }
    }
    expect(await rawReader.listPending({ sourceKey: key })).toHaveLength(5)
  })

  it("atomically replaces chunks, preserves language, and retrieves the fixture", async () => {
    const sourceId = await writes.upsertSource(source)
    await writes.replaceDocument(document("v1", "en"), [
      chunk(0, "Jesus gives lasting hope", 0),
      chunk(1, "A second paragraph", 1),
    ])
    await writes.replaceDocument(document("v2", null), [
      chunk(0, "Jesus gives lasting hope", 0),
    ])
    expect(await writes.getDedup(key, `${prefix}hope`)).toEqual({
      contentHash: "v2",
      embeddingModel: "fixture/model",
    })
    const stored = await db.document.findUniqueOrThrow({
      where: {
        sourceId_canonicalUrl: {
          sourceId,
          canonicalUrl: `${prefix}hope`,
        },
      },
      include: { chunks: true },
    })
    expect(stored.language).toBe("en")
    expect(stored.chunks).toHaveLength(1)

    const retriever = createRetriever({
      embedder: {
        model: "fixture/model",
        dimensions: EMBEDDING_DIMENSIONS,
        embed: async () => [],
        embedQuery: async () => vector(0),
      },
      search,
    })
    const hits = await retriever.search("hope", {
      allowedSourceKeys: [key],
      language: "en",
      minScore: 0.9,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].citation.url).toBe(`${prefix}hope`)
    expect(
      await search.keywordSearch(
        "lasting hope",
        { allowedSourceKeys: [key] },
        5,
      ),
    ).toHaveLength(1)
    expect(
      await search.vectorSearch(vector(0), { allowedSourceKeys: [] }, 5),
    ).toEqual([])
  })

  it("advances bounded forced reindex batches past the target model", async () => {
    await writes.upsertSource(source)
    await rawStore.putRawDocument(raw("old-a", "old-a"))
    await rawStore.putRawDocument(raw("old-b", "old-b"))
    const staged = await rawReader.listPending({ sourceKey: key })
    await rawReader.markIngested(staged.map(({ id }) => id))

    const oldDocument = (slug: string): NormalizedDocument => ({
      ...document(slug, "en"),
      canonicalUrl: `${prefix}${slug}`,
      title: slug,
    })
    await writes.replaceDocument(oldDocument("old-a"), [
      chunk(0, "Old model A", 0, "fixture/model-old"),
    ])
    await writes.replaceDocument(oldDocument("old-b"), [
      chunk(0, "Old model B", 1, "fixture/model-old"),
    ])

    const first = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })
    expect(first).toHaveLength(1)
    await writes.replaceDocument(
      oldDocument(first[0].canonicalUrl.split("/").at(-1)!),
      [chunk(0, "Migrated", 0, "fixture/model-target")],
    )

    const second = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })
    expect(second).toHaveLength(1)
    expect(second[0].id).not.toBe(first[0].id)
  })

  it("selects the newest raw snapshot before bounding a forced batch", async () => {
    await resetCorpusFixture()
    const slug = `snapshot-${crypto.randomUUID()}`
    await writes.upsertSource(source)
    await rawStore.putRawDocument(raw("older snapshot", slug))
    const [older] = await rawReader.listPending({ sourceKey: key })
    await rawReader.markIngested([older.id])
    await rawStore.putRawDocument({
      ...raw("newer snapshot", slug),
      fetch: {
        ...raw("newer snapshot", slug).fetch,
        fetchedAt: "2026-08-28T01:00:00.000Z",
      },
    })
    await writes.replaceDocument(
      { ...document(slug, "en"), canonicalUrl: `${prefix}${slug}` },
      [chunk(0, "Old model", 0, "fixture/model-old")],
    )

    const [selected] = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })

    expect(selected.rawContent).toBe("newer snapshot")
    expect(selected.id).not.toBe(older.id)
  })

  it("selects a fresh snapshot even when the document already uses the target model", async () => {
    await resetCorpusFixture()
    const slug = `target-snapshot-${crypto.randomUUID()}`
    await writes.upsertSource(source)
    await rawStore.putRawDocument(raw("older snapshot", slug))
    const [older] = await rawReader.listPending({ sourceKey: key })
    await rawReader.markIngested([older.id])
    await writes.replaceDocument(
      { ...document(slug, "en"), canonicalUrl: `${prefix}${slug}` },
      [chunk(0, "Target model", 0, "fixture/model-target")],
    )
    await rawStore.putRawDocument({
      ...raw("fresh changed snapshot", slug),
      fetch: {
        ...raw("fresh changed snapshot", slug).fetch,
        fetchedAt: "2026-08-28T02:00:00.000Z",
      },
    })

    const selected = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })

    expect(selected).toHaveLength(1)
    expect(selected[0].rawContent).toBe("fresh changed snapshot")
  })

  it("does not let drained non-indexable residue starve forced batches", async () => {
    await resetCorpusFixture()
    const residueSlug = `residue-${crypto.randomUUID()}`
    const migratableSlug = `migratable-${crypto.randomUUID()}`
    await writes.upsertSource(source)
    await rawStore.putRawDocument(raw("thin", residueSlug))
    const residue = await rawReader.listPending({ sourceKey: key })
    await rawReader.markIngested(residue.map(({ id }) => id))
    await rawStore.putRawDocument(raw("migratable", migratableSlug))
    const staged = await rawReader.listPending({ sourceKey: key })
    await rawReader.markIngested(staged.map(({ id }) => id))
    await writes.replaceDocument(
      {
        ...document(migratableSlug, "en"),
        canonicalUrl: `${prefix}${migratableSlug}`,
      },
      [chunk(0, "Old model", 0, "fixture/model-old")],
    )

    const selected = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })

    expect(selected.map(({ canonicalUrl }) => canonicalUrl)).toEqual([
      `${prefix}${migratableSlug}`,
    ])
  })

  it("does not repeatedly select an attempted stale-model snapshot", async () => {
    await resetCorpusFixture()
    const stalledSlug = `stalled-${crypto.randomUUID()}`
    const nextSlug = `next-${crypto.randomUUID()}`
    await writes.upsertSource(source)
    for (const slug of [stalledSlug, nextSlug]) {
      await rawStore.putRawDocument(raw(`snapshot ${slug}`, slug))
      const rows = await rawReader.listPending({ sourceKey: key })
      await rawReader.markIngested(rows.map(({ id }) => id))
      await writes.replaceDocument(
        { ...document(slug, "en"), canonicalUrl: `${prefix}${slug}` },
        [chunk(0, "Old model", 0, "fixture/model-old")],
      )
    }
    await db.rawDocument.updateMany({
      where: { sourceKey: key },
      data: { indexAttemptedAt: null },
    })

    const [first] = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })
    await rawReader.markIngested([first.id], "fixture/model-target")
    const [second] = await rawReader.listPending({
      sourceKey: key,
      includeIngested: true,
      targetEmbeddingModel: "fixture/model-target",
      limit: 1,
    })

    expect(second.id).not.toBe(first.id)
  })

  it("advances bounded full language sweeps with an explicit cursor", async () => {
    await resetCorpusFixture()
    const sourceId = await writes.upsertSource(source)
    for (const slug of ["language-a", "language-b"]) {
      await rawStore.putRawDocument(raw(`content ${slug}`, slug))
      await writes.replaceDocument(
        { ...document(slug, "en"), canonicalUrl: `${prefix}${slug}` },
        [chunk(0, slug, 0)],
      )
    }
    const first = await languageStore.listCandidates({
      sourceKey: key,
      blanksOnly: false,
      limit: 1,
    })
    const second = await languageStore.listCandidates({
      sourceKey: key,
      blanksOnly: false,
      limit: 1,
      afterId: first[0].id,
    })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(second[0].id).not.toBe(first[0].id)
    expect(await db.document.count({ where: { sourceId } })).toBeGreaterThan(1)
  })

  it("updates language and persists its rollback audit atomically", async () => {
    await resetCorpusFixture()
    await writes.upsertSource(source)
    const slug = `language-audit-${crypto.randomUUID()}`
    await rawStore.putRawDocument(raw("audited language content", slug))
    await writes.replaceDocument(
      { ...document(slug, null), canonicalUrl: `${prefix}${slug}` },
      [chunk(0, slug, 0)],
    )
    const [candidate] = await languageStore.listCandidates({
      sourceKey: key,
      blanksOnly: true,
      limit: 1,
    })
    const runId = `audit-${crypto.randomUUID()}`

    await languageStore.applyLanguageChanges(
      key,
      [{ id: candidate.id, oldLanguage: null, newLanguage: "en" }],
      { runId, detectorModel: "fixture/language" },
    )

    await expect(
      db.document.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({ language: "en", updatedAt: expect.any(Date) })
    await expect(
      db.languageChangeAudit.findUniqueOrThrow({
        where: {
          runId_documentId: { runId, documentId: candidate.id },
        },
      }),
    ).resolves.toMatchObject({
      sourceKey: key,
      oldLanguage: null,
      newLanguage: "en",
      detectorModel: "fixture/language",
    })
  })

  it("fails before SQL when the query vector width is wrong", async () => {
    await expect(search.vectorSearch([1, 0], {}, 5)).rejects.toThrow(
      /expected 1536/,
    )
  })

  it("continues HNSW scans until a filtered neighbor is found", async () => {
    const needleKey = `${key}-hnsw-needle`
    const distractorKey = `${key}-hnsw-distractors`
    const hnswDatabaseUrl = new URL(databaseUrl)
    hnswDatabaseUrl.searchParams.set("connection_limit", "1")
    const hnswDb = new PrismaClient({ datasourceUrl: hnswDatabaseUrl.href })
    const hnswWrites = new PostgresCorpusWriteStore(hnswDb)
    const hnswSearch = new PostgresCorpusSearchStore(hnswDb)
    const fixtureSource = (sourceKey: string): SourceRecord => ({
      ...source,
      key: sourceKey,
      name: sourceKey,
      domain: `${sourceKey}.test`,
    })
    const fixtureDocument = (
      sourceKey: string,
      slug: string,
    ): NormalizedDocument => ({
      ...document(`${sourceKey}-v1`, "en"),
      sourceKey,
      source: `${sourceKey}.test`,
      canonicalUrl: `${prefix}${slug}`,
      title: slug,
    })

    try {
      await hnswDb.$connect()
      await hnswDb.$executeRaw`SET enable_seqscan = off`
      await hnswDb.$executeRaw`SET enable_sort = off`
      await hnswWrites.upsertSource(fixtureSource(distractorKey))
      await hnswWrites.replaceDocument(
        fixtureDocument(distractorKey, "hnsw-distractors"),
        Array.from({ length: 512 }, (_, ord) => {
          const embedding = vector(0)
          embedding[(ord % (EMBEDDING_DIMENSIONS - 1)) + 1] = 0.001
          return {
            ...chunk(ord, `Excluded near neighbor ${ord}`, 0),
            embedding,
          }
        }),
      )

      await hnswWrites.upsertSource(fixtureSource(needleKey))
      const needleVector = vector(0)
      needleVector[0] = 0.9
      needleVector[1] = 0.1
      await hnswWrites.replaceDocument(
        fixtureDocument(needleKey, "hnsw-needle"),
        [
          {
            ...chunk(0, "Reachable filtered needle", 0),
            embedding: needleVector,
          },
        ],
      )

      const hits = await hnswSearch.vectorSearch(
        vector(0),
        { allowedSourceKeys: [needleKey] },
        1,
      )

      expect(hits).toHaveLength(1)
      expect(hits[0]).toMatchObject({
        sourceKey: needleKey,
        text: "Reachable filtered needle",
      })
    } finally {
      try {
        await hnswDb.source.deleteMany({
          where: { key: { in: [needleKey, distractorKey] } },
        })
      } finally {
        await hnswDb.$disconnect()
      }
    }
  })
})
