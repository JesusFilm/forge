import { describe, expect, it, vi } from "vitest"

import { PostgresRawDocumentReader } from "./index.js"

describe("PostgresRawDocumentReader model-aware batches", () => {
  it("limits after excluding documents already fully on the target model", async () => {
    const queries: Array<{ strings: readonly string[] }> = []
    const db = {
      $queryRaw: vi.fn(async (query: { strings: readonly string[] }) => {
        queries.push(query)
        return [{ id: queries.length === 1 ? "old-a" : "old-b" }]
      }),
      rawDocument: {
        findMany: vi.fn(
          async ({ where }: { where: { id: { in: string[] } } }) =>
            where.id.in.map((id) => ({
              id,
              sourceKey: "cru",
              url: `https://example.com/${id}`,
              canonicalUrl: `https://example.com/${id}`,
              title: id,
              rawContent: "content",
              status: 200,
              bodyHash: "hash",
              etag: null,
              lastModified: null,
              fetchedAt: new Date("2026-01-01T00:00:00Z"),
              notModified: false,
            })),
        ),
      },
    }
    const reader = new PostgresRawDocumentReader(db as never)

    const first = await reader.listPending({
      sourceKey: "cru",
      includeIngested: true,
      targetEmbeddingModel: "target/model",
      limit: 1,
    })
    const second = await reader.listPending({
      sourceKey: "cru",
      includeIngested: true,
      targetEmbeddingModel: "target/model",
      limit: 1,
    })

    expect(first.map(({ id }) => id)).toEqual(["old-a"])
    expect(second.map(({ id }) => id)).toEqual(["old-b"])
    const sql = queries[0].strings.join("?")
    expect(sql.indexOf("DISTINCT ON")).toBeLessThan(sql.indexOf("LIMIT"))
    expect(sql.indexOf("e.embedding_model <>")).toBeLessThan(
      sql.indexOf("LIMIT"),
    )
    expect(sql).toContain("r.ingested_at IS NULL")
  })
})
