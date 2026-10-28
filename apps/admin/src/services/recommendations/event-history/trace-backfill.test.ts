import { describe, expect, it, vi } from "vitest"
import { readRecommendationTraceHistoryPage } from "./trace-backfill"

const createdAt = new Date("2026-10-28T02:00:01.000Z")
const expiresAt = new Date("2026-11-26T02:00:00.000Z")
const request = {
  id: "request-1",
  manifestId: "manifest-1",
  strategyVersion: "strategy-v1",
  seedMediaId: "video-0",
  locale: "en",
  result: "SERVED",
  state: "ISSUED",
  fallbackReason: null,
  expectedItemCount: 0,
  retrievalLatencyMs: 17,
  responseBytes: 100,
  experimentAssignmentId: null,
  createdAt,
  issuedAt: createdAt,
  expiresAt,
  servedItemPayload: null,
  deliveryDiagnostics: null,
  items: [],
  candidateRun: {
    id: "run-1",
    requestId: "request-1",
    createdAt,
    expiresAt,
    purpose: "watch",
    contextVersion: "context-v1",
    generatorVersion: "generator-v1",
    unionVersion: "union-v1",
    eligibilityVersion: "eligibility-v1",
    rankerVersion: "ranker-v1",
    composerVersion: "composer-v1",
    candidateEligibilityParity: "passed",
    rankerParity: "passed",
    nominatedCount: 2,
    canonicalizedCount: 2,
    deduplicatedCount: 2,
    rejectedCount: 0,
    scoredCount: 2,
    orderedCount: 2,
    requestedCount: 6,
    composedCount: 0,
    shortfallReason: "insufficient_candidates",
    evidenceComplete: true,
    fallbackReason: null,
    tracePayload: null,
    stageEvidence: [0, 1, 2].map((ordinal) => ({
      id: `stage-${ordinal}`,
      runId: "run-1",
      stage: "scored",
      ordinal,
      candidateKey: `semantic:${ordinal}:video-${ordinal}`,
      targetMediaId: `video-${ordinal}`,
      sourceGenerator: "semantic",
      sourceRank: ordinal + 1,
      sourceScore: 0.9,
      normalizedScore: 0.9,
      rrfScore: 0.1,
      deterministicScore: 1,
      finalPosition: ordinal,
      reasonCodes: [],
      sourceEvidence: [],
      createdAt,
      expiresAt,
    })),
  },
}

