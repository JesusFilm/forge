import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  JesusfilmRagClientResult,
  JesusfilmRagFailureReason,
  JesusfilmRagPassage,
} from "../../services/jesusfilm-rag-client"
import {
  RETRIEVE_ANSWER_EMPTY_MESSAGE,
  RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
  executeRetrieveAnswer,
  retrieveAnswerInputSchema,
  retrieveAnswerOutputSchema,
} from "./retrieve-answer"

// Contract-shaped client passages (consumed fields the client already mapped).
const passageWithTitle = {
  score: 0.82,
  text: "Jesus invites everyone to follow him.",
  citation: {
    sourceName: "The Jesus Film",
    title: "Who Is Jesus?",
    url: "https://example.org/who-is-jesus",
  },
}

const passageNullTitle = {
  score: 0.71,
  text: "The Gospel of Luke records his life.",
  citation: {
    sourceName: "Gospel of Luke",
    title: null,
    url: "https://example.org/luke",
  },
}

function okResult(
  results: JesusfilmRagPassage[],
): () => Promise<JesusfilmRagClientResult> {
  return () => Promise.resolve({ ok: true, results })
}

function failure(
  reason: JesusfilmRagFailureReason,
): () => Promise<JesusfilmRagClientResult> {
  return () =>
    Promise.resolve({
      ok: false,
      reason,
      retryable: false,
      ...(reason === "config_missing"
        ? { detail: "api_key_missing" as const }
        : {}),
    })
}

