import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it, vi } from "vitest"

import {
  assertDevotionalSchemaReady,
  createDatabaseAuditSink,
  createDevotionalDatabase,
  getDevotionalCutoverReadiness,
  getDevotionalSchemaReadiness,
  hasDevotionalVectorCapability,
  MAX_DEVOTIONAL_DATABASE_POOL_SIZE,
  runDevotionalTransaction,
  type QueryExecutor,
} from "./database"

function executorWithRows(rows: QueryResultRow[]): QueryExecutor {
  return {
    async query<T extends QueryResultRow>(): Promise<QueryResult<T>> {
      return {
        rows: rows as T[],
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      }
    },
  }
}

describe("devotional Workspace database", () => {
  it("keeps the direct SQL pool within its three-connection budget", async () => {
    const database = createDevotionalDatabase({
      connectionString: "postgresql://localhost/unused",
    })

    expect(database.maxConnections).toBe(MAX_DEVOTIONAL_DATABASE_POOL_SIZE)
    expect(database.pool.options.max).toBe(MAX_DEVOTIONAL_DATABASE_POOL_SIZE)
    await database.close()
  })

  it("rejects a pool override above the service budget", () => {
    expect(() =>
      createDevotionalDatabase({
        connectionString: "postgresql://localhost/unused",
        maxConnections: MAX_DEVOTIONAL_DATABASE_POOL_SIZE + 1,
      }),
    ).toThrow(/2-3 connections/)
    expect(() =>
      createDevotionalDatabase({
        connectionString: "postgresql://localhost/unused",
        maxConnections: 1,
      }),
    ).toThrow(/2-3 connections/)
  })

  it("requires exactly the expected migration version before starts", async () => {
    await expect(
      getDevotionalSchemaReadiness(executorWithRows([{ version: 1 }])),
    ).resolves.toEqual({ ready: true, version: 1 })
    await expect(
      assertDevotionalSchemaReady(executorWithRows([{ version: 0 }])),
    ).rejects.toThrow(/expected devotional schema version 1, found 0/)
  })

  it("detects the pgvector extension independently from migration version", async () => {
    await expect(
      hasDevotionalVectorCapability(executorWithRows([{ available: true }])),
    ).resolves.toBe(true)
    await expect(
      hasDevotionalVectorCapability(executorWithRows([{ available: false }])),
    ).resolves.toBe(false)
  })

  it("reads the authoritative cutover gate from PostgreSQL", async () => {
    await expect(
      getDevotionalCutoverReadiness(
        executorWithRows([
          {
            ready: true,
            manifest_digest: "a".repeat(64),
            reason: null,
            verified_at: new Date("2026-07-31T12:00:00Z"),
          },
        ]),
      ),
    ).resolves.toEqual({
      ready: true,
      manifestDigest: "a".repeat(64),
      verifiedAt: "2026-07-31T12:00:00.000Z",
    })
    await expect(
      getDevotionalCutoverReadiness(
        executorWithRows([
          {
            ready: false,
            manifest_digest: null,
            reason: "migration pending",
            verified_at: null,
          },
        ]),
      ),
    ).resolves.toEqual({ ready: false, reason: "migration pending" })
  })

  it("maps append-only audit fields into a parameterized insert", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const sink = createDatabaseAuditSink({
      query: query as unknown as QueryExecutor["query"],
    })

    await sink({
      id: "audit-1",
      operationId: "operation-1",
      phase: "completed",
      occurredAt: new Date("2026-07-31T12:00:00Z"),
      actorId: "editor-1",
      requestId: "request-1",
      action: "write",
      path: "inputs/reflections/grace.md",
      preDigest: undefined,
      postDigest: "a".repeat(64),
      trustedEditorialRightsAssertion: true,
    })

    expect(query).toHaveBeenCalledOnce()
    expect(query.mock.calls[0]?.[0]).toContain("filesystem_mutation_audit")
    expect(query.mock.calls[0]?.[1]).toEqual([
      "audit-1",
      "operation-1",
      "completed",
      new Date("2026-07-31T12:00:00Z"),
      "editor-1",
      "request-1",
      "write",
      "inputs/reflections/grace.md",
      null,
      null,
      "a".repeat(64),
      true,
    ])
  })

  it("commits successful transactions and rolls back failures before release", async () => {
    const successfulQueries: string[] = []
    const successfulRelease = vi.fn()
    await expect(
      runDevotionalTransaction(
        {
          connect: async () => ({
            query: (async (sql: string) => {
              successfulQueries.push(sql)
              return { rows: [] }
            }) as unknown as QueryExecutor["query"],
            release: successfulRelease,
          }),
        },
        async (client) => {
          await client.query("select 1")
          return "done"
        },
      ),
    ).resolves.toBe("done")
    expect(successfulQueries).toEqual(["begin", "select 1", "commit"])
    expect(successfulRelease).toHaveBeenCalledOnce()

    const failedQueries: string[] = []
    const failedRelease = vi.fn()
    await expect(
      runDevotionalTransaction(
        {
          connect: async () => ({
            query: (async (sql: string) => {
              failedQueries.push(sql)
              return { rows: [] }
            }) as unknown as QueryExecutor["query"],
            release: failedRelease,
          }),
        },
        async () => {
          throw new Error("work failed")
        },
      ),
    ).rejects.toThrow("work failed")
    expect(failedQueries).toEqual(["begin", "rollback"])
    expect(failedRelease).toHaveBeenCalledOnce()
  })
})
