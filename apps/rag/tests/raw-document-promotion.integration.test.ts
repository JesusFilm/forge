/* eslint-disable max-lines -- integration scenarios share one isolated PostgreSQL fixture */
import { Prisma, PrismaClient } from "../src/generated/prisma/index.js"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import {
  RagOperationalError,
  type RawDocument,
} from "../src/contracts/index.js"
import { PostgresRawDocumentStore } from "../src/adapters/postgres/index.js"
import { lockRawDocumentSource } from "../src/adapters/postgres/raw-document-lock.js"
import {
  PrismaRawDocumentPromotionStore,
  promoteRawDocuments,
  type PromotionRow,
} from "../scripts/lib/raw-document-promotion.js"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl)
  throw new RagOperationalError(
    "argument_invalid",
    "DATABASE_URL is required for raw-document promotion integration tests",
  )

const suffix = crypto.randomUUID().replaceAll("-", "")
const sourceSchema = `promotion_source_${suffix}`
const targetSchema = `promotion_target_${suffix}`
const admin = new PrismaClient({ datasourceUrl: databaseUrl })

const schemaUrl = (schema: string): string => {
  const parsed = new URL(databaseUrl)
  parsed.searchParams.set("schema", schema)
  return parsed.href
}

const sourceDb = new PrismaClient({ datasourceUrl: schemaUrl(sourceSchema) })
const targetDb = new PrismaClient({ datasourceUrl: schemaUrl(targetSchema) })
const source = new PrismaRawDocumentPromotionStore(sourceDb)
const target = new PrismaRawDocumentPromotionStore(targetDb)
const sourceKey = "starting-with-god"

const deferred = (): { promise: Promise<void>; resolve(): void } => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const rawTable = (schema: string): string => `
  CREATE TABLE "${schema}".raw_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_key text NOT NULL,
    url text NOT NULL,
    canonical_url text NOT NULL,
    title text,
    raw_content text NOT NULL,
    status integer,
    body_hash text,
    etag text,
    last_modified text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    not_modified boolean NOT NULL DEFAULT false,
    ingested_at timestamptz,
    index_attempted_at timestamptz,
    index_attempted_model text
  )
`

const fixture = (canonicalUrl: string, title: string): PromotionRow => ({
  sourceKey,
  url: `${canonicalUrl}?from=${title}`,
  canonicalUrl,
  title,
  rawContent: `body ${title}`,
  status: 200,
  bodyHash: `hash-${title}`,
  etag: `etag-${title}`,
  lastModified: "Wed, 02 Sep 2026 00:00:00 GMT",
  fetchedAt: new Date(
    title === "old" ? "2026-09-01T00:00:00Z" : "2026-09-02T00:00:00Z",
  ),
  notModified: false,
})

const acquisitionFixture = (
  canonicalUrl: string,
  title: string,
): RawDocument => {
  const row = fixture(canonicalUrl, title)
  return {
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
      fetchedAt: row.fetchedAt.toISOString(),
      notModified: row.notModified,
    },
  }
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${sourceSchema}"`)
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${targetSchema}"`)
  await admin.$executeRawUnsafe(rawTable(sourceSchema))
  await admin.$executeRawUnsafe(rawTable(targetSchema))
  await admin.$executeRawUnsafe(
    `CREATE INDEX raw_documents_source_key_idx ON "${sourceSchema}".raw_documents(source_key)`,
  )
  await admin.$executeRawUnsafe(
    `CREATE INDEX raw_documents_source_key_idx ON "${targetSchema}".raw_documents(source_key)`,
  )
  for (const schema of [sourceSchema, targetSchema])
    await admin.$executeRawUnsafe(
      `CREATE INDEX raw_documents_promotion_latest_idx ON "${schema}".raw_documents(source_key, canonical_url, fetched_at DESC, id DESC)`,
    )
  await sourceDb.$connect()
  await targetDb.$connect()
  await sourceDb.rawDocument.createMany({
    data: [
      {
        ...fixture("https://example.test/a", "old"),
        ingestedAt: new Date(),
        indexAttemptedAt: new Date(),
        indexAttemptedModel: "old-model",
      },
      {
        ...fixture("https://example.test/a", "new"),
        ingestedAt: new Date(),
        indexAttemptedAt: new Date(),
        indexAttemptedModel: "old-model",
      },
      {
        ...fixture("https://example.test/b", "second"),
        ingestedAt: new Date(),
        indexAttemptedAt: new Date(),
        indexAttemptedModel: "old-model",
      },
    ],
  })
})

beforeEach(() => targetDb.rawDocument.deleteMany({ where: { sourceKey } }))

afterAll(async () => {
  await Promise.all([sourceDb.$disconnect(), targetDb.$disconnect()])
  await admin.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${sourceSchema}" CASCADE`,
  )
  await admin.$executeRawUnsafe(
    `DROP SCHEMA IF EXISTS "${targetSchema}" CASCADE`,
  )
  await admin.$disconnect()
})