describe("retrieve-answer tool", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("maps ok passages to status ok with field-for-field sources", async () => {
    const result = await executeRetrieveAnswer(
      { query: "who is Jesus?" },
      { search: okResult([passageWithTitle, passageNullTitle]) },
    )

    expect(result).toEqual({
      status: "ok",
      sources: [
        {
          text: "Jesus invites everyone to follow him.",
          sourceName: "The Jesus Film",
          title: "Who Is Jesus?",
          url: "https://example.org/who-is-jesus",
          score: 0.82,
        },
        {
          text: "The Gospel of Luke records his life.",
          sourceName: "Gospel of Luke",
          title: null,
          url: "https://example.org/luke",
          score: 0.71,
        },
      ],
    })

    // Non-vacuous R9 guard (replaces the old stub-marker regression test):
    // every returned URL is a member of the non-empty set the client returned.
    const returnedUrls = [passageWithTitle, passageNullTitle].map(
      (passage) => passage.citation.url,
    )
    expect(returnedUrls.length).toBeGreaterThan(0)
    for (const source of result.sources) {
      expect(returnedUrls).toContain(source.url)
    }
  })

  it("maps zero results to status empty with no-grounded-answer guidance", async () => {
    const result = await executeRetrieveAnswer(
      { query: "obscure" },
      { search: okResult([]) },
    )

    expect(result).toEqual({
      status: "empty",
      sources: [],
      message: RETRIEVE_ANSWER_EMPTY_MESSAGE,
    })
    expect(result.message).toMatch(/do not invent sources/i)
  })

  it.each<JesusfilmRagFailureReason>([
    "config_missing",
    "auth_failed",
    "timeout",
    "network_error",
    "rate_limited",
    "rejected",
    "parse_error",
  ])(
    "maps client failure %s to status unavailable (never throws)",
    async (reason) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const result = await executeRetrieveAnswer(
        { query: "x" },
        { search: failure(reason) },
      )

      expect(result).toEqual({
        status: "unavailable",
        sources: [],
        message: RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
      })
      // Every failure reason must emit exactly one structured log line. Without
      // this, deleting or gating logRetrievalUnavailable would leave all seven
      // cases green (the log path was previously unverified for 5 of them).
      expect(errorSpy).toHaveBeenCalledTimes(1)
    },
  )

  it("clamps a query longer than 2000 code points to exactly 2000 before the client", async () => {
    let received = ""
    // 2100 surrogate-pair characters (each 1 code point, 2 UTF-16 units); a
    // boundary char must not be split.
    const longQuery = "😀".repeat(2100)

    await executeRetrieveAnswer(
      { query: longQuery },
      {
        search: ({ query }) => {
          received = query
          return Promise.resolve({ ok: true, results: [] })
        },
      },
    )

    expect(Array.from(received)).toHaveLength(2000)
    // No lone surrogate at the boundary (codepoint-safe slice).
    expect(received.endsWith("😀")).toBe(true)
  })

  it("truncates a passage text longer than the per-passage cap, codepoint-safe", async () => {
    const longText = "🙂".repeat(5000)

    const result = await executeRetrieveAnswer(
      { query: "x" },
      {
        search: okResult([{ ...passageWithTitle, text: longText }]),
      },
    )

    expect(Array.from(result.sources[0].text)).toHaveLength(4000)
    expect(result.sources[0].text.endsWith("🙂")).toBe(true)
  })

  it("passes the trimmed query through to the client", async () => {
    let received = ""

    await executeRetrieveAnswer(
      { query: "   who is Jesus?   " },
      {
        search: ({ query }) => {
          received = query
          return Promise.resolve({ ok: true, results: [] })
        },
      },
    )

    expect(received).toBe("who is Jesus?")
  })

  it("rejects extra input fields (incl. the removed locale) via .strict()", () => {
    expect(
      retrieveAnswerInputSchema.safeParse({ query: "x", locale: "es" }).success,
    ).toBe(false)
    expect(
      retrieveAnswerInputSchema.safeParse({ query: "x", extra: true }).success,
    ).toBe(false)
    expect(retrieveAnswerInputSchema.safeParse({ query: "x" }).success).toBe(
      true,
    )
  })

  it("throws on invalid input via its own .parse() guard", async () => {
    await expect(
      executeRetrieveAnswer({ query: "" }, { search: okResult([]) }),
    ).rejects.toThrow()
  })

  it("produces output that conforms to the output schema for every status", async () => {
    const ok = await executeRetrieveAnswer(
      { query: "x" },
      { search: okResult([passageWithTitle]) },
    )
    const empty = await executeRetrieveAnswer(
      { query: "x" },
      { search: okResult([]) },
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    const unavailable = await executeRetrieveAnswer(
      { query: "x" },
      { search: failure("timeout") },
    )

    for (const output of [ok, empty, unavailable]) {
      expect(retrieveAnswerOutputSchema.safeParse(output).success).toBe(true)
    }
  })

  it("logs a strict event= line that leaks neither query, key, nor body text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await executeRetrieveAnswer(
      { query: "a-very-secret-question-string" },
      { search: failure("config_missing") },
    )

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0][0] as string
    expect(line).toBe(
      "[seeker] event=rag_retrieval_unavailable reason=config_missing detail=api_key_missing",
    )
    expect(line).not.toContain("a-very-secret-question-string")
  })

  it("logs the base_url_missing detail variant of config_missing", async () => {
    // The shared failure() helper hardcodes detail=api_key_missing, so the
    // base_url_missing branch of the log line is otherwise never exercised —
    // a typed discriminator with no test where ONLY it can match
    // (mocked-shape-vs-real-contract discipline).
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await executeRetrieveAnswer(
      { query: "x" },
      {
        search: () =>
          Promise.resolve({
            ok: false,
            reason: "config_missing",
            retryable: false,
            detail: "base_url_missing",
          }),
      },
    )

    expect(result.status).toBe("unavailable")
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toBe(
      "[seeker] event=rag_retrieval_unavailable reason=config_missing detail=base_url_missing",
    )
  })

  it("never logs upstreamReason (RAG-controlled text) on a failure that carries one", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const UPSTREAM_SECRET = "RAG-CONTROLLED-LEAK-VECTOR"

    const result = await executeRetrieveAnswer(
      { query: "x" },
      {
        // auth_failed carries an upstreamReason; the log line must exclude it.
        search: () =>
          Promise.resolve({
            ok: false,
            reason: "auth_failed",
            retryable: false,
            status: 401,
            upstreamReason: UPSTREAM_SECRET,
          }),
      },
    )

    expect(result.status).toBe("unavailable")
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const line = errorSpy.mock.calls[0][0] as string
    expect(line).toBe(
      "[seeker] event=rag_retrieval_unavailable reason=auth_failed",
    )
    expect(line).not.toContain(UPSTREAM_SECRET)
  })
})
