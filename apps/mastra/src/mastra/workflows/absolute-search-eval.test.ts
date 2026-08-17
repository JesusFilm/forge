import { describe, expect, it, vi } from "vitest"

import {
  absoluteSearchEvalWorkflow,
  runAbsoluteSearchEvalWorkflow,
  _internal,
} from "./absolute-search-eval"

const candidateIdentity = {
  revision: "abcdef123456",
  collections: {
    catalog: "watch_search_catalog_candidate",
    availability: "watch_search_availability_candidate",
    lexical: "watch_search_lexical_candidate",
    transcripts: "watch_search_transcripts_active",
  },
} as const

describe("absolute search eval workflow", () => {
  it("is registered with release-safe development defaults", () => {
    expect(absoluteSearchEvalWorkflow.id).toBe("absolute-search-eval")
    expect(
      _internal.AbsoluteSearchEvalInputSchema.parse({ candidateIdentity }),
    ).toEqual({
      split: "development",
      backendMode: "modern",
      locales: undefined,
      searchLimit: 10,
      runPointwiseJudge: true,
      acknowledgeHeldOutReleaseGate: false,
      candidateIdentity,
    })
  })

  it("validates reviewed qrels and immutable candidate identity", () => {
    expect(
      _internal.AbsoluteSearchEvalInputSchema.parse({
        relevanceJudgmentSet: {
          version: "public-watch-qrels/reviewed-v1",
          querySetVersion: "public-watch-absolute/v2",
          judgments: { "seed-jesus": { "core:4_jesus": 3 } },
        },
        candidateIdentity,
        operatorReview: {
          approved: true,
          reviewer: "search-owner",
          notes: "Reviewed focused cases.",
        },
      }),
    ).toMatchObject({
      relevanceJudgmentSet: {
        querySetVersion: "public-watch-absolute/v2",
      },
      candidateIdentity: { revision: "abcdef123456" },
      operatorReview: { approved: true },
    })
  })

  it("passes an explicit held-out acknowledgement to the absolute runner", async () => {
    const runner = vi.fn(async () => ({
      ok: false as const,
      reason: "config_missing" as const,
      retryable: false,
    }))

    await expect(
      runAbsoluteSearchEvalWorkflow(
        {
          split: "held-out",
          backendMode: "modern",
          acknowledgeHeldOutReleaseGate: true,
          candidateIdentity,
        },
        { runner },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "config_missing",
      retryable: false,
    })
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        split: "held-out",
        backendMode: "modern",
        acknowledgeHeldOutReleaseGate: true,
        candidateIdentity,
      }),
      expect.any(Object),
    )
  })

  it("rejects an unknown backend before starting a run", async () => {
    const runner = vi.fn()

    await expect(
      runAbsoluteSearchEvalWorkflow({ backendMode: "unknown" }, { runner }),
    ).resolves.toEqual({
      ok: false,
      reason: "invalid_input",
      retryable: false,
    })
    expect(runner).not.toHaveBeenCalled()
  })
})
