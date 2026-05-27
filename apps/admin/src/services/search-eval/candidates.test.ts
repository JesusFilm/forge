import { describe, expect, it, vi } from "vitest"

import {
  SearchEvalCandidateStoreError,
  storeSearchEvalCandidates,
} from "./candidates"

type StoredCandidateStub = {
  id: string
  promotionStatus: string
}

function buildPrisma() {
  return {
    searchEvalCandidate: {
      findUnique: vi.fn(async (): Promise<StoredCandidateStub | null> => null),
      upsert: vi.fn(async (args) => ({
        id: "candidate-1",
        dedupeKey: args.create.dedupeKey,
      })),
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

    expect(prisma.searchEvalCandidate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
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
    expect(prisma.searchEvalCandidate.upsert).toHaveBeenCalledOnce()
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
    expect(prisma.searchEvalCandidate.upsert).not.toHaveBeenCalled()
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
