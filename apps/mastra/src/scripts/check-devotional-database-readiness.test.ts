import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it, vi } from "vitest"

import {
  REQUIRED_DEVOTIONAL_MIGRATION,
  type QueryExecutor,
} from "../services/devotional/workspace/database"
import { runDevotionalDatabaseReadinessCli } from "./check-devotional-database-readiness"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return {
    rows,
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }
}

describe("devotional database readiness CLI", () => {
  it("reports the shared readiness result and exits successfully", async () => {
    const stdout = vi.fn()
    const query = vi.fn(async () =>
      result([{ version: REQUIRED_DEVOTIONAL_MIGRATION.version }]),
    )

    await expect(
      runDevotionalDatabaseReadinessCli({
        database: { query: query as unknown as QueryExecutor["query"] },
        stdout,
      }),
    ).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith('{"ready":true,"version":1}\n')
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      REQUIRED_DEVOTIONAL_MIGRATION.version,
      REQUIRED_DEVOTIONAL_MIGRATION.name,
      REQUIRED_DEVOTIONAL_MIGRATION.sha256,
    ])
  })

  it("reports a safe query-timeout failure and exits nonzero without exposing connection data", async () => {
    const stdout = vi.fn()
    const query = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "canceling statement due to statement timeout postgresql://operator:secret@example.test/db",
        ),
      )

    await expect(
      runDevotionalDatabaseReadinessCli({
        database: { query },
        stdout,
      }),
    ).resolves.toBe(1)
    const output = stdout.mock.calls[0]?.[0] as string
    expect(JSON.parse(output)).toEqual({
      ready: false,
      reason: "devotional workspace schema is unavailable",
    })
    expect(output).not.toContain("postgresql://")
    expect(output).not.toContain("secret")
    expect(output).not.toContain("statement timeout")
  })
})
