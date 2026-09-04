import { describe, expect, it } from "vitest"

import { RagOperationalError } from "../../src/contracts/index.js"

import {
  parseRawDocumentPromotionArgs,
  PROMOTION_TRANSACTION_OPTIONS,
  promoteRawDocuments,
  rawDocumentPromotionErrorMessage,
  resolveRawDocumentPromotionEnvironment,
  type PromotionReader,
  type PromotionRow,
  type PromotionStats,
  type PromotionTarget,
  type PromotionWriter,
} from "./raw-document-promotion.js"

const row = (canonicalUrl: string): PromotionRow => ({
  sourceKey: "example",
  url: canonicalUrl,
  canonicalUrl,
  title: null,
  rawContent: `body:${canonicalUrl}`,
  status: 200,
  bodyHash: null,
  etag: null,
  lastModified: null,
  fetchedAt: new Date("2026-09-01T00:00:00Z"),
  notModified: false,
})

const stats = (rows: PromotionRow[]): PromotionStats => ({
  totalRows: rows.length,
  latestRows: rows.length,
  pendingRows: rows.length,
  digest: rows.length ? `digest-${rows.length}` : null,
})

class MemoryReader implements PromotionReader {
  constructor(readonly rows: PromotionRow[]) {}
  async stats(): Promise<PromotionStats> {
    return stats(this.rows)
  }
  async latestBatch(
    _source: string,
    after: string | null,
    limit: number,
  ): Promise<PromotionRow[]> {
    return this.rows
      .filter(({ canonicalUrl }) => !after || canonicalUrl > after)
      .slice(0, limit)
  }
}

class MemoryTarget
  extends MemoryReader
  implements PromotionTarget, PromotionWriter
{
  rolledBack = false
  atomicCalls = 0
  async insertPending(rows: readonly PromotionRow[]): Promise<void> {
    this.rows.push(...rows)
  }
  async atomic<T>(
    operation: (writer: PromotionWriter) => Promise<T>,
  ): Promise<T> {
    this.atomicCalls += 1
    const before = [...this.rows]
    try {
      return await operation(this)
    } catch (error) {
      this.rows.splice(0, this.rows.length, ...before)
      this.rolledBack = true
      throw error
    }
  }
}

describe("raw-document promotion", () => {
  it("serializes the empty-target check with the production inserts", () => {
    expect(PROMOTION_TRANSACTION_OPTIONS.isolationLevel).toBe("Serializable")
  })

  it("prints operator-safe failures and redacts unexpected database errors", () => {
    expect(
      rawDocumentPromotionErrorMessage(
        new RagOperationalError("argument_invalid", "reviewed input is stale"),
      ),
    ).toBe("reviewed input is stale")
    const message = rawDocumentPromotionErrorMessage(
      new Error("password=hunter2 raw corpus body"),
    )
    expect(message).toBe("raw-document promotion failed (details redacted)")
    expect(message).not.toMatch(/hunter2|corpus body/)
  })

  it("is dry-run by default and requires one safe source", () => {
    expect(parseRawDocumentPromotionArgs(["--source", "small-source"])).toEqual(
      {
        source: "small-source",
        apply: false,
        batchSize: 100,
      },
    )
    expect(() => parseRawDocumentPromotionArgs([])).toThrow(/--source/)
    expect(() =>
      parseRawDocumentPromotionArgs(["--source", "x'; DROP TABLE"]),
    ).toThrow(/lowercase/)
    expect(() =>
      parseRawDocumentPromotionArgs([
        "--source",
        "first",
        "--source",
        "second",
      ]),
    ).toThrow(/only be specified once/)
    expect(() =>
      parseRawDocumentPromotionArgs(["--source", "small-source", "--apply"]),
    ).toThrow(/expected-rows.*expected-digest/)
  })

  it("requires distinct explicit database targets and both production guards", () => {
    const base = {
      RAG_LOCAL_DATABASE_URL: "postgresql://local:secret@localhost:5435/rag",
      JFRAG_POSTGRESQL_DB_URL: "postgresql://prod:secret@prod.example:5432/rag",
      JFRAG_EXPECTED_POSTGRES_HOST: "prod.example",
    }
    expect(resolveRawDocumentPromotionEnvironment(base, false)).toMatchObject({
      sourceUrl: expect.stringContaining("localhost"),
      targetUrl: expect.stringContaining("prod.example"),
    })
    expect(() => resolveRawDocumentPromotionEnvironment(base, true)).toThrow(
      /ALLOW_PROD_WRITE/,
    )
    expect(() =>
      resolveRawDocumentPromotionEnvironment(
        { ...base, JFRAG_EXPECTED_POSTGRES_HOST: "wrong.example" },
        false,
      ),
    ).toThrow(/does not match/)
    expect(() =>
      resolveRawDocumentPromotionEnvironment(
        {
          ...base,
          RAG_LOCAL_DATABASE_URL:
            "postgresql://reader:other@prod.example:5432/rag",
        },
        false,
      ),
    ).toThrow(/same database/)
  })

  it("copies latest rows in bounded batches and reconciles pending rows", async () => {
    const source = new MemoryReader([
      row("https://example.test/a"),
      row("https://example.test/b"),
      row("https://example.test/c"),
    ])
    const target = new MemoryTarget([])
    await expect(
      promoteRawDocuments(source, target, {
        source: "example",
        apply: true,
        batchSize: 2,
        expectedRows: 3,
        expectedDigest: "digest-3",
      }),
    ).resolves.toMatchObject({ rows: 3, batches: 2, mutation: true })
    expect(target.rows).toHaveLength(3)
  })

  it("refuses a nonempty production source before mutation", async () => {
    const source = new MemoryReader([row("https://example.test/a")])
    const target = new MemoryTarget([row("https://example.test/existing")])
    await expect(
      promoteRawDocuments(source, target, {
        source: "example",
        apply: true,
        batchSize: 100,
        expectedRows: 1,
        expectedDigest: "digest-1",
      }),
    ).rejects.toThrow(/already has raw documents/)
    expect(target.rows).toHaveLength(1)
  })

  it("refuses a stale preview before starting a target transaction", async () => {
    const source = new MemoryReader([row("https://example.test/a")])
    const target = new MemoryTarget([])
    await expect(
      promoteRawDocuments(source, target, {
        source: "example",
        apply: true,
        batchSize: 100,
        expectedRows: 2,
        expectedDigest: "digest-2",
      }),
    ).rejects.toThrow(/no longer matches/)
    expect(target.atomicCalls).toBe(0)
    expect(target.rows).toHaveLength(0)
  })

  it("rolls back when local rows change during the copy", async () => {
    const source = new MemoryReader([row("https://example.test/a")])
    const target = new MemoryTarget([])
    const originalBatch = source.latestBatch.bind(source)
    source.latestBatch = async (...args) => {
      const rows = await originalBatch(...args)
      if (rows.length) source.rows.push(row("https://example.test/b"))
      return rows
    }
    await expect(
      promoteRawDocuments(source, target, {
        source: "example",
        apply: true,
        batchSize: 100,
        expectedRows: 1,
        expectedDigest: "digest-1",
      }),
    ).rejects.toThrow(/changed during promotion/)
    expect(target.rolledBack).toBe(true)
    expect(target.rows).toHaveLength(0)
  })
})
