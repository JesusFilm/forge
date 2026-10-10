import { describe, expect, it } from "vitest"

import { assertServableFixture } from "./run-answers"
import type { RagFixture, RetrieveAnswerResult } from "./rag"

/**
 * The injected-mode half of finding #15: the cell loop must refuse a
 * fixture that encodes a retrieval outage — the same invariant the tool
 * loop enforces via fixture-rag.ts's `fixtureResultToClientResult` — so a
 * hand-edited fixture cannot silently measure the unavailable path as if
 * retrieval had run.
 */
function fixture(status: RetrieveAnswerResult["status"]): RagFixture {
  return {
    questionId: "q-a",
    query: "q",
    capturedAt: "2026-08-01T00:00:00.000Z",
    result: {
      status,
      sources:
        status === "ok"
          ? [
              {
                text: "passage",
                sourceName: "Cru",
                title: null,
                url: "https://example.com/1",
                score: 0.9,
              },
            ]
          : [],
    },
  }
}

describe("assertServableFixture", () => {
  it("accepts ok and genuinely-empty fixtures — both are real retrieval results", () => {
    expect(() => assertServableFixture(fixture("ok"), "q-a")).not.toThrow()
    expect(() => assertServableFixture(fixture("empty"), "q-a")).not.toThrow()
  })

  it("throws on an unavailable fixture, naming the question", () => {
    expect(() => assertServableFixture(fixture("unavailable"), "q-a")).toThrow(
      /q-a.*'unavailable'.*re-capture/,
    )
  })
})
