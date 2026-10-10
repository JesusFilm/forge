import { describe, expect, it, vi } from "vitest"

import type { DevotionalDatabase, QueryExecutor } from "./database"
import { PostgresCatalogStore } from "./postgres-catalog"

const queryResult = (rows: unknown[] = []) =>
  ({ rows, rowCount: rows.length, command: "", oid: 0, fields: [] }) as never

describe("PostgresCatalogStore", () => {
  it("stages large catalogs in bounded set-based inserts", async () => {
    const query = vi.fn(async (sql: string, _values?: readonly unknown[]) =>
      queryResult(sql.includes("SELECT status") ? [{ status: "staging" }] : []),
    )
    const client = { query } as unknown as QueryExecutor
    const database = {
      transaction: async <T>(work: (executor: QueryExecutor) => Promise<T>) =>
        work(client),
    } as unknown as DevotionalDatabase
    const store = new PostgresCatalogStore(database)
    const documents = Array.from({ length: 501 }, (_, index) => ({
      path: `/inputs/reflections/${index}.md`,
      category: "reflections" as const,
      digest: index.toString(16).padStart(64, "0"),
      size: 10,
      modifiedAt: "2026-07-31T12:00:00.000Z",
      title: `Reflection ${index}`,
      content: "Grace endures.",
    }))

    await store.stage(7, documents)

    const inserts = query.mock.calls.filter(([sql]) =>
      sql.includes("jsonb_to_recordset"),
    )
    expect(inserts).toHaveLength(3)
    expect(
      inserts.map(([, values]) => JSON.parse(String(values?.[1])).length),
    ).toEqual([250, 250, 1])
  })
})
