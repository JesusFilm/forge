import { describe, expect, it, vi } from "vitest"

import { compareFingerprints, readFingerprint } from "./fingerprint"
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
