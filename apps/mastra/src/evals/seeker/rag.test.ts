import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  citableSources,
  loadableFixtureFile,
  RETRIEVE_ANSWER_DESCRIPTION,
  RETRIEVE_ANSWER_EMPTY_MESSAGE,
  RETRIEVE_ANSWER_TOOL_SPEC,
  RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
  type RagFixtureFile,
} from "./rag"
import {
  retrieveAnswerInputSchema,
  retrieveAnswerTool,
  RETRIEVE_ANSWER_EMPTY_MESSAGE as REAL_EMPTY_MESSAGE,
  RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE as REAL_UNAVAILABLE_MESSAGE,
} from "../../mastra/tools/retrieve-answer"

/**
 * Drift pins: rag.ts carries pinned COPIES of the tool contract so the CLI
 * scripts stay dependency-light (copy-not-import). These tests import the
 * REAL tool module and fail loudly if the copies drift — the schema-diff
 * discipline the decision doc requires for any hand-maintained mirror.
 */
describe("tool-contract drift pins", () => {
  it("pins the empty/unavailable messages byte-for-byte to the tool's exports", () => {
    expect(RETRIEVE_ANSWER_EMPTY_MESSAGE).toBe(REAL_EMPTY_MESSAGE)
    expect(RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE).toBe(REAL_UNAVAILABLE_MESSAGE)
  })

  it("pins the tool description byte-for-byte to the registered tool", () => {
    expect(RETRIEVE_ANSWER_DESCRIPTION).toBe(retrieveAnswerTool.description)
  })

  it("pins the tool spec name to the registered tool id", () => {
    expect(RETRIEVE_ANSWER_TOOL_SPEC.function.name).toBe(retrieveAnswerTool.id)
  })

  it("mirrors the input schema shape: one required strict string `query`", () => {
    // The spec says: object, one required string property `query`, no
    // additional properties. Prove the REAL schema agrees on each element.
    expect(retrieveAnswerInputSchema.safeParse({ query: "x" }).success).toBe(
      true,
    )
    expect(retrieveAnswerInputSchema.safeParse({}).success).toBe(false)
    expect(
      retrieveAnswerInputSchema.safeParse({ query: "x", extra: 1 }).success,
    ).toBe(false)
    expect(RETRIEVE_ANSWER_TOOL_SPEC.function.parameters.required).toEqual([
      "query",
    ])
    expect(
      RETRIEVE_ANSWER_TOOL_SPEC.function.parameters.additionalProperties,
    ).toBe(false)
  })
})

describe("citableSources", () => {
  const file: RagFixtureFile = {
    kind: "chat-eval-rag-fixtures",
    capturedAt: "2026-08-01T00:00:00.000Z",
    baseUrl: "http://localhost:8080",
    topK: 5,
    corpusSha256: "corpus",
    fixtures: [
      {
        questionId: "q-a",
        query: "a",
        capturedAt: "2026-08-01T00:00:00.000Z",
        result: {
          status: "ok",
          sources: [
            {
              text: "t1",
              sourceName: "Cru",
              title: "Title One",
              url: "https://example.com/1",
              score: 0.9,
            },
            {
              text: "t2",
              sourceName: "EveryStudent",
              title: null,
              url: "https://example.com/2",
              score: 0.8,
            },
          ],
        },
      },
    ],
  }

  it("returns names, titles, and urls — all three consumed by checks.ts", () => {
    const { names, titles, urls } = citableSources(file)
    expect(names).toEqual(new Set(["Cru", "EveryStudent"]))
    expect(titles).toEqual(new Set(["Title One"]))
    expect(urls).toEqual(
      new Set(["https://example.com/1", "https://example.com/2"]),
    )
  })
})

describe("committed fixture file (real contract)", () => {
  it("parses and matches the decision doc's recorded fingerprint", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL("fixtures/rag-fixtures.json", import.meta.url),
        "utf8",
      ),
    ) as unknown
    const file = loadableFixtureFile(raw)
    expect(file).not.toBeNull()
    expect(file!.topK).toBe(5)
    expect(file!.corpusSha256).toBe(
      "4909d1b97c9b065ff79d8da0f71907c4259e0d1b96a2b8cabfa73578f7a4fd49",
    )
    // Captured for the ORIGINAL six questions; the four extension questions
    // need a re-capture (documented in questions.ts).
    expect(file!.fixtures).toHaveLength(6)
    for (const fixture of file!.fixtures) {
      if (fixture.questionId === "q-python-pdf") {
        // The scope question genuinely retrieved ZERO passages — the real
        // `empty` path that fixed the scope failure (FINDINGS-RUN-3 §3).
        expect(fixture.result.status).toBe("empty")
        expect(fixture.result.sources).toHaveLength(0)
        continue
      }
      expect(fixture.result.status).toBe("ok")
      expect(fixture.result.sources.length).toBeGreaterThan(0)
    }
  })

  it("rejects a file with the wrong kind", () => {
    expect(loadableFixtureFile({ kind: "other" })).toBeNull()
    expect(loadableFixtureFile(null)).toBeNull()
  })
})
