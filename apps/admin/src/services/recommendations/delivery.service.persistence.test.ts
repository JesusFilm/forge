import { afterEach, describe, expect, it, vi } from "vitest"
import { runRecommendationRetrievalQuery } from "./delivery.service"

import { input, makeHarness } from "./delivery.service.test-helpers"

afterEach(() => {
  vi.useRealTimers()
})

describe("RecommendationDeliveryService persistence and deadlines", () => {
  it("signs fresh capabilities before one atomic complete ISSUED commit", async () => {
    const harness = makeHarness()
    const { service, requests, transactions, acquire } = harness

    const first = await service.deliver(input())
    const second = await service.deliver({
      ...input("seed-video", "b"),
      audioLanguageSlug: "spanish-castilian",
    })

    expect(first.result).toBe("served")
    expect(first.expiresAt).toBe("2026-08-19T03:10:00.000Z")
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({
      targetMediaId: "target-video",
      candidateGenerator: "semantic",
      contributors: [
        {
          generator: "semantic",
          generatorVersion: "semantic-transcript-candidate-v1",
          rank: 1,
        },
      ],
    })
    expect(first).toMatchObject({
      requestedCount: 6,
      composedCount: 1,
      shortfallReason: "insufficient_candidates",
      personalization: {
        lane: "semantic_control",
        executionMode: "semantic_contextual",
      },
    })
    expect(JSON.stringify(first)).not.toMatch(/embeddingText|videoCoreId/)
    expect(first.requestId).not.toBe(second.requestId)
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id)
    expect(first.items[0]!.capability).not.toBe(second.items[0]!.capability)
    expect(first.items[0]!.canonicalHref).toBe("/watch/target.html")
    expect(second.items[0]!.canonicalHref).toBe(
      "/watch/target.html/spanish-castilian.html",
    )
    expect(transactions).toEqual(["issued", "issued"])
    expect(
      harness.signDeliveryCapability.mock.invocationCallOrder[0],
    ).toBeLessThan(
      harness.tx.recommendationRequest.create.mock.invocationCallOrder[0]!,
    )
    expect(requests.get(first.requestId!)).toMatchObject({
      expectedItemCount: 1,
      state: "ISSUED",
    })
    expect(acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        webConsumerBucketKey: "test-web-consumer-key",
      }),
    )
  })

  it("persists one bounded complete candidate-stage trace with provenance and independent parity", async () => {
    const { service, tx, requests } = makeHarness()

    const delivery = await service.deliver(input("stage-trace-seed"))

    expect(delivery.result).toBe("served")
    expect(tx.recommendationCandidateRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: delivery.requestId,
        purpose: "watch",
        contextVersion: "recommendation-context-v1",
        candidateEligibilityParity: "passed",
        rankerParity: "passed",
        evidenceComplete: true,
        requestedCount: 6,
        composedCount: 1,
        shortfallReason: "insufficient_candidates",
      }),
    })
    const stageRows = tx.recommendationCandidateStageEvidence.createMany.mock
      .calls[0]?.[0].data as Array<{ stage: string }>
    expect(new Set(stageRows.map((row) => row.stage))).toEqual(
      new Set([
        "nominated",
        "canonicalized",
        "deduplicated",
        "scored",
        "ordered",
        "composed",
      ]),
    )
    const root = requests.get(delivery.requestId!) as {
      items: { create: Array<{ candidateProvenance: unknown }> }
    }
    expect(root.items.create[0]?.candidateProvenance).toMatchObject({
      sources: [
        expect.objectContaining({
          generator: "semantic",
          generatorVersion: "semantic-transcript-candidate-v1",
        }),
      ],
      normalizedSemanticScore: 1,
      deterministicRankerVersion: "semantic-deterministic-ranker-v1",
    })
  })

  it("fails closed before retrieval when admission or serving denies issuance", async () => {
    const denied = makeHarness()
    denied.acquire.mockResolvedValueOnce({
      allowed: false as const,
      reason: "endpoint_rate",
    })
    await expect(
      denied.service.deliver(input("denied-seed")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "endpoint_rate",
    })
    expect(denied.retrieve).not.toHaveBeenCalled()
    expect(denied.release).not.toHaveBeenCalled()

    const disabled = makeHarness()
    disabled.getServingState.mockResolvedValueOnce({
      canIssue: false as const,
      reason: "serving_disabled" as const,
      revokedKids: [],
      manifest: null,
    } as never)
    await expect(
      disabled.service.deliver(input("disabled-seed")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "serving_disabled",
    })
    expect(disabled.retrieve).not.toHaveBeenCalled()
    expect(disabled.release).toHaveBeenCalledWith("lease")
  })

  it("bounds fresh retrieval and cached rechecks with one absolute deadline", async () => {
    const freshTimeout = makeHarness()
    freshTimeout.retrieve.mockImplementationOnce(
      () => new Promise(() => undefined),
    )
    vi.useFakeTimers()
    const pending = freshTimeout.service.deliver(input("fresh-timeout-seed"))
    await vi.advanceTimersByTimeAsync(1_500)
    await expect(pending).resolves.toMatchObject({
      result: "unavailable",
      reason: "retrieval_timeout",
      requestId: expect.any(String),
    })
    expect(
      freshTimeout.requests.get([...freshTimeout.requests.keys()][0] as string),
    ).toMatchObject({
      result: "UNAVAILABLE",
      state: "ISSUED",
      expectedItemCount: 0,
    })
    expect(
      freshTimeout.tx.recommendationCandidateRun.create.mock.calls[0]?.[0].data,
    ).toMatchObject({
      candidateEligibilityParity: "not_evaluated",
      rankerParity: "not_evaluated",
      evidenceComplete: false,
      fallbackReason: "retrieval_timeout",
    })
    expect(freshTimeout.release).toHaveBeenCalledWith("lease")
    vi.useRealTimers()

    const cached = makeHarness()
    await cached.service.deliver(input("cached-deadline-seed"))
    cached.retrieve.mockImplementationOnce(async () => {
      cached.advanceClock(1_150)
      throw new Error("primary unavailable")
    })
    await expect(
      cached.service.deliver(input("cached-deadline-seed", "b")),
    ).resolves.toMatchObject({
      result: "fallback",
      reason: "candidate_pool_fallback",
      requestId: expect.any(String),
    })
    expect(cached.recheckCached).toHaveBeenCalledOnce()
  })

  it("starts cache validation only after a fresh retrieval fails", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("overlapped-cache-seed"))
    let failFresh: ((reason: Error) => void) | undefined
    harness.retrieve.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failFresh = reject
        }),
    )

    const pending = harness.service.deliver(input("overlapped-cache-seed", "b"))
    await vi.waitFor(() => expect(harness.retrieve).toHaveBeenCalledTimes(2))
    expect(harness.recheckCached).not.toHaveBeenCalled()
    failFresh?.(new Error("fresh retrieval failed"))

    await expect(pending).resolves.toMatchObject({
      result: "fallback",
      reason: "candidate_pool_fallback",
    })
    expect(harness.recheckCached).toHaveBeenCalledOnce()
  })

  it("does not recheck a warm cache when fresh retrieval succeeds", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("warm-success-seed"))
    harness.recheckCached.mockClear()

    await expect(
      harness.service.deliver(input("warm-success-seed", "b")),
    ).resolves.toMatchObject({ result: "served" })

    expect(harness.recheckCached).not.toHaveBeenCalled()
  })

  it("leaves no PREPARED record when capability signing crosses the complete deadline", async () => {
    const preflight = makeHarness()
    preflight.getServingState.mockImplementationOnce(async () => {
      preflight.advanceClock(1_501)
      return {
        canIssue: true as const,
        reason: "ready" as const,
        revokedKids: [],
        lastKnownGoodManifestId: "semantic-transcript-pgvector-v1",
        manifest: {
          id: "semantic-transcript-pgvector-v1",
          strategyVersion: "semantic-transcript-pgvector-v1",
          contractVersion: "semantic-recommendation-v1",
          surfaceVersion: "watch-below-player-v1",
          generator: "semantic",
          maxItems: 6,
        },
      }
    })
    await expect(
      preflight.service.deliver(input("slow-preflight-seed")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "delivery_timeout",
      requestId: null,
    })
    expect(preflight.retrieve).not.toHaveBeenCalled()
    expect(preflight.prisma.$transaction).not.toHaveBeenCalled()

    const issuance = makeHarness()
    issuance.signDeliveryCapability.mockImplementationOnce(async () => {
      issuance.advanceClock(1_501)
      return "late-token"
    })
    await expect(
      issuance.service.deliver(input("slow-issuance-seed")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "delivery_timeout",
      requestId: null,
    })
    expect(issuance.requests.size).toBe(0)
    expect(issuance.prisma.$transaction).not.toHaveBeenCalled()
    expect(issuance.tx.recommendationRequest.create).not.toHaveBeenCalled()
    expect(issuance.tx.recommendationRequest.updateMany).not.toHaveBeenCalled()
    expect(
      issuance.tx.recommendationEvidenceAudit.create,
    ).not.toHaveBeenCalled()
  })

  it("never reports a timeout after the ISSUED transaction commits", async () => {
    const harness = makeHarness()
    harness.prisma.$transaction.mockImplementationOnce(
      async (work: (client: typeof harness.tx) => unknown) => {
        const result = await work(harness.tx)
        harness.advanceClock(1_475)
        return result
      },
    )

    await expect(
      harness.service.deliver(input("commit-boundary-seed")),
    ).resolves.toMatchObject({
      result: "served",
      requestId: expect.any(String),
    })
    expect(harness.transactions).toEqual(["issued"])
  })

  it("rechecks a compatible pool before issuing a fresh fallback request", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("fallback-seed"))
    harness.retrieve.mockRejectedValueOnce(new Error("retriever unavailable"))

    await expect(
      harness.service.deliver(input("fallback-seed", "b")),
    ).resolves.toMatchObject({
      result: "fallback",
      reason: "candidate_pool_fallback",
      requestId: expect.any(String),
    })
    expect(harness.recheckCached).toHaveBeenCalledOnce()
    expect(harness.recheckCached).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        locale: "en",
        audioLanguageSlug: "english",
      }),
    )
  })

  it("never serves an expired cached generation after retriever failure", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("stale-cache-seed"))
    harness.advanceClock(61_000)
    harness.retrieve.mockRejectedValueOnce(new Error("retriever unavailable"))

    await expect(
      harness.service.deliver(input("stale-cache-seed", "b")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "candidate_pool_stale",
      requestId: expect.any(String),
    })
    expect(harness.recheckCached).not.toHaveBeenCalled()
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[1]?.[0].data,
    ).toMatchObject({
      candidateEligibilityParity: "not_evaluated",
      rankerParity: "not_evaluated",
      evidenceComplete: false,
      fallbackReason: "candidate_pool_stale",
    })
  })

  it("does not certify parity when a failed retrieval leaves an ineligible cached pool", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("ineligible-cache-seed"))
    harness.retrieve.mockRejectedValueOnce(new Error("retriever unavailable"))
    harness.recheckCached.mockResolvedValueOnce([])

    await expect(
      harness.service.deliver(input("ineligible-cache-seed", "b")),
    ).resolves.toMatchObject({
      result: "empty",
      reason: "candidate_pool_ineligible",
    })
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[1]?.[0].data,
    ).toMatchObject({
      candidateEligibilityParity: "not_evaluated",
      rankerParity: "not_evaluated",
      evidenceComplete: false,
      fallbackReason: "candidate_pool_ineligible",
    })
  })

  it("uses the last-known-good semantic order when a later platform stage fails", async () => {
    const harness = makeHarness()
    harness.orchestrate.mockImplementationOnce(() => {
      throw new Error("ranker unavailable")
    })

    const fallback = await harness.service.deliver(
      input("pipeline-failure-seed"),
    )
    expect(fallback).toMatchObject({
      result: "fallback",
      reason: "last_known_good_semantic_fallback",
      items: [expect.objectContaining({ targetMediaId: "target-video" })],
    })
    expect(JSON.stringify(fallback)).not.toMatch(/embeddingText|videoCoreId/)
    expect(
      harness.tx.recommendationCandidateRun.create.mock.calls[0]?.[0].data,
    ).toMatchObject({
      candidateEligibilityParity: "not_evaluated",
      rankerParity: "not_evaluated",
      evidenceComplete: false,
      fallbackReason: "candidate_platform_unavailable",
    })
  })

  it("does not reuse a candidate pool across audio languages", async () => {
    const harness = makeHarness()
    await harness.service.deliver(input("audio-pool-seed"))
    harness.retrieve.mockRejectedValueOnce(new Error("retriever unavailable"))

    await expect(
      harness.service.deliver({
        ...input("audio-pool-seed", "b"),
        audioLanguageSlug: "spanish-castilian",
      }),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "retrieval_unavailable",
      requestId: expect.any(String),
    })
    expect(harness.recheckCached).not.toHaveBeenCalled()
    expect(harness.retrieve).toHaveBeenLastCalledWith(
      expect.objectContaining({ audioLanguageSlug: "spanish-castilian" }),
    )
  })

  it("marks issuance failures and returns persistence failures without leaking the lease", async () => {
    const issuance = makeHarness()
    issuance.signDeliveryCapability.mockRejectedValueOnce(
      new Error("signer unavailable"),
    )
    await expect(
      issuance.service.deliver(input("issuance-failure-seed")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "issuance_failed",
    })
    expect(issuance.tx.recommendationRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: expect.any(String),
        state: "ISSUANCE_FAILED",
        issuedAt: null,
        responseBytes: null,
      }),
    })
    expect(issuance.tx.recommendationRequest.updateMany).not.toHaveBeenCalled()
    expect(
      issuance.tx.recommendationEvidenceAudit.create,
    ).not.toHaveBeenCalled()
    expect(issuance.release).toHaveBeenCalledWith("lease")

    const persistence = makeHarness()
    persistence.tx.recommendationRequest.create.mockRejectedValueOnce(
      new Error("database unavailable"),
    )
    persistence.release.mockRejectedValueOnce(new Error("redis unavailable"))
    await expect(
      persistence.service.deliver(input("persistence-failure-seed")),
    ).resolves.toMatchObject({
      result: "unavailable",
      reason: "persistence_unavailable",
    })
    expect(persistence.release).toHaveBeenCalledWith("lease")
  })

  it("sets a query-level statement timeout from the remaining deadline", async () => {
    const scoped = { $queryRaw: vi.fn(async () => []) }
    let now = 750
    const transaction = vi.fn(
      async (
        work: (client: typeof scoped) => Promise<string>,
        _options?: { maxWait: number; timeout: number },
      ) => {
        now = 1_700
        return work(scoped)
      },
    )
    const operation = vi.fn(async () => "ok")

    await expect(
      runRecommendationRetrievalQuery(
        { $transaction: transaction } as never,
        2_000,
        operation as never,
        () => now,
      ),
    ).resolves.toBe("ok")
    expect(scoped.$queryRaw).toHaveBeenCalledOnce()
    const queryCall = scoped.$queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      string,
    ]
    expect(queryCall[0].join(" ")).toContain("set_config('statement_timeout'")
    expect(queryCall[0].join(" ")).toContain("'search_path'")
    expect(queryCall[1]).toBe("300")
    expect(operation).toHaveBeenCalledWith(scoped)
    expect(transaction.mock.calls[0]?.[1]).toEqual({
      maxWait: 1_250,
      timeout: 1_250,
    })
  })
})
