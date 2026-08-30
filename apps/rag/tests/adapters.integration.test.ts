/* eslint-disable max-lines -- one real-Postgres lifecycle shared across adapter integration scenarios */
import { PrismaClient } from "../src/generated/prisma/index.js"
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
