import { describe, expect, it, vi } from "vitest"

import {
  compareFingerprints,
  readFingerprint,
  readSearchTraceAggregateFingerprint,
} from "./fingerprint"
import type { Fingerprint } from "./types"

function buildPrismaStub(rows: unknown[]) {
  const $queryRaw = vi.fn().mockResolvedValue(rows)
  return { $queryRaw } as unknown as Parameters<typeof readFingerprint>[0]
}

describe("readFingerprint", () => {
  it("parses bigint counts and ISO timestamps", async () => {
    const prisma = buildPrismaStub([
      {
        scene_count: 512n,
        scene_max_updated_at: new Date("2026-05-01T10:00:00Z"),
        transcript_count: 1024n,
        transcript_max_updated_at: new Date("2026-05-01T11:00:00Z"),
        experience_count: 50n,
        experience_max_updated_at: new Date("2026-05-01T12:00:00Z"),
      },
    ])

    const fp = await readFingerprint(prisma)

    expect(fp).toEqual({
      sceneEmbeddings: {
        count: 512,
        maxUpdatedAt: "2026-05-01T10:00:00.000Z",
      },
      transcriptEmbeddings: {
        count: 1024,
        maxUpdatedAt: "2026-05-01T11:00:00.000Z",
      },
      experiences: {
        count: 50,
        maxUpdatedAt: "2026-05-01T12:00:00.000Z",
      },
    } satisfies Fingerprint)
  })

  it("returns zero-counts and null timestamps for empty tables", async () => {
    const prisma = buildPrismaStub([
      {
        scene_count: 0n,
        scene_max_updated_at: null,
        transcript_count: 0n,
        transcript_max_updated_at: null,
        experience_count: 0n,
        experience_max_updated_at: null,
      },
    ])

    const fp = await readFingerprint(prisma)
    expect(fp.sceneEmbeddings.count).toBe(0)
    expect(fp.sceneEmbeddings.maxUpdatedAt).toBeNull()
    expect(fp.experiences.count).toBe(0)
    expect(fp.experiences.maxUpdatedAt).toBeNull()
  })

  it("issues a single SQL query (round-trip discipline)", async () => {
    const prisma = buildPrismaStub([
      {
        scene_count: 1n,
        scene_max_updated_at: null,
        transcript_count: 0n,
        transcript_max_updated_at: null,
        experience_count: 0n,
        experience_max_updated_at: null,
      },
    ])
    await readFingerprint(prisma)

    expect(
      (prisma as unknown as { $queryRaw: { mock: { calls: unknown[] } } })
        .$queryRaw.mock.calls,
    ).toHaveLength(1)
  })

  it("SQL invariant: every count gates on `embedding IS NOT NULL`, experiences also gate on status='published'", async () => {
    // Per `docs/solutions/best-practices/prisma-raw-sql-invariant-assertions-20260423.md`,
    // raw SQL clauses that the search service depends on must be
    // pinned by a test that reads the joined template-strings array.
    // This is the canary that catches a refactor accidentally dropping
    // the embedding-non-null gate or the published-only gate.
    const prisma = buildPrismaStub([
      {
        scene_count: 0n,
        scene_max_updated_at: null,
        transcript_count: 0n,
        transcript_max_updated_at: null,
        experience_count: 0n,
        experience_max_updated_at: null,
      },
    ])
    await readFingerprint(prisma)

    const queryRaw = prisma as unknown as {
      $queryRaw: { mock: { calls: [TemplateStringsArray, ...unknown[]][] } }
    }
    const sql = queryRaw.$queryRaw.mock.calls[0]?.[0]?.join(" ") ?? ""

    expect((sql.match(/embedding IS NOT NULL/g) ?? []).length).toBe(6)
    expect(sql).toMatch(/experience_locale[\s\S]*status\s*=\s*'published'/)
    expect(sql).toMatch(
      /experience_locale[\s\S]*status\s*=\s*'published'[\s\S]*experience_locale/,
    )
  })

  it("filters scene + transcript by `embedding IS NOT NULL`", async () => {
    const prisma = buildPrismaStub([
      {
        scene_count: 1n,
        scene_max_updated_at: null,
        transcript_count: 0n,
        transcript_max_updated_at: null,
        experience_count: 0n,
        experience_max_updated_at: null,
      },
    ])
    await readFingerprint(prisma)

    // Inspect the tagged-template strings the query was assembled from.
    const queryRaw = prisma as unknown as {
      $queryRaw: { mock: { calls: [TemplateStringsArray, ...unknown[]][] } }
    }
    const sqlChunks = queryRaw.$queryRaw.mock.calls[0]?.[0]?.join("") ?? ""

    expect(sqlChunks).toContain("video_scene_locale")
    expect(sqlChunks).toContain("video_transcript_chunk")
    expect(sqlChunks).toContain("experience_locale")
    expect(sqlChunks).toContain("embedding IS NOT NULL")
  })

  it("gates experience count on status='published'", async () => {
    const prisma = buildPrismaStub([
      {
        scene_count: 0n,
        scene_max_updated_at: null,
        transcript_count: 0n,
        transcript_max_updated_at: null,
        experience_count: 0n,
        experience_max_updated_at: null,
      },
    ])
    await readFingerprint(prisma)

    const queryRaw = prisma as unknown as {
      $queryRaw: { mock: { calls: [TemplateStringsArray, ...unknown[]][] } }
    }
    const sqlChunks = queryRaw.$queryRaw.mock.calls[0]?.[0]?.join("") ?? ""

    expect(sqlChunks).toContain("status = 'published'")
  })
})

