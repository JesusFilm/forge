import { describe, expect, it } from "vitest"

import { assertNoUnavailableCaptures } from "./capture-rag"
import type { RagFixture, RetrieveAnswerResult } from "./rag"

/**
 * The refuse-before-write half of finding #15: `main()` calls this guard
 * BEFORE mkdir/writeFile, so a capture with dead cells is refused without a
 * poisoned fixture file ever landing on disk. corpusHash — the other
 * exported machine in capture-rag.ts — is tested in rag.test.ts, next to
 * the committed file's fingerprint pin.
 */
function fixture(
  questionId: string,
  status: RetrieveAnswerResult["status"],
): RagFixture {
  return {
    questionId,
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

describe("assertNoUnavailableCaptures", () => {
  it("passes a clean capture — ok and genuinely-empty cells are both real results", () => {
    expect(() =>
      assertNoUnavailableCaptures([
        fixture("q-a", "ok"),
        fixture("q-b", "empty"),
      ]),
    ).not.toThrow()
  })

  it("refuses a capture with any unavailable cell, naming the offenders", () => {
    expect(() =>
      assertNoUnavailableCaptures([
        fixture("q-a", "ok"),
        fixture("q-b", "unavailable"),
        fixture("q-c", "unavailable"),
      ]),
    ).toThrow(/2 question\(s\).*q-b, q-c.*nothing was written/)
  })
})
