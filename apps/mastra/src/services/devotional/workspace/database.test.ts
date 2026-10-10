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
  REQUIRED_DEVOTIONAL_MIGRATION,
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

function executorWithMigrations(
  migrations: Array<{ version: number; name: string; sha256: string }>,
): QueryExecutor & { query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(
    async (text: string, values?: readonly unknown[]): Promise<QueryResult> => {
      const row = migrations.find(
        (migration) =>
          migration.version === values?.[0] &&
          migration.name === values?.[1] &&
          migration.sha256 === values?.[2],
      )
      const rows = row ? [{ version: row.version }] : []
      return {
        rows,
        command: "SELECT",
        rowCount: rows.length,
        oid: 0,
        fields: [],
      }
    },
  )
  return {
    query: query as unknown as QueryExecutor["query"] &
      ReturnType<typeof vi.fn>,
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

  it("requires the exact devotional migration before starts", async () => {
    await expect(
      getDevotionalSchemaReadiness(
        executorWithMigrations([{ ...REQUIRED_DEVOTIONAL_MIGRATION }]),
      ),
    ).resolves.toEqual({ ready: true, version: 1 })
    await expect(
      assertDevotionalSchemaReady(executorWithMigrations([])),
    ).rejects.toThrow(/required devotional migration 1 is unavailable/)
  })

  it("stays ready when support research has a later shared-ledger migration", async () => {
    const executor = executorWithMigrations([
      { ...REQUIRED_DEVOTIONAL_MIGRATION },
      {
        version: 2,
        name: "002-support-research.sql",
        sha256: "a".repeat(64),
      },
      {
        version: 99,
        name: "099-future-component.sql",
        sha256: "b".repeat(64),
      },
    ])

    await expect(getDevotionalSchemaReadiness(executor)).resolves.toEqual({
      ready: true,
      version: 1,
    })
    expect(executor.query).toHaveBeenCalledWith(
      expect.not.stringMatching(/order by/u),
      [
        REQUIRED_DEVOTIONAL_MIGRATION.version,
        REQUIRED_DEVOTIONAL_MIGRATION.name,
        REQUIRED_DEVOTIONAL_MIGRATION.sha256,
      ],
    )
    expect(executor.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /where version = \$1\s+and name = \$2\s+and sha256 = \$3/u,
      ),
      [
        REQUIRED_DEVOTIONAL_MIGRATION.version,
        REQUIRED_DEVOTIONAL_MIGRATION.name,
        REQUIRED_DEVOTIONAL_MIGRATION.sha256,
      ],
    )
  })

  it.each([
    ["an empty ledger", []],
    [
      "only a later migration",
      [
        {
          version: 2,
          name: "002-support-research.sql",
          sha256: "a".repeat(64),
        },
      ],
    ],
    [
      "the wrong filename",
      [
        {
          ...REQUIRED_DEVOTIONAL_MIGRATION,
          name: "001-renamed.sql",
        },
      ],
    ],
    [
      "the wrong checksum",
      [
        {
          ...REQUIRED_DEVOTIONAL_MIGRATION,
          sha256: "0".repeat(64),
        },
      ],
    ],
  ])("fails closed for %s", async (_label, migrations) => {
    await expect(
      getDevotionalSchemaReadiness(executorWithMigrations(migrations)),
    ).resolves.toEqual({
      ready: false,
      version: 0,
      reason: "required devotional migration 1 is unavailable",
    })
  })

  it("fails closed when the migration ledger cannot be queried", async () => {
    const query = vi.fn().mockRejectedValue(new Error("connection refused"))

    await expect(
      getDevotionalSchemaReadiness({
        query: query as unknown as QueryExecutor["query"],
      }),
    ).resolves.toEqual({
      ready: false,
      reason: "devotional workspace schema is unavailable",
    })
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