describe("bounded recommendation trace backfill", () => {
  it("refuses to invent missing history-only stage payloads", async () => {
    const historyOnly = {
      ...request,
      candidateRun: {
        ...request.candidateRun,
        traceFormatVersion: 2,
        tracePayload: null,
        stageIds: ["stage-0", "stage-1", "stage-2"],
        stageEvidence: [],
      },
    }
    const tx = {
      recommendationRequest: {
        findFirst: vi.fn(async ({ select }: { select?: unknown }) =>
          select ? { id: request.id, expiresAt } : historyOnly,
        ),
        findUnique: vi.fn(async ({ select }: { select?: unknown }) =>
          select ? { id: request.id, expiresAt } : historyOnly,
        ),
      },
      $queryRaw: vi.fn(async () => [
        {
          requestBytes: 100n,
          runBytes: 100n,
          itemCount: 0n,
          itemBytes: 0n,
          stageCount: 0n,
          stageBytes: 0n,
        },
      ]),
    }
    const db = {
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    } as never
    await expect(
      readRecommendationTraceHistoryPage(db, null),
    ).rejects.toMatchObject({
      code: "history_only_stage_payload_unavailable",
    })
  })
  it("resumes within one root without re-emitting prior identities", async () => {
    const findFirst = vi.fn(async ({ select }: { select?: unknown }) =>
      select ? { id: request.id, expiresAt } : request,
    )
    const findUnique = vi.fn(async ({ select }: { select?: unknown }) =>
      select ? { id: request.id, expiresAt } : request,
    )
    const tx = {
      recommendationRequest: { findFirst, findUnique },
      $queryRaw: vi.fn(async () => [
        {
          requestBytes: 100n,
          runBytes: 100n,
          itemCount: 0n,
          itemBytes: 0n,
          stageCount: 3n,
          stageBytes: 300n,
        },
      ]),
    }
    const db = {
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    } as never
    const first = await readRecommendationTraceHistoryPage(db, null, {
      maxEvents: 2,
    })
    expect(first.events.map((event) => event.logicalId)).toEqual([
      "request-1",
      "run-1",
    ])
    expect(first.cursor).toMatchObject({
      kind: "within",
      requestId: "request-1",
      offset: 2,
      sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const second = await readRecommendationTraceHistoryPage(db, first.cursor, {
      maxEvents: 2,
    })
    expect(second.events.map((event) => event.logicalId)).toEqual([
      "stage-0",
      "stage-1",
    ])
    const third = await readRecommendationTraceHistoryPage(db, second.cursor, {
      maxEvents: 2,
    })
    expect(third.events.map((event) => event.logicalId)).toEqual(["stage-2"])
    expect(third.cursor).toEqual({ kind: "after", requestId: "request-1" })
    expect(findFirst).toHaveBeenCalledTimes(1)
    expect(findUnique).toHaveBeenCalledTimes(5)
  })

  it("refuses a resumed root whose exported source sequence changed", async () => {
    let current = request
    const tx = {
      recommendationRequest: {
        findFirst: vi.fn(async ({ select }: { select?: unknown }) =>
          select ? { id: request.id, expiresAt } : current,
        ),
        findUnique: vi.fn(async ({ select }: { select?: unknown }) =>
          select ? { id: request.id, expiresAt } : current,
        ),
      },
      $queryRaw: vi.fn(async () => [
        {
          requestBytes: 100n,
          runBytes: 100n,
          itemCount: 0n,
          itemBytes: 0n,
          stageCount: 3n,
          stageBytes: 300n,
        },
      ]),
    }
    const db = {
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    } as never
    const first = await readRecommendationTraceHistoryPage(db, null, {
      maxEvents: 2,
    })
    current = {
      ...request,
      candidateRun: {
        ...request.candidateRun,
        stageEvidence: request.candidateRun.stageEvidence.slice(1),
      },
    }
    await expect(
      readRecommendationTraceHistoryPage(db, first.cursor, { maxEvents: 2 }),
    ).rejects.toMatchObject({
      code: "history_source_changed",
    })
  })

  it("refuses an expired or deleted within-root cursor rather than advancing it", async () => {
    const tx = {
      recommendationRequest: {
        findUnique: vi.fn(async () => null),
      },
    }
    const db = {
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    } as never
    await expect(
      readRecommendationTraceHistoryPage(db, {
        kind: "within",
        requestId: "request-1",
        offset: 2,
        sourceDigest: "a".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "history_source_unavailable" })
  })

  it("caps emitted bytes and rejects unbounded roots", async () => {
    const tx = {
      recommendationRequest: {
        findFirst: vi.fn(async () => ({ id: request.id, expiresAt })),
        findUnique: vi.fn(async () => request),
      },
      $queryRaw: vi.fn(async () => [
        {
          requestBytes: 100n,
          runBytes: 100n,
          itemCount: 0n,
          itemBytes: 0n,
          stageCount: 3n,
          stageBytes: 300n,
        },
      ]),
    }
    const db = {
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    } as never
    const page = await readRecommendationTraceHistoryPage(db, null, {
      maxEvents: 100,
      maxBytes: 900,
    })
    expect(page.events.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(page.events))).toBeLessThan(1_200)
    const oversized = {
      ...request,
      candidateRun: {
        ...request.candidateRun,
        stageEvidence: Array.from({ length: 449 }, (_, i) => ({
          ...request.candidateRun.stageEvidence[0],
          id: `stage-${i}`,
        })),
      },
    }
    const badTx = {
      recommendationRequest: {
        findFirst: vi.fn(async () => ({ id: request.id, expiresAt })),
        findUnique: vi.fn(async () => oversized),
      },
      $queryRaw: vi.fn(async () => [
        {
          requestBytes: 100n,
          runBytes: 100n,
          itemCount: 0n,
          itemBytes: 0n,
          stageCount: 449n,
          stageBytes: 300n,
        },
      ]),
    }
    const bad = {
      $transaction: async (work: (client: typeof badTx) => unknown) =>
        work(badTx),
    } as never
    await expect(
      readRecommendationTraceHistoryPage(bad, null),
    ).rejects.toMatchObject({
      code: "history_stage_limit",
    })
  })

  it("rejects an oversized packed root before hydration", async () => {
    const hydrate = vi.fn()
    const tx = {
      recommendationRequest: {
        findFirst: vi.fn(async () => ({ id: request.id, expiresAt })),
        findUnique: hydrate,
      },
      $queryRaw: vi.fn(async () => [
        {
          requestBytes: 9n * 1_048_576n,
          runBytes: 0n,
          itemCount: 0n,
          itemBytes: 0n,
          stageCount: 0n,
          stageBytes: 0n,
        },
      ]),
    }
    const db = {
      $transaction: async (work: (client: typeof tx) => unknown) => work(tx),
    } as never
    await expect(
      readRecommendationTraceHistoryPage(db, null),
    ).rejects.toMatchObject({
      code: "history_root_byte_limit",
    })
    expect(hydrate).not.toHaveBeenCalled()
  })

  it("classifies invalid page parameters without reading storage", async () => {
    const transaction = vi.fn()
    const db = { $transaction: transaction } as never
    await expect(
      readRecommendationTraceHistoryPage(db, null, { maxEvents: 101 }),
    ).rejects.toMatchObject({
      code: "invalid_input",
    })
    expect(transaction).not.toHaveBeenCalled()
  })
})
