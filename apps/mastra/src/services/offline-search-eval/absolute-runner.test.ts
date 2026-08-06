import { describe, expect, it, vi } from "vitest"

import type { AbsolutePublicWatchQueryCase } from "./absolute-query-set"
import { runAbsoluteSearchEval } from "./absolute-runner"

const developmentCase: AbsolutePublicWatchQueryCase = {
  id: "seed-jesus",
  locale: "en",
  languageSlug: "english",
  queryText: "jesus",
  source: "seed",
  callerTracks: ["public-watch"],
  tags: ["product-title"],
  split: "development",
  intent: "product-title",
  expectedNoResult: false,
  multilingual: false,
}

const heldOutCase: AbsolutePublicWatchQueryCase = {
  ...developmentCase,
  id: "seed-thai-who-is-jesus",
  locale: "th",
  languageSlug: "thai",
  queryText: "พระเยซูคือใคร",
  split: "held-out",
  multilingual: true,
}

const result = {
  type: "video" as const,
  id: "video-1",
  canonicalVideoId: "core:4_jesus",
  slug: "jesus",
  title: "JESUS",
  imageUrl: null,
  snippet: "The story of Jesus.",
  startSeconds: null,
  playbackId: "mux-1",
  score: 1,
  label: "FEATURE_FILM",
  durationSeconds: 120,
  childCount: null,
  languageSlug: "english",
}

describe("runAbsoluteSearchEval", () => {
  it("runs seed-only MODERN development cases and writes absolute evidence", async () => {
    const searchClient = vi.fn(async (_input: unknown) => ({
      ok: true as const,
      result: {
        results: [result],
        hasMore: false,
        query: "jesus",
        searchMode: "watch-search-typesense",
        requestId: "request-1",
        degraded: false,
        latencyMs: 40,
        revision: "candidate-revision",
        laneStatuses: [],
      },
    }))
    const judgePointwise = vi.fn(async () => ({
      rating: "excellent" as const,
      rationale: "Exact product family first.",
      tokens: { input: 10, output: 4 },
      model: "judge-model",
    }))
    const writeReport = vi.fn(async () => ({ path: "/tmp/absolute.json" }))

    const outcome = await runAbsoluteSearchEval(
      {
        split: "development",
        backendMode: "modern",
        searchLimit: 10,
      },
      {
        cases: [developmentCase, heldOutCase],
        searchUrl: "https://admin.internal/search",
        adminBearer: "token",
        searchClient,
        judge: {
          model: "judge-model",
          provider: "openrouter",
          judgePair: vi.fn(),
          judgePointwise,
        },
        relevanceJudgments: {
          "seed-jesus": { "core:4_jesus": 3 },
        },
        artifactWriter: { writeReport },
        runId: "absolute-run",
        now: () => new Date("2026-08-05T00:00:00.000Z"),
      },
    )

    expect(outcome).toMatchObject({
      ok: true,
      reportPath: "/tmp/absolute.json",
      report: {
        kind: "absolute-report",
        split: "development",
        backendMode: "modern",
        quality: {
          successAt1: 1,
          ndcgAt10: 1,
          languageCorrectness: 1,
          canonicalDuplicateRate: 0,
          pointwiseUsefulRate: 1,
        },
        observedServerRevisions: ["candidate-revision"],
        relevanceJudgmentSetVersion: "public-watch-qrels/unreviewed-v1",
        judgeProvider: "openrouter",
      },
    })
    expect(searchClient).toHaveBeenCalledOnce()
    const searchInput = searchClient.mock.calls[0]?.[0] as
      | { payload: unknown }
      | undefined
    expect(searchInput?.payload).toEqual(
      expect.objectContaining({
        query: "jesus",
        languageSlug: "english",
        mode: "modern",
        contentType: "video",
      }),
    )
    expect(judgePointwise).toHaveBeenCalledOnce()
    expect(writeReport).toHaveBeenCalledOnce()
  })

  it("accepts a reviewed judgment set through the real workflow input contract", async () => {
    const outcome = await runAbsoluteSearchEval(
      {
        split: "held-out",
        backendMode: "modern",
        acknowledgeHeldOutReleaseGate: true,
        runPointwiseJudge: false,
        relevanceJudgmentSet: {
          version: "public-watch-qrels/reviewed-v1",
          querySetVersion: "public-watch-absolute/v2",
          judgments: {
            "seed-thai-who-is-jesus": { "core:4_jesus": 3 },
          },
        },
        candidateIdentity: {
          revision: "candidate-revision",
          collections: {
            catalog: "watch_search_catalog_candidate",
            availability: "watch_search_availability_candidate",
            lexical: "watch_search_lexical_candidate",
            transcripts: "watch_search_transcripts_active",
          },
        },
        operatorReview: {
          approved: true,
          reviewer: "search-owner",
          notes: "Reviewed the held-out result list.",
        },
      },
      {
        cases: [heldOutCase],
        searchUrl: "https://admin.internal/search",
        adminBearer: "token",
        searchClient: vi.fn(async () => ({
          ok: true as const,
          result: {
            results: [{ ...result, languageSlug: "thai" }],
            hasMore: false,
            query: heldOutCase.queryText,
            searchMode: "watch-search-typesense",
            requestId: "request-held-out",
            degraded: false,
            latencyMs: 40,
            revision: "candidate-revision",
            laneStatuses: [],
          },
        })),
        artifactWriter: {
          writeReport: vi.fn(async () => ({ path: "/tmp/held-out.json" })),
        },
      },
    )

    expect(outcome).toMatchObject({
      ok: true,
      report: {
        relevanceJudgmentSetVersion: "public-watch-qrels/reviewed-v1",
        observedServerRevisions: ["candidate-revision"],
        candidateIdentity: { revision: "candidate-revision" },
      },
    })
  })

  it("does not expose held-out results without an explicit release-gate acknowledgement", async () => {
    const searchClient = vi.fn()

    const outcome = await runAbsoluteSearchEval(
      { split: "held-out", backendMode: "modern" },
      {
        cases: [heldOutCase],
        searchUrl: "https://admin.internal/search",
        adminBearer: "token",
        searchClient,
      },
    )

    expect(outcome).toEqual({
      ok: false,
      reason: "held_out_acknowledgement_required",
      retryable: false,
    })
    expect(searchClient).not.toHaveBeenCalled()
  })

  it("keeps reports when one seed query fails but fails the release gate", async () => {
    const writeReport = vi.fn(async () => ({ path: "/tmp/failed.json" }))
    const outcome = await runAbsoluteSearchEval(
      {
        split: "development",
        backendMode: "modern",
        runPointwiseJudge: false,
      },
      {
        cases: [developmentCase],
        searchUrl: "https://admin.internal/search",
        adminBearer: "token",
        searchClient: vi.fn(async () => ({
          ok: false as const,
          reason: "network_error" as const,
          retryable: true,
        })),
        artifactWriter: { writeReport },
        runId: "failed-run",
      },
    )

    expect(outcome).toMatchObject({
      ok: true,
      report: {
        observations: [
          expect.objectContaining({
            caseId: "seed-jesus",
            searchFailure: "network_error",
          }),
        ],
        gate: {
          passed: false,
          reasons: expect.arrayContaining(["search_failures"]),
        },
      },
    })
  })
})