describe("Prisma raw-document promotion", () => {
  it("selects newest rows and commits exact pending field/digest parity", async () => {
    const preview = await promoteRawDocuments(source, target, {
      source: sourceKey,
      apply: false,
      batchSize: 1,
    })
    expect(preview).toMatchObject({ rows: 2, mutation: false })

    const result = await promoteRawDocuments(source, target, {
      source: sourceKey,
      apply: true,
      batchSize: 1,
      expectedRows: preview.rows,
      expectedDigest: preview.digest,
    })
    expect(result).toMatchObject({ rows: 2, batches: 2, mutation: true })

    const expected = await source.latestBatch(sourceKey, null, 10)
    const actual = await target.latestBatch(sourceKey, null, 10)
    expect(actual).toEqual(expected)
    const targetRows = await targetDb.rawDocument.findMany({
      where: { sourceKey },
      orderBy: { canonicalUrl: "asc" },
    })
    expect(targetRows.map(({ title }) => title)).toEqual(["new", "second"])
    expect(
      targetRows.every(
        ({ ingestedAt, indexAttemptedAt, indexAttemptedModel }) =>
          ingestedAt === null &&
          indexAttemptedAt === null &&
          indexAttemptedModel === null,
      ),
    ).toBe(true)
    expect(await target.stats(sourceKey)).toEqual({
      totalRows: 2,
      latestRows: 2,
      pendingRows: 2,
      digest: preview.digest,
    })
  })

  it("rolls back inserted corpus rows when reconciliation cannot complete", async () => {
    await expect(
      target.atomic(async (writer) => {
        await writer.insertPending([
          fixture("https://example.test/rollback", "rollback"),
        ])
        throw new RagOperationalError("corpus_state_invalid", "forced mismatch")
      }),
    ).rejects.toThrow(/forced mismatch/)
    expect((await target.stats(sourceKey)).totalRows).toBe(0)
  })

  it("reconciles source timestamps with sub-millisecond precision", async () => {
    const microsecondSource = "microsecond-source"
    await sourceDb.$executeRaw(Prisma.sql`
      INSERT INTO raw_documents (
        source_key, url, canonical_url, raw_content, fetched_at
      ) VALUES (
        ${microsecondSource}, 'https://example.test/microsecond',
        'https://example.test/microsecond', 'fixture',
        '2026-08-14 09:12:33.481297+00'::timestamptz
      )
    `)
    try {
      const preview = await promoteRawDocuments(source, target, {
        source: microsecondSource,
        apply: false,
        batchSize: 1,
      })
      await expect(
        promoteRawDocuments(source, target, {
          source: microsecondSource,
          apply: true,
          batchSize: 1,
          expectedRows: preview.rows,
          expectedDigest: preview.digest,
        }),
      ).resolves.toMatchObject({ rows: 1, mutation: true })
    } finally {
      await Promise.all([
        sourceDb.rawDocument.deleteMany({
          where: { sourceKey: microsecondSource },
        }),
        targetDb.rawDocument.deleteMany({
          where: { sourceKey: microsecondSource },
        }),
      ])
    }
  })

  it("allows only one concurrent empty-target promotion to commit", async () => {
    const secondTargetDb = new PrismaClient({
      datasourceUrl: schemaUrl(targetSchema),
    })
    try {
      const preview = await promoteRawDocuments(source, target, {
        source: sourceKey,
        apply: false,
        batchSize: 1,
      })
      const options = {
        source: sourceKey,
        apply: true,
        batchSize: 1,
        expectedRows: preview.rows,
        expectedDigest: preview.digest,
      }
      const attempts = await Promise.allSettled([
        promoteRawDocuments(source, target, options),
        promoteRawDocuments(
          source,
          new PrismaRawDocumentPromotionStore(secondTargetDb),
          options,
        ),
      ])
      expect(
        attempts.filter(({ status }) => status === "fulfilled"),
      ).toHaveLength(1)
      expect(
        attempts.filter(({ status }) => status === "rejected"),
      ).toHaveLength(1)
      expect(await target.stats(sourceKey)).toMatchObject({
        totalRows: 2,
        pendingRows: 2,
        digest: preview.digest,
      })
    } finally {
      await secondTargetDb.$disconnect()
    }
  })

  it("waits for an ordinary target write and then rejects the nonempty target", async () => {
    const gateDb = new PrismaClient({
      datasourceUrl: schemaUrl(targetSchema),
    })
    const writerDb = new PrismaClient({
      datasourceUrl: schemaUrl(targetSchema),
    })
    const ordinaryTarget = new PostgresRawDocumentStore(writerDb)
    const releaseGate = deferred()
    const gateLocked = deferred()
    let acquisition: Promise<void> | undefined
    let promotion: ReturnType<typeof promoteRawDocuments> | undefined
    const gate = gateDb.$transaction(async (tx) => {
      await lockRawDocumentSource(tx, sourceKey)
      gateLocked.resolve()
      await releaseGate.promise
    })
    try {
      const preview = await promoteRawDocuments(source, target, {
        source: sourceKey,
        apply: false,
        batchSize: 1,
      })
      await Promise.race([gateLocked.promise, gate])

      let acquisitionSettled = false
      acquisition = ordinaryTarget
        .putRawDocument(
          acquisitionFixture("https://example.test/acquired", "acquired"),
        )
        .finally(() => {
          acquisitionSettled = true
        })
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(acquisitionSettled).toBe(false)

      promotion = promoteRawDocuments(source, target, {
        source: sourceKey,
        apply: true,
        batchSize: 1,
        expectedRows: preview.rows,
        expectedDigest: preview.digest,
      })

      releaseGate.resolve()
      await acquisition
      await expect(promotion).rejects.toThrow(/already has raw documents/)
      expect((await target.stats(sourceKey)).totalRows).toBe(1)
    } finally {
      releaseGate.resolve()
      await Promise.allSettled([
        gate,
        acquisition ?? Promise.resolve(),
        promotion ?? Promise.resolve(),
      ])
      await Promise.all([gateDb.$disconnect(), writerDb.$disconnect()])
    }
  })
})
