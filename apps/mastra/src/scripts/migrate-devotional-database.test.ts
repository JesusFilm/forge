import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it, vi } from "vitest"

import {
  DEFAULT_MIGRATIONS_DIRECTORY,
  parseVersion,
  runDevotionalDatabaseMigrations,
  type MigrationClient,
} from "./migrate-devotional-database"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return {
    rows,
    command: "",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }
}

function clientWithExisting(existing?: {
  name: string
  sha256: string
}): MigrationClient & { calls: string[]; release: ReturnType<typeof vi.fn> } {
  const calls: string[] = []
  const release = vi.fn()
  return {
    calls,
    release,
    async query<T extends QueryResultRow>(
      text: string,
    ): Promise<QueryResult<T>> {
      calls.push(text)
      if (/select sha256, name/.test(text)) {
        return result(existing ? [existing as unknown as T] : [])
      }
      return result<T>()
    },
  }
}

describe("devotional database migrator", () => {
  it("applies each unapplied SQL migration under a transaction and lock", async () => {
    const client = clientWithExisting()
    const migration = await runDevotionalDatabaseMigrations({
      pool: { connect: async () => client },
    })

    expect(migration).toEqual({
      applied: ["001-devotional-workspace.sql"],
      skipped: [],
    })
    expect(client.calls[0]).toBe("begin")
    expect(client.calls.some((sql) => /pg_advisory_xact_lock/.test(sql))).toBe(
      true,
    )
    expect(client.calls.at(-1)).toBe("commit")
    expect(client.release).toHaveBeenCalledOnce()
  })

  it("skips an identical applied migration and rejects checksum drift", async () => {
    const filename = "001-devotional-workspace.sql"
    const sql = await readFile(
      resolve(DEFAULT_MIGRATIONS_DIRECTORY, filename),
      "utf8",
    )
    const sha256 = createHash("sha256").update(sql).digest("hex")
    const identical = clientWithExisting({ name: filename, sha256 })

    await expect(
      runDevotionalDatabaseMigrations({
        pool: { connect: async () => identical },
      }),
    ).resolves.toEqual({ applied: [], skipped: [filename] })

    const changed = clientWithExisting({
      name: filename,
      sha256: "0".repeat(64),
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
    expect(() => parseVersion("devotional.sql")).toThrow(/invalid devotional/)
  })
})
