import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import type { QueryResult, QueryResultRow } from "pg"
import { describe, expect, it, vi } from "vitest"

import { DEFAULT_MIGRATIONS_DIRECTORY } from "../../scripts/migrate-mastra-database"
import {
  getSupportResearchDatabaseReadiness,
  REQUIRED_SUPPORT_RESEARCH_INDEXES,
  REQUIRED_SUPPORT_RESEARCH_MIGRATION,
  REQUIRED_SUPPORT_RESEARCH_TABLES,
  type SupportResearchDatabase,
} from "./database-readiness"

function result<T extends QueryResultRow>(rows: T[] = []): QueryResult<T> {
  return {
    rows,
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
  }
}

describe("support research database readiness", () => {
  it("requires the exact migration identity and every component relation", async () => {
    expect(REQUIRED_SUPPORT_RESEARCH_TABLES).toHaveLength(6)
    expect(REQUIRED_SUPPORT_RESEARCH_INDEXES).toHaveLength(6)

    const query = vi
      .fn()
      .mockResolvedValueOnce(
        result([{ version: REQUIRED_SUPPORT_RESEARCH_MIGRATION.version }]),
      )
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([]))

    await expect(
      getSupportResearchDatabaseReadiness({
        query: query as unknown as SupportResearchDatabase["query"],
      }),
    ).resolves.toEqual({ ready: true, version: 2 })
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [
      REQUIRED_SUPPORT_RESEARCH_MIGRATION.version,
      REQUIRED_SUPPORT_RESEARCH_MIGRATION.name,
      REQUIRED_SUPPORT_RESEARCH_MIGRATION.sha256,
    ])
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [
      REQUIRED_SUPPORT_RESEARCH_TABLES,
    ])
    expect(query).toHaveBeenNthCalledWith(3, expect.any(String), [
      REQUIRED_SUPPORT_RESEARCH_INDEXES,
    ])
    expect(query.mock.calls[1]?.[0]).toContain("relation.relkind <> 'r'")
    expect(query.mock.calls[2]?.[0]).toContain("relation.relkind <> 'i'")
    expect(query.mock.calls[2]?.[0]).toContain("index_metadata.indisvalid")
  })

  it("fails closed for missing history and partial schema objects", async () => {
    await expect(
      getSupportResearchDatabaseReadiness({
        query: vi.fn(async () => result([])),
      }),
    ).resolves.toEqual({
      ready: false,
      version: 0,
      reason: "required support research migration 2 is unavailable",
    })

    const query = vi
      .fn()
      .mockResolvedValueOnce(result([{ version: 2 }]))
      .mockResolvedValueOnce(result([{ relation: "support_research.cursors" }]))
      .mockResolvedValueOnce(
        result([
          {
            relation: "support_research.support_research_reports_expiry_idx",
          },
        ]),
      )
    await expect(
      getSupportResearchDatabaseReadiness({
        query: query as unknown as SupportResearchDatabase["query"],
      }),
    ).resolves.toEqual({
      ready: false,
      version: 2,
      reason: "support research schema is incomplete",
      missingRelations: [
        "support_research.cursors",
        "support_research.support_research_reports_expiry_idx",
      ],
    })
  })

  it("rejects a required table with the wrong relation kind", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([{ version: 2 }]))
      .mockResolvedValueOnce(result([{ relation: "support_research.cursors" }]))
      .mockResolvedValueOnce(result([]))

    await expect(
      getSupportResearchDatabaseReadiness({
        query: query as unknown as SupportResearchDatabase["query"],
      }),
    ).resolves.toEqual({
      ready: false,
      version: 2,
      reason: "support research schema is incomplete",
      missingRelations: ["support_research.cursors"],
    })
    expect(query.mock.calls[1]?.[0]).toContain("relation.relkind <> 'r'")
  })

  it("rejects an invalid required index", async () => {
    const index =
      "support_research.support_research_actions_live_fingerprint_idx"
    const query = vi
      .fn()
      .mockResolvedValueOnce(result([{ version: 2 }]))
      .mockResolvedValueOnce(result([]))
      .mockResolvedValueOnce(result([{ relation: index }]))

    await expect(
      getSupportResearchDatabaseReadiness({
        query: query as unknown as SupportResearchDatabase["query"],
      }),
    ).resolves.toEqual({
      ready: false,
      version: 2,
      reason: "support research schema is incomplete",
      missingRelations: [index],
    })
    expect(query.mock.calls[2]?.[0]).toContain("relation.relkind <> 'i'")
    expect(query.mock.calls[2]?.[0]).toContain("index_metadata.indisvalid")
  })

  it("pins the readiness checksum to the immutable migration bytes", async () => {
    const sql = await readFile(
      resolve(
        DEFAULT_MIGRATIONS_DIRECTORY,
        REQUIRED_SUPPORT_RESEARCH_MIGRATION.name,
      ),
      "utf8",
    )

    expect(REQUIRED_SUPPORT_RESEARCH_MIGRATION.sha256).toBe(
      createHash("sha256").update(sql).digest("hex"),
    )
  })

  it("does not expose a database error through its failure result", async () => {
    const readiness = await getSupportResearchDatabaseReadiness({
      query: vi
        .fn()
        .mockRejectedValue(
          new Error("postgresql://operator:secret@example.test/production"),
        ),
    })

    expect(readiness).toEqual({
      ready: false,
      reason: "support research database schema is unavailable",
    })
    expect(JSON.stringify(readiness)).not.toContain("postgresql://")
    expect(JSON.stringify(readiness)).not.toContain("secret")
  })
})
