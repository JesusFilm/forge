import { describe, expect, it, vi } from "vitest"

import {
  SearchEvalCandidateStoreError,
  archiveSearchEvalCandidate,
  listSearchEvalCandidates,
  promoteSearchEvalCandidate,
  rejectSearchEvalCandidate,
  storeSearchEvalCandidates,
} from "./candidates"

type StoredCandidateStub = {
  id: string
  promotionStatus: string
}

function buildPrisma() {
  return {
    searchEvalCandidate: {
      create: vi.fn(async (args) => ({
        id: "candidate-1",
        dedupeKey: args.data.dedupeKey,
      })),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findUnique: vi.fn(async (): Promise<StoredCandidateStub | null> => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  }
}

describe("storeSearchEvalCandidates", () => {
  it("stores generated candidates with source metadata and generated promotion status", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "catalog",
            locale: "en",
            queryText: " Jesus film for kids ",
            expectedResultHints: [
              {
                type: "video",
                id: "video-1",
                title: "JESUS",
                slug: "jesus",
              },
            ],
            sourceAnchors: [
              {
                type: "video",
                id: "video-locale-1",
                locale: "en",
              },
            ],
            labelProvenance: { source: "catalog-anchor" },
            generationModel: "openrouter:test-model",
            generationProvider: "openrouter",
            judgeSummary: { score: 0.92, rationale: "clear intent" },
            mastraRunId: "run-1",
          },
        ],
        now,
      ),
    ).resolves.toMatchObject({
      storedCount: 1,
      skippedCount: 0,
      candidates: [
        {
          id: "candidate-1",
          status: "created",
          dedupeKey: expect.any(String),
        },
      ],
    })

    expect(prisma.searchEvalCandidate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source: "CATALOG",
          locale: "en",
          queryText: "Jesus film for kids",
          expectedResultHints: [
            {
              type: "video",
              id: "video-1",
              title: "JESUS",
              slug: "jesus",
            },
          ],
          sourceAnchors: [
            {
              type: "video",
              id: "video-locale-1",
              locale: "en",
            },
          ],
          labelProvenance: { source: "catalog-anchor" },
          generationModel: "openrouter:test-model",
          generationProvider: "openrouter",
          judgeSummary: { score: 0.92, rationale: "clear intent" },
          promotionStatus: "GENERATED",
          mastraRunId: "run-1",
          retentionExpiresAt: null,
          generatedAt: now,
        }),
      }),
    )
  })

  it("updates duplicate generated candidates by deterministic dedupe key", async () => {
    const prisma = buildPrisma()
    prisma.searchEvalCandidate.findUnique.mockResolvedValueOnce({
      id: "existing",
      promotionStatus: "GENERATED",
    })

    const result = await storeSearchEvalCandidates(
      prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
      [
        {
          source: "locale_quality",
          locale: "fr",
          queryText: "espoir",
          sourceAnchors: [{ type: "locale", locale: "fr" }],
          generationModel: "openrouter:test-model",
        },
      ],
      new Date("2026-05-26T00:00:00.000Z"),
    )

    expect(result.candidates[0]?.status).toBe("updated")
    expect(prisma.searchEvalCandidate.updateMany).toHaveBeenCalledOnce()
    expect(prisma.searchEvalCandidate.create).not.toHaveBeenCalled()
  })

  it("does not overwrite a candidate promoted after the initial generated-status read", async () => {
    const prisma = buildPrisma()
    prisma.searchEvalCandidate.findUnique.mockResolvedValueOnce({
      id: "race",
      promotionStatus: "GENERATED",
    })
    prisma.searchEvalCandidate.updateMany.mockResolvedValueOnce({ count: 0 })

    const result = await storeSearchEvalCandidates(
      prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
      [
        {
          source: "catalog",
          locale: "en",
          queryText: "hope",
          generationModel: "openrouter:test-model",
        },
      ],
      new Date("2026-05-26T00:00:00.000Z"),
    )

    expect(result).toMatchObject({
      storedCount: 0,
      skippedCount: 1,
      skipped: [{ reason: "already_promoted_or_rejected" }],
    })
    expect(prisma.searchEvalCandidate.create).not.toHaveBeenCalled()
  })

  it("does not overwrite candidates that have already left generated status", async () => {
    const prisma = buildPrisma()
    prisma.searchEvalCandidate.findUnique.mockResolvedValueOnce({
      id: "promoted",
      promotionStatus: "PROMOTED",
    })

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "catalog",
            locale: "en",
            queryText: "hope",
            generationModel: "openrouter:test-model",
          },
        ],
        new Date("2026-05-26T00:00:00.000Z"),
      ),
    ).resolves.toMatchObject({
      storedCount: 0,
      skippedCount: 1,
      skipped: [
        {
          reason: "already_promoted_or_rejected",
        },
      ],
    })
    expect(prisma.searchEvalCandidate.create).not.toHaveBeenCalled()
    expect(prisma.searchEvalCandidate.updateMany).not.toHaveBeenCalled()
  })

  it("requires future retention expiry for trace-sourced candidates", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "trace",
            locale: "en",
            queryText: "jesus movie",
            generationModel: "trace-sample:v1",
          },
        ],
        now,
      ),
    ).rejects.toMatchObject({
      name: "SearchEvalCandidateStoreError",
      code: "validation",
    })

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "trace",
            locale: "en",
            queryText: "jesus movie",
            generationModel: "trace-sample:v1",
            retentionExpiresAt: "2026-05-25T00:00:00.000Z",
          },
        ],
        now,
      ),
    ).rejects.toBeInstanceOf(SearchEvalCandidateStoreError)
  })

  it("rejects trace retention expiry beyond the raw trace policy", async () => {
    const prisma = buildPrisma()

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "trace",
            locale: "en",
            queryText: "jesus movie",
            generationModel: "trace-sample:v1",
            retentionExpiresAt: "2026-06-27T00:00:00.000Z",
          },
        ],
        new Date("2026-05-26T00:00:00.000Z"),
      ),
    ).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("rejects trace-derived provenance when the submitted source is non-trace", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "catalog",
            locale: "en",
            queryText: "raw sampled trace query",
            sourceAnchors: [{ type: "trace", id: "trace-1" }],
            labelProvenance: {
              queryQualityLabel: "valid_viewer_intent",
              queryLabelSource: "rules",
            },
            generationModel: "admin-trace-sample:v1",
          },
        ],
        now,
      ),
    ).rejects.toMatchObject({
      code: "validation",
      message: "trace-derived candidates must use source trace",
    })
    expect(prisma.searchEvalCandidate.create).not.toHaveBeenCalled()
  })

  it("rejects unsafe locales, oversized batches, and non-array anchors", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "catalog",
            locale: "../en",
            queryText: "hope",
            generationModel: "model",
          },
        ],
        now,
      ),
    ).rejects.toMatchObject({ code: "validation" })

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        [
          {
            source: "catalog",
            locale: "en",
            queryText: "hope",
            sourceAnchors: { id: "not-an-array" },
            generationModel: "model",
          },
        ],
        now,
      ),
    ).rejects.toMatchObject({ code: "validation" })

    await expect(
      storeSearchEvalCandidates(
        prisma as unknown as Parameters<typeof storeSearchEvalCandidates>[0],
        Array.from({ length: 101 }, () => ({
          source: "catalog" as const,
          locale: "en",
          queryText: "hope",
          generationModel: "model",
        })),
        now,
      ),
    ).rejects.toMatchObject({ code: "validation" })
  })

  it("schema stores candidate provenance without auth, user, vector, or raw scoring columns", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const schemaPath = fileURLToPath(
      new URL("../../../prisma/schema.prisma", import.meta.url),
    )
    const schema = await readFile(schemaPath, "utf8")
    const model = schema.match(
      /model SearchEvalCandidate \{[\s\S]*?@@map\("search_eval_candidate"\)\n\}/,
    )?.[0]

    expect(model).toContain("sourceAnchors")
    expect(model).toContain("labelProvenance")
    expect(model).toContain("judgeSummary")
    expect(model).toContain("promotionStatus")
    expect(model).toContain("retentionExpiresAt")
    expect(model).not.toMatch(
      /bearer|cookie|ipAddress|ip_|userId|keyId|vector/i,
    )
  })
})

