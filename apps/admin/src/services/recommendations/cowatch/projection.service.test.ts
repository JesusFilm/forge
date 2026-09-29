import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import {
  parseCowatchPublicationAdmission,
  preflightCowatchShadowGeneration,
  publishCowatchShadowGeneration,
} from "./projection.service"

const NOW = new Date("2026-09-30T00:00:00.000Z")
const scope = {
  version: "episode-event-window-v1" as const,
  windowStart: new Date("2026-09-22T00:00:00.000Z"),
  windowEnd: new Date("2026-09-29T00:00:00.000Z"),
  evaluationAsOf: new Date("2026-09-29T00:00:00.000Z"),
}

function fixture() {
  const sources = [0, 1, 2].map((index) => ({
    outcomeId: `outcome-${index}`,
    episodeId: `episode-${index}`,
    revision: 1,
    mediaId: `media-${index}`,
    sessionDigest: "a".repeat(64),
    profileId: null,
    privacyGeneration: null,
    occurredAt: new Date(scope.windowStart.getTime() + index * 1000),
    qualityWeight: 1,
    qualified: true,
    finalized: true,
    integrityEligible: true,
    eligibilityDecisionId: `decision-${index}`,
    eligibilityRevision: 1,
    eligibilityPolicyVersion: "recommendation-integrity-v1",
    expiresAt: new Date("2026-10-15T00:00:00.000Z"),
  }))
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi
      .fn()
      .mockImplementation((query: { sql: string } | string[]) =>
        Promise.resolve(
          (Array.isArray(query) ? query.join("") : query.sql).includes(
            "pg_try_advisory_xact_lock",
          )
            ? [{ locked: true }]
            : sources,
        ),
      ),
    recommendationCowatchGeneration: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
    },
    recommendationCowatchSourceContribution: { createMany: vi.fn() },
    recommendationCowatchContribution: { createMany: vi.fn() },
    recommendationCowatchEdge: { createMany: vi.fn() },
  }
  const transaction = vi.fn(async (run: (client: typeof tx) => unknown) =>
    run(tx),
  )
  const db = { $transaction: transaction } as unknown as PrismaClient
  async function admission() {
    const preflight = await preflightCowatchShadowGeneration(db, NOW, scope)
    return parseCowatchPublicationAdmission(
      {
        version: "cowatch-publication-admission-v1",
        expectedGeneration: preflight.generation,
        sourceWindow: JSON.parse(JSON.stringify(scope)),
        limits: {
          rawSourceCount: preflight.rawSourceCount,
          sourceCount: preflight.sourceCount,
          attemptedPairCount: preflight.attemptedPairCount,
          contributionCount: preflight.contributionCount,
          edgeCount: preflight.edgeCount,
          publicationRowCount: preflight.publicationRowCount,
          graphRowJsonBytes: preflight.graphRowJsonBytes,
        },
      },
      NOW,
      scope,
    )
  }
  function expectNoWrites() {
    expect(tx.recommendationCowatchGeneration.create).not.toHaveBeenCalled()
    expect(
      tx.recommendationCowatchSourceContribution.createMany,
    ).not.toHaveBeenCalled()
    expect(
      tx.recommendationCowatchContribution.createMany,
    ).not.toHaveBeenCalled()
    expect(tx.recommendationCowatchEdge.createMany).not.toHaveBeenCalled()
  }
  return { db, tx, transaction, sources, admission, expectNoWrites }
}

describe("co-watch transactional publication admission", () => {
  it("accepts exact ceiling equality without changing transaction or batch bounds", async () => {
    const test = fixture()
    const admission = await test.admission()
    expect(
      await publishCowatchShadowGeneration(test.db, NOW, scope, admission),
    ).toMatchObject({
      status: "published",
      generation: admission.expectedGeneration,
    })
    expect(test.transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: "RepeatableRead",
      timeout: 30_000,
    })
    expect(
      test.tx.recommendationCowatchSourceContribution.createMany,
    ).toHaveBeenCalledOnce()
    expect(
      test.tx.recommendationCowatchContribution.createMany,
    ).toHaveBeenCalledOnce()
    expect(test.tx.recommendationCowatchEdge.createMany).toHaveBeenCalledOnce()
  })

  it.each([
    "rawSourceCount",
    "sourceCount",
    "attemptedPairCount",
    "contributionCount",
    "edgeCount",
    "publicationRowCount",
  ] as const)(
    "refuses the exceeded %s ceiling before any write",
    async (key) => {
      const test = fixture()
      const admission = await test.admission()
      admission.limits[key] -= 1
      expect(
        await publishCowatchShadowGeneration(test.db, NOW, scope, admission),
      ).toMatchObject({
        status: "admission_refused",
        publishedAt: null,
        decisionReason: "publication_admission_count_exceeded",
      })
      test.expectNoWrites()
    },
  )

  it.each(["sources", "contributions", "edges"] as const)(
    "refuses %s row maximum and total width independently",
    async (table) => {
      for (const metric of ["maximum", "total"] as const) {
        const test = fixture()
        const admission = await test.admission()
        const width = admission.limits.graphRowJsonBytes[table]
        width[metric] -= 1
        expect(
          await publishCowatchShadowGeneration(test.db, NOW, scope, admission),
        ).toMatchObject({
          status: "admission_refused",
          decisionReason: "publication_admission_width_exceeded",
        })
        test.expectNoWrites()
      }
    },
  )

  it("refuses changed generation even when every size ceiling still fits", async () => {
    const test = fixture()
    const admission = await test.admission()
    test.sources[0].eligibilityDecisionId = "new-current-decision"
    expect(
      await publishCowatchShadowGeneration(test.db, NOW, scope, admission),
    ).toMatchObject({
      status: "admission_refused",
      decisionReason: "publication_admission_generation_changed",
    })
    test.expectNoWrites()
  })

  it("keeps raw overflow bounded and refuses an unavailable admitted population", async () => {
    const test = fixture()
    const admission = await test.admission()
    while (test.sources.length <= 50_000) test.sources.push(test.sources[0])
    expect(
      await publishCowatchShadowGeneration(test.db, NOW, scope, admission),
    ).toMatchObject({
      status: "admission_refused",
      rawSourceCount: 50_001,
      rawSourceCountIsLowerBound: true,
      generation: null,
      decisionReason: "publication_admission_population_unavailable",
    })
    test.expectNoWrites()
  })

  it("rejects a malformed or mismatched admission before the transaction", async () => {
    const test = fixture()
    const admission = await test.admission()
    test.transaction.mockClear()
    await expect(
      publishCowatchShadowGeneration(test.db, NOW, scope, {
        ...admission,
        limits: { ...admission.limits, rawSourceCount: 50_001 },
      }),
    ).rejects.toThrow("Invalid co-watch publication admission")
    await expect(
      publishCowatchShadowGeneration(test.db, NOW, undefined, admission),
    ).rejects.toThrow("Invalid co-watch publication admission")
    await expect(
      publishCowatchShadowGeneration(
        test.db,
        NOW,
        {
          ...scope,
          windowStart: new Date(scope.windowStart.getTime() + 1),
        },
        admission,
      ),
    ).rejects.toThrow("source scope differs")
    expect(test.transaction).not.toHaveBeenCalled()
  })
})