describe("readSearchTraceAggregateFingerprint", () => {
  it("reads aggregate counters without changing the content fingerprint shape", async () => {
    const prisma = buildPrismaStub([
      {
        aggregate_count: 5n,
        aggregate_max_updated_at: new Date("2026-05-25T00:00:00Z"),
        query_count_sum: 120n,
        result_count_sum: 350n,
      },
    ])

    await expect(readSearchTraceAggregateFingerprint(prisma)).resolves.toEqual({
      aggregateRows: {
        count: 5,
        maxUpdatedAt: "2026-05-25T00:00:00.000Z",
      },
      queryCountSum: 120,
      resultCountSum: 350,
    })
  })

  it("uses search_trace_aggregate only and never reads raw query text", async () => {
    const prisma = buildPrismaStub([
      {
        aggregate_count: 0n,
        aggregate_max_updated_at: null,
        query_count_sum: 0n,
        result_count_sum: 0n,
      },
    ])
    await readSearchTraceAggregateFingerprint(prisma)

    const queryRaw = prisma as unknown as {
      $queryRaw: { mock: { calls: [TemplateStringsArray, ...unknown[]][] } }
    }
    const sql = queryRaw.$queryRaw.mock.calls[0]?.[0]?.join(" ") ?? ""

    expect(sql).toContain("search_trace_aggregate")
    expect(sql).not.toMatch(/query_text|queryText|search_trace\s/i)
  })

  it("does not add trace fields to the existing baseline Fingerprint type", async () => {
    const prisma = buildPrismaStub([
      {
        scene_count: 0n,
        scene_max_updated_at: null,
        transcript_count: 0n,
        transcript_max_updated_at: null,
        experience_count: 0n,
        experience_max_updated_at: null,
      },
    ])

    const fp = await readFingerprint(prisma)
    expect(Object.keys(fp).sort()).toEqual([
      "experiences",
      "sceneEmbeddings",
      "transcriptEmbeddings",
    ])
  })
})

describe("compareFingerprints", () => {
  const baseline: Fingerprint = {
    sceneEmbeddings: {
      count: 100,
      maxUpdatedAt: "2026-05-01T00:00:00.000Z",
    },
    transcriptEmbeddings: {
      count: 200,
      maxUpdatedAt: "2026-05-01T00:00:00.000Z",
    },
    experiences: {
      count: 10,
      maxUpdatedAt: "2026-05-01T00:00:00.000Z",
    },
  }

  it("reports no drift when fingerprints are identical", () => {
    expect(compareFingerprints(baseline, baseline)).toEqual({
      detected: false,
      details: "no drift since baseline",
    })
  })

  it("detects row-count delta and surfaces it in details", () => {
    const current: Fingerprint = {
      ...baseline,
      sceneEmbeddings: { ...baseline.sceneEmbeddings, count: 612 },
    }
    const result = compareFingerprints(baseline, current)
    expect(result.detected).toBe(true)
    expect(result.details).toContain("scene+512")
  })

  it("detects negative deltas (rows removed) with a minus sign", () => {
    const current: Fingerprint = {
      ...baseline,
      sceneEmbeddings: { ...baseline.sceneEmbeddings, count: 50 },
    }
    const result = compareFingerprints(baseline, current)
    expect(result.details).toContain("scene-50")
  })

  it("detects time drift and reports days", () => {
    const current: Fingerprint = {
      ...baseline,
      sceneEmbeddings: {
        ...baseline.sceneEmbeddings,
        maxUpdatedAt: "2026-05-04T00:00:00.000Z",
      },
    }
    const result = compareFingerprints(baseline, current)
    expect(result.detected).toBe(true)
    expect(result.details).toContain("+3d")
  })

  it("detects time drift and reports hours under one day", () => {
    const current: Fingerprint = {
      ...baseline,
      sceneEmbeddings: {
        ...baseline.sceneEmbeddings,
        maxUpdatedAt: "2026-05-01T05:00:00.000Z",
      },
    }
    const result = compareFingerprints(baseline, current)
    expect(result.details).toContain("+5h")
  })

  it("detects multi-table drift in a single details line", () => {
    const current: Fingerprint = {
      sceneEmbeddings: {
        count: 612,
        maxUpdatedAt: "2026-05-04T00:00:00.000Z",
      },
      transcriptEmbeddings: {
        count: 1224,
        maxUpdatedAt: "2026-05-04T00:00:00.000Z",
      },
      experiences: {
        count: 10,
        maxUpdatedAt: "2026-05-01T00:00:00.000Z",
      },
    }
    const result = compareFingerprints(baseline, current)
    expect(result.details).toContain("scene+512")
    expect(result.details).toContain("transcript+1024")
  })
})