describe("listSearchEvalCandidates", () => {
  it("lists generated candidates with bounded filters and normalized response shape", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")
    prisma.searchEvalCandidate.findMany.mockResolvedValueOnce([
      {
        id: "candidate-1",
        source: "CATALOG",
        locale: "en",
        expectedResultHints: [],
        sourceAnchors: [{ type: "seed" }],
        labelProvenance: { source: "seed" },
        generationModel: "seed:v1",
        generationProvider: "mastra",
        judgeSummary: null,
        promotionStatus: "GENERATED",
        sanitizedQueryText: null,
        sanitizedExpectedResultNotes: null,
        sanitizedSourceAnchors: [],
        sanitizationStatus: "PENDING",
        reviewerIdentity: null,
        reviewedAt: null,
        reviewNotes: null,
        promotedAt: null,
        promotionRunContext: {},
        mastraRunId: "run-1",
        retentionExpiresAt: null,
        generatedAt: new Date("2026-05-26T00:00:00.000Z"),
        createdAt: new Date("2026-05-26T00:00:01.000Z"),
      },
    ])
    prisma.searchEvalCandidate.findMany.mockResolvedValueOnce([
      { id: "candidate-1", queryText: "Jesus" },
    ])

    await expect(
      listSearchEvalCandidates(
        prisma as unknown as Parameters<typeof listSearchEvalCandidates>[0],
        {
          sources: ["catalog"],
          locales: ["en"],
          mastraRunId: "run-1",
          limit: 10,
          now,
        },
      ),
    ).resolves.toEqual([
      {
        id: "candidate-1",
        source: "catalog",
        locale: "en",
        queryText: "Jesus",
        expectedResultHints: [],
        sourceAnchors: [{ type: "seed" }],
        labelProvenance: { source: "seed" },
        generationModel: "seed:v1",
        generationProvider: "mastra",
        judgeSummary: null,
        promotionStatus: "generated",
        sanitizedQueryText: null,
        sanitizedExpectedResultNotes: null,
        sanitizedSourceAnchors: [],
        sanitizationStatus: "pending",
        reviewerIdentity: null,
        reviewedAt: null,
        reviewNotes: null,
        promotedAt: null,
        promotionRunContext: {},
        mastraRunId: "run-1",
        retentionExpiresAt: null,
        generatedAt: "2026-05-26T00:00:00.000Z",
        createdAt: "2026-05-26T00:00:01.000Z",
      },
    ])

    expect(prisma.searchEvalCandidate.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          promotionStatus: { in: ["GENERATED"] },
          source: { in: ["CATALOG"] },
          locale: { in: ["en"] },
          mastraRunId: "run-1",
          OR: [
            { promotionStatus: "PROMOTED" },
            { source: { not: "TRACE" } },
            { retentionExpiresAt: { gt: now } },
          ],
        }),
        take: 10,
        select: expect.not.objectContaining({ queryText: true }),
      }),
    )
    expect(prisma.searchEvalCandidate.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: { in: ["candidate-1"] },
          source: { not: "TRACE" },
        },
        select: { id: true, queryText: true },
      }),
    )
  })

  it("excludes expired trace candidates at read time before purge runs and never reads trace query text", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")
    prisma.searchEvalCandidate.findMany.mockResolvedValueOnce([
      {
        id: "candidate-trace",
        source: "TRACE",
        promotionStatus: "GENERATED",
        locale: "en",
        expectedResultHints: ["raw trace query Jesus movie"],
        sourceAnchors: [
          {
            queryHash:
              "b54c7a2c2d7f75f6f139d885e9202f9ec5db932e8a2d17e0efba2a9f0c3d4e5f",
            text: "raw trace query Jesus movie",
          },
        ],
        labelProvenance: {
          rawQueryText: "raw trace query Jesus movie",
          publicQueryHash:
            "b54c7a2c2d7f75f6f139d885e9202f9ec5db932e8a2d17e0efba2a9f0c3d4e5f",
        },
        generationModel: "raw trace query Jesus movie",
        generationProvider: "raw trace query Jesus movie",
        judgeSummary: { rationale: "raw trace query Jesus movie" },
        mastraRunId: "raw trace query Jesus movie",
        retentionExpiresAt: new Date("2026-05-27T00:00:00.000Z"),
        sanitizedQueryText: null,
        sanitizedExpectedResultNotes: null,
        sanitizedSourceAnchors: [],
        sanitizationStatus: "PENDING",
        reviewerIdentity: null,
        reviewedAt: null,
        reviewNotes: null,
        promotedAt: null,
        promotionRunContext: {},
        generatedAt: new Date("2026-05-26T00:00:00.000Z"),
        createdAt: new Date("2026-05-26T00:00:01.000Z"),
      },
    ])

    const candidates = await listSearchEvalCandidates(
      prisma as unknown as Parameters<typeof listSearchEvalCandidates>[0],
      { sources: ["trace"], now },
    )

    expect(candidates).toEqual([
      expect.objectContaining({
        id: "candidate-trace",
        source: "trace",
        queryText: null,
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: { source: "trace", redacted: true },
        generationModel: "trace:redacted",
        generationProvider: null,
        judgeSummary: null,
        mastraRunId: null,
      }),
    ])
    expect(JSON.stringify(candidates)).not.toContain("raw trace query")
    expect(JSON.stringify(candidates)).not.toContain(
      "b54c7a2c2d7f75f6f139d885e9202f9ec5db932e8a2d17e0efba2a9f0c3d4e5f",
    )

    expect(prisma.searchEvalCandidate.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          source: { in: ["TRACE"] },
          OR: [
            { promotionStatus: "PROMOTED" },
            { source: { not: "TRACE" } },
            { retentionExpiresAt: { gt: now } },
          ],
        }),
        select: expect.not.objectContaining({ queryText: true }),
      }),
    )
    expect(prisma.searchEvalCandidate.findMany).toHaveBeenCalledTimes(1)
  })

  it("redacts legacy non-trace rows with trace provenance markers before reading query text", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")
    prisma.searchEvalCandidate.findMany.mockResolvedValueOnce([
      {
        id: "legacy-candidate",
        source: "CATALOG",
        promotionStatus: "GENERATED",
        locale: "en",
        expectedResultHints: ["raw trace query Jesus movie"],
        sourceAnchors: [{ type: "trace", id: "trace-1" }],
        labelProvenance: {
          queryQualityLabel: "valid_viewer_intent",
          rawQueryText: "raw trace query Jesus movie",
        },
        generationModel: "admin-trace-sample:v1",
        generationProvider: "raw trace query Jesus movie",
        judgeSummary: { rationale: "raw trace query Jesus movie" },
        mastraRunId: "raw trace query Jesus movie",
        retentionExpiresAt: null,
        sanitizedQueryText: null,
        sanitizedExpectedResultNotes: null,
        sanitizedSourceAnchors: [],
        sanitizationStatus: "PENDING",
        reviewerIdentity: null,
        reviewedAt: null,
        reviewNotes: null,
        promotedAt: null,
        promotionRunContext: {},
        generatedAt: new Date("2026-05-26T00:00:00.000Z"),
        createdAt: new Date("2026-05-26T00:00:01.000Z"),
      },
    ])

    const candidates = await listSearchEvalCandidates(
      prisma as unknown as Parameters<typeof listSearchEvalCandidates>[0],
      { sources: ["catalog"], now },
    )

    expect(candidates).toEqual([
      expect.objectContaining({
        id: "legacy-candidate",
        source: "trace",
        queryText: null,
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: { source: "trace", redacted: true },
        generationModel: "trace:redacted",
        generationProvider: null,
        judgeSummary: null,
        mastraRunId: null,
      }),
    ])
    expect(JSON.stringify(candidates)).not.toContain("raw trace query")
    expect(prisma.searchEvalCandidate.findMany).toHaveBeenCalledTimes(1)
  })

  it("keeps expired trace candidates out of the list query before purge runs", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T00:00:00.000Z")

    await listSearchEvalCandidates(
      prisma as unknown as Parameters<typeof listSearchEvalCandidates>[0],
      { sources: ["trace"], now },
    )

    expect(prisma.searchEvalCandidate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          source: { in: ["TRACE"] },
          OR: [
            { promotionStatus: "PROMOTED" },
            { source: { not: "TRACE" } },
            { retentionExpiresAt: { gt: now } },
          ],
        }),
      }),
    )
  })

  it("rejects invalid list filters", async () => {
    const prisma = buildPrisma()

    await expect(
      listSearchEvalCandidates(
        prisma as unknown as Parameters<typeof listSearchEvalCandidates>[0],
        { limit: 101 },
      ),
    ).rejects.toMatchObject({ code: "validation" })

    await expect(
      listSearchEvalCandidates(
        prisma as unknown as Parameters<typeof listSearchEvalCandidates>[0],
        { locales: ["../en"] },
      ),
    ).rejects.toMatchObject({ code: "validation" })
  })
})

