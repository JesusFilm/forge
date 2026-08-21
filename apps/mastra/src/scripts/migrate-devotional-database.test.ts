import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  MIGRATION_POOL_TIMEOUTS,
  parseVersion,
  runDevotionalDatabaseMigrations,
  type MigrationClient,
} from "./migrate-devotional-database"
import { REQUIRED_DEVOTIONAL_MIGRATION } from "../services/devotional/workspace/database"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return {
    rows,
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }
}

function clientWithExisting(
  existingByVersion: Record<number, { name: string; sha256: string }> = {},
): MigrationClient & { calls: string[]; release: ReturnType<typeof vi.fn> } {
  const calls: string[] = []
  const release = vi.fn()
  return {
    calls,
    release,
    async query<T extends QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<T>> {
      calls.push(text)
      if (/select sha256, name/.test(text)) {
        const existing = existingByVersion[Number(values?.[0])]
        return result(existing ? [existing as unknown as T] : [])
      }
      return result<T>()
    },
  }
}

describe("devotional database migrator", () => {
  it("bounds connection acquisition and every migration query", () => {
    expect(MIGRATION_POOL_TIMEOUTS).toEqual({
      connectionTimeoutMillis: 15_000,
      query_timeout: 300_000,
      statement_timeout: 300_000,
    })
  })

  it("propagates connection acquisition failure without starting a transaction", async () => {
    const timeout = new Error("database connection timeout")
    await expect(
      runDevotionalDatabaseMigrations({
        pool: { connect: vi.fn().mockRejectedValue(timeout) },
      }),
    ).rejects.toBe(timeout)
  })

  it("rolls back and releases when the client-side timeout rejects BEGIN", async () => {
    const client = clientWithExisting()
    const timeout = new Error("database query timeout")
    vi.spyOn(client, "query").mockImplementation(async (text) => {
      client.calls.push(text)
      if (text === "begin") throw timeout
      return result()
    })

    await expect(
      runDevotionalDatabaseMigrations({
        pool: { connect: async () => client },
      }),
    ).rejects.toBe(timeout)

    expect(client.calls).toEqual(["begin", "rollback"])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it("applies each unapplied SQL migration under a transaction and lock", async () => {
    const client = clientWithExisting()
    const migration = await runDevotionalDatabaseMigrations({
      pool: { connect: async () => client },
    })

    expect(migration).toEqual({
      applied: [
        "001-devotional-workspace.sql",
        "002-support-research.sql",
        "003-datadog-triage.sql",
      ],
      skipped: [],
    })
    expect(client.calls[0]).toBe("begin")
    const statementTimeoutIndex = client.calls.indexOf(
      "set local statement_timeout = '300000ms'",
    )
    const lockTimeoutIndex = client.calls.indexOf(
      "set local lock_timeout = '15000ms'",
    )
    const advisoryLockIndex = client.calls.findIndex((sql) =>
      /pg_advisory_xact_lock/.test(sql),
    )
    expect(statementTimeoutIndex).toBe(1)
    expect(lockTimeoutIndex).toBe(2)
    expect(advisoryLockIndex).toBe(3)
    expect(client.calls.at(-1)).toBe("commit")
    expect(client.release).toHaveBeenCalledOnce()
  })

  it("rolls back and releases the client when the advisory lock times out", async () => {
    const client = clientWithExisting()
    const timeout = new Error("canceling statement due to lock timeout")
    const query = vi.spyOn(client, "query").mockImplementation(async (text) => {
      client.calls.push(text)
      if (/pg_advisory_xact_lock/.test(text)) throw timeout
      return result()
    })

    await expect(
      runDevotionalDatabaseMigrations({
        pool: { connect: async () => client },
      }),
    ).rejects.toBe(timeout)

    expect(query).toHaveBeenCalled()
    expect(client.calls).toEqual([
      "begin",
      "set local statement_timeout = '300000ms'",
      "set local lock_timeout = '15000ms'",
      "select pg_advisory_xact_lock(hashtext('forge_devotional_workspace_migrations'))",
      "rollback",
    ])
    expect(client.calls).not.toContain("commit")
    expect(client.release).toHaveBeenCalledOnce()
  })

  it("skips an identical applied migration and rejects checksum drift", async () => {
    const filenames = [
      "001-devotional-workspace.sql",
      "002-support-research.sql",
      "003-datadog-triage.sql",
    ] as const
    const existingEntries = Object.fromEntries(
      await Promise.all(
        filenames.map(async (filename, index) => {
          const sql = await readFile(
            resolve(DEFAULT_MIGRATIONS_DIRECTORY, filename),
            "utf8",
          )
          return [
            index + 1,
            {
              name: filename,
              sha256: createHash("sha256").update(sql).digest("hex"),
            },
          ]
        }),
      ),
    )
    const identical = clientWithExisting(existingEntries)

    await expect(
      runDevotionalDatabaseMigrations({
        pool: { connect: async () => identical },
      }),
    ).resolves.toEqual({ applied: [], skipped: filenames })

    const changed = clientWithExisting({
      1: {
        name: filenames[0],
        sha256: "0".repeat(64),
      },
    })
    await expect(
      runDevotionalDatabaseMigrations({
        pool: { connect: async () => changed },
      }),
    ).rejects.toThrow(/differs from the applied checksum/)
    expect(changed.calls).toContain("rollback")
    expect(changed.release).toHaveBeenCalledOnce()
  })

  it("accepts only version-prefixed SQL filenames", () => {
    expect(parseVersion("001-devotional-workspace.sql")).toBe(1)
    expect(() => parseVersion("devotional.sql")).toThrow(/invalid Mastra/)
  })

  it("pins readiness to the immutable devotional migration bytes", async () => {
    const sql = await readFile(
      resolve(DEFAULT_MIGRATIONS_DIRECTORY, REQUIRED_DEVOTIONAL_MIGRATION.name),
      "utf8",
    )

    expect(REQUIRED_DEVOTIONAL_MIGRATION).toEqual({
      version: 1,
      name: "001-devotional-workspace.sql",
      sha256: createHash("sha256").update(sql).digest("hex"),
    })
  })
})
