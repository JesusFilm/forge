import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it, vi } from "vitest"

import {
  REQUIRED_SUPPORT_RESEARCH_MIGRATION,
  type SupportResearchDatabase,
} from "../services/support-research/database-readiness"
import { runSupportResearchDatabaseReadinessCli } from "./check-support-research-database-readiness"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return {
    rows,
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }
}

describe("support research database readiness CLI", () => {
  it("reports readiness without connection details", async () => {
    const stdout = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce(
        result([{ version: REQUIRED_SUPPORT_RESEARCH_MIGRATION.version }]),
      )
      .mockResolvedValueOnce(result([]))

    await expect(
      runSupportResearchDatabaseReadinessCli({
        database: {
          query: query as unknown as SupportResearchDatabase["query"],
        },
        stdout,
      }),
    ).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith('{"ready":true,"version":2}\n')
  })

  it("returns a safe nonzero result for unavailable schema", async () => {
    const stdout = vi.fn()

    await expect(
      runSupportResearchDatabaseReadinessCli({
        database: {
          query: vi
            .fn()
            .mockRejectedValue(
              new Error("postgresql://operator:secret@example.test/production"),
            ),
        },
        stdout,
      }),
    ).resolves.toBe(1)
    const output = stdout.mock.calls[0]?.[0] as string
    expect(JSON.parse(output)).toEqual({
      ready: false,
      reason: "support research database schema is unavailable",
    })
    expect(output).not.toContain("postgresql://")
    expect(output).not.toContain("secret")
  })
})