describe("review state transitions", () => {
  it("promotes a pending candidate with sanitized truth and overwrites raw query text", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-28T00:00:00.000Z")
    prisma.searchEvalCandidate.findMany
      .mockResolvedValueOnce([
        {
          id: "candidate-1",
          source: "TRACE",
          promotionStatus: "GENERATED",
          locale: "en",
          expectedResultHints: ["raw trace query"],
          sourceAnchors: [{ type: "trace", text: "raw trace query" }],
          labelProvenance: { rawQueryText: "raw trace query" },
          generationModel: "admin-trace-sample:v1",
          generationProvider: "mastra",
          judgeSummary: { rationale: "raw trace query" },
          sanitizedQueryText: "Who is Jesus?",
          sanitizedExpectedResultNotes: "Should surface Jesus overview content",
          sanitizedSourceAnchors: [{ type: "video", id: "video-1" }],
          sanitizationStatus: "SANITIZED",
          reviewerIdentity: "nisal",
          reviewedAt: now,
          reviewNotes: "safe",
          promotedAt: null,
          promotionRunContext: { reportId: "report-1" },
          mastraRunId: "run-1",
          retentionExpiresAt: new Date("2026-06-01T00:00:00.000Z"),
          generatedAt: new Date("2026-05-26T00:00:00.000Z"),
          createdAt: new Date("2026-05-26T00:00:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "candidate-1",
          source: "TRACE",
          promotionStatus: "PROMOTED",
          locale: "en",
          expectedResultHints: ["raw trace query"],
          sourceAnchors: [{ type: "trace", text: "raw trace query" }],
          labelProvenance: { rawQueryText: "raw trace query" },
          generationModel: "admin-trace-sample:v1",
          generationProvider: "mastra",
          judgeSummary: { rationale: "raw trace query" },
          sanitizedQueryText: "Who is Jesus?",
          sanitizedExpectedResultNotes: "Should surface Jesus overview content",
          sanitizedSourceAnchors: [{ type: "video", id: "video-1" }],
          sanitizationStatus: "SANITIZED",
          reviewerIdentity: "nisal",
          reviewedAt: now,
          reviewNotes: "safe",
          promotedAt: now,
          promotionRunContext: { reportId: "report-1" },
          mastraRunId: "run-1",
          retentionExpiresAt: new Date("2026-06-01T00:00:00.000Z"),
          generatedAt: new Date("2026-05-26T00:00:00.000Z"),
          createdAt: new Date("2026-05-26T00:00:00.000Z"),
        },
      ])

    const promoted = await promoteSearchEvalCandidate(
      prisma as unknown as Parameters<typeof promoteSearchEvalCandidate>[0],
      "candidate-1",
      {
        reviewerIdentity: "nisal",
        sanitizedQueryText: "Who is Jesus?",
        sanitizedExpectedResultNotes: "Should surface Jesus overview content",
        sanitizedSourceAnchors: [{ type: "video", id: "video-1" }],
        promotionRunContext: { reportId: "report-1" },
      },
      now,
    )

    expect(prisma.searchEvalCandidate.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promotionStatus: "PROMOTED",
          queryText: "Who is Jesus?",
          sanitizedQueryText: "Who is Jesus?",
          sanitizationStatus: "SANITIZED",
          reviewerIdentity: "nisal",
          reviewedAt: now,
          promotedAt: now,
        }),
      }),
    )
    expect(promoted).toMatchObject({
      id: "candidate-1",
      promotionStatus: "promoted",
      queryText: "Who is Jesus?",
      sourceAnchors: [{ type: "video", id: "video-1" }],
    })
    expect(JSON.stringify(promoted)).not.toContain("raw trace query")
  })

  it("rejects and archives only pending candidates with reviewer identity", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-28T00:00:00.000Z")
    prisma.searchEvalCandidate.findMany.mockResolvedValue([
      {
        id: "candidate-1",
        source: "CATALOG",
        promotionStatus: "REJECTED",
        locale: "en",
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: {},
        generationModel: "seed:v1",
        generationProvider: "mastra",
        judgeSummary: null,
        sanitizedQueryText: null,
        sanitizedExpectedResultNotes: null,
        sanitizedSourceAnchors: [],
        sanitizationStatus: "UNSAFE",
        reviewerIdentity: "nisal",
        reviewedAt: now,
        reviewNotes: "ambiguous",
        promotedAt: null,
        promotionRunContext: {},
        mastraRunId: "run-1",
        retentionExpiresAt: null,
        generatedAt: now,
        createdAt: now,
      },
    ])

    await rejectSearchEvalCandidate(
      prisma as unknown as Parameters<typeof rejectSearchEvalCandidate>[0],
      "candidate-1",
      { reviewerIdentity: "nisal", reviewNotes: "ambiguous" },
      now,
    )
    await archiveSearchEvalCandidate(
      prisma as unknown as Parameters<typeof archiveSearchEvalCandidate>[0],
      "candidate-1",
      { reviewerIdentity: "nisal", reviewNotes: "duplicate" },
      now,
    )

    expect(prisma.searchEvalCandidate.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ promotionStatus: "GENERATED" }),
        data: expect.objectContaining({
          promotionStatus: "REJECTED",
          sanitizationStatus: "UNSAFE",
          reviewerIdentity: "nisal",
          reviewedAt: now,
        }),
      }),
    )
    expect(prisma.searchEvalCandidate.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({ promotionStatus: "ARCHIVED" }),
      }),
    )
  })
})
